'use strict';
const router = require('express').Router();
const { directory } = require('../services/serviceDirectory');
router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ services: await directory(req.user), checked_at: new Date().toISOString() });
});
module.exports = router;
