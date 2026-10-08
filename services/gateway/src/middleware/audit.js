
const pool = require('../config/db');

function audit(action) {
  return (req, res, next) => {
    res.on('finish', () => {
      const user = req.user;

      if (!user) return;

      const decision =
        res.statusCode >= 200 && res.statusCode < 400
          ? 'allowed'
          : 'denied';

      pool.query(
        `INSERT INTO audit_log
         (tenant_id, user_id, route, action, decision, status_code)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          user.tenant_id,
          user.user_id,
          req.originalUrl.split('?')[0],
          action,
          decision,
          res.statusCode
        ]
      ).catch(error => {
        console.error('Audit logging failed:', error.message);
      });
    });

    next();
  };
}

module.exports = audit;
