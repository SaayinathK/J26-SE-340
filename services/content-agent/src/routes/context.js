const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { validTenant } = require('../config/db');
const engine = require('../services/contextEngine');
function validateRequest(req,res,next) {
  const { content_type, brief, brand_voice_id, campaign_id, generation_mode } = req.body;
  if ((campaign_id != null && !validTenant(campaign_id)) || (generation_mode != null && !['initial','winner'].includes(generation_mode)) || (generation_mode === 'winner' && !campaign_id) || !engine.TYPES.includes(content_type) || (brief != null && (typeof brief !== 'string' || brief.length > 10000)) || (brand_voice_id != null && !validTenant(brand_voice_id))) return res.status(400).json({ success:false,error:'Valid content_type, optional brief (up to 10000 characters), and optional brand_voice_id UUID required' });
  req.body.brief = typeof brief === 'string' ? brief.trim() : '';
  next();
}
router.post('/build',protect,validateRequest,async(req,res,next) => {
  try { const campaign = req.body.campaign_id ? await require('../services/campaignService').getCampaign(req.tenant_id,req.body.campaign_id) : undefined; res.json({ success:true,context:await engine.buildContext(req.tenant_id,req.body.content_type,req.body.brief,req.body.brand_voice_id,campaign) }); }
  catch(error) { next(error); }
});
module.exports = router;
module.exports.validateRequest = validateRequest;
