
const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authorization = req.headers.authorization;

  if (
    !authorization ||
    !authorization.startsWith('Bearer ')
  ) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  const token = authorization.slice(7);

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET,
      {
        algorithms: ['HS256'],
        issuer: 'c4-gateway',
        audience: 'c4-platform'
      }
    );

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tenant_id !== 'string' ||
      !['agency_admin', 'marketer', 'viewer']
        .includes(payload.role)
    ) {
      return res.status(401).json({
        error: 'Invalid token claims'
      });
    }

    req.user = {
      user_id: payload.sub,
      tenant_id: payload.tenant_id,
      role: payload.role
    };

    next();
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired token'
    });
  }
}

module.exports = authenticate;
