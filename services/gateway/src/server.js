
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = require('./db');
const authenticate = require('./middleware/auth');
const authorize = require('./middleware/authorize');
const audit = require('./middleware/audit');

const emailRoutes = require('./routes/emailRoutes');

// Validate environment variables
if (!process.env.JWT_SECRET || !process.env.DB_PASSWORD) {
  throw new Error('Missing required environment variables');
}

const app = express();

// Global middleware
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

app.use('/api/email',
  authenticate,
  authorize('agency_admin', 'marketer'),
  audit('email_sequence'),
  emailRoutes
);

// Login rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'c4-gateway'
  });
});

// ==========================================
// C4-02: JWT AUTHENTICATION
// ==========================================

// Login endpoint
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    email.length > 254 ||
    password.length > 1024
  ) {
    return res.status(400).json({
      error: 'Valid email and password are required'
    });
  }

  let client;

  try {
    client = await pool.connect();

    // Authentication lookup through the
    // restricted database function.
    const account = await client.query(
      `SELECT user_id, tenant_id, email, password_hash, role
       FROM auth_private.lookup_login_user($1)`,
      [email]
    );

    if (account.rows.length !== 1) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    const user = account.rows[0];

    // Verify bcrypt password
    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    // Generate JWT access token
    const token = jwt.sign(
      {
        sub: user.user_id,
        tenant_id: user.tenant_id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
        issuer: 'c4-gateway',
        audience: 'c4-platform'
      }
    );

    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      user: {
        user_id: user.user_id,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login failed:', error.message);

    return res.status(500).json({
      error: 'Internal server error'
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});

// ==========================================
// PROTECTED AUTHENTICATION ROUTES
// ==========================================

// Get authenticated user profile
app.get(
  '/api/auth/me',
  authenticate,
  (req, res) => {
    res.json({
      user: req.user
    });
  }
);

// Get authenticated tenant context
app.get(
  '/api/tenant/context',
  authenticate,
  (req, res) => {
    res.json({
      tenant_id: req.user.tenant_id,
      role: req.user.role,
      message: 'Authenticated tenant context'
    });
  }
);

// ==========================================
// C4-03: ROLE-BASED ACCESS CONTROL
// C4-05: AUDIT LOGGING
// ==========================================

// ADMIN ONLY
app.get(
  '/api/admin/dashboard',

  authenticate,
  audit('admin_dashboard_access'),
  authorize('agency_admin'),

  (req, res) => {
    res.json({
      message: 'Admin access granted',
      role: req.user.role
    });
  }
);

// ADMIN AND MARKETER
app.get(
  '/api/campaigns/manage',

  authenticate,
  audit('campaign_manage_access'),
  authorize('agency_admin', 'marketer'),

  (req, res) => {
    res.json({
      message: 'Campaign management access granted',
      role: req.user.role
    });
  }
);

// ADMIN, MARKETER AND VIEWER
app.get(
  '/api/campaigns/view',

  authenticate,
  audit('campaign_view_access'),
  authorize('agency_admin', 'marketer', 'viewer'),

  (req, res) => {
    res.json({
      message: 'Campaign viewing access granted',
      role: req.user.role
    });
  }
);

// ==========================================
// START SERVER
// ==========================================

const PORT = Number(process.env.PORT || 4000);

// Only bind to port when run directly (not when required by tests)
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`C4 Gateway running on http://localhost:${PORT}`);
  });
}

module.exports = app;
