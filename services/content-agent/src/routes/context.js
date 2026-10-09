const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { validTenant } = require('../config/db');
const engine = require('../services/contextEngine');
function validateRequest(req,res,next) {
  const { content_type, brief, brand_voice_id } = req.body;
  if (!engine.TYPES.includes(content_type) || typeof brief !== 'string' || !brief.trim() || brief.length > 10000 || (brand_voice_id != null && !validTenant(brand_voice_id))) return res.status(400).json({ success:false,error:'Valid content_type, brief (1–10000 characters), and optional brand_voice_id UUID required' });
  next();
}
router.post('/build',protect,validateRequest,async(req,res,next) => {
  try { res.json({ success:true,context:await engine.buildContext(req.tenant_id,req.body.content_type,req.body.brief,req.body.brand_voice_id) }); }
  catch(error) { next(error); }
});
module.exports = router;
module.exports.validateRequest = validateRequest;
