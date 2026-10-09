const router = require('express').Router();
const { randomUUID } = require('node:crypto');
const db = require('../config/db');
const { protect, checkLimit } = require('../middleware/auth');
const { validateRequest } = require('./context');
const engine = require('../services/contextEngine');
const generator = require('../services/contentGenerator');
const learning = require('../services/learningService');
router.use(protect);
router.post('/generate',validateRequest,checkLimit,async(req,res,next) => {
  try {
    const { content_type,brief,brand_voice_id } = req.body, tenantId = req.tenant_id;
    const ctx = await engine.buildContext(tenantId,content_type,brief,brand_voice_id);
    if (ctx.missing_fields.length) return res.status(400).json({ success:false,missing:ctx.missing_fields });
    const result = await generator.generateWithRetry(ctx,brief,content_type);
    const id = randomUUID(), promptHash = learning.hashPrompt(result.systemPrompt,result.userPrompt);
    await db.transaction(tenantId,async run => {
      const limit = await run('UPDATE clients SET generations_used = generations_used + 1 WHERE id = $1 AND is_active = true AND generations_used < generations_limit RETURNING id',[tenantId]);
      if (!limit.rows.length) throw Object.assign(new Error('Generation limit reached'),{ status:429 });
      await run(`INSERT INTO generations (id,tenant_id,agent_type,sub_type,input_params,output,tokens_used,prompt_hash,model_version,created_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() WHERE $2::uuid = current_setting('app.current_tenant')::uuid`,
        [id,tenantId,content_type,ctx.intent.sub_type,JSON.stringify({ content_type,brief,brand_voice_id,context_ids:ctx.kb_entries.map(e=>e.entry_id) }),JSON.stringify(result.output),result.tokensUsed,promptHash,process.env.CONTENT_MODEL || 'mistral:7b-instruct-q4_K_M']);
      await learning.recordPromptUse({ tenantId,agentType:content_type,subType:ctx.intent.sub_type,promptHash,promptSnapshot:{ system:result.systemPrompt,user:result.userPrompt,addition:ctx.champion || '' } },run);
    });
    res.json({ success:true,content_id:id,...result.output,attempts:result.attempts,context_ids:ctx.kb_entries.map(e=>e.entry_id) });
  } catch(error) { next(error); }
});
router.post('/feedback',async(req,res,next) => {
  const { generation_id,feedback } = req.body;
  if (!db.validTenant(generation_id) || !['positive','negative'].includes(feedback)) return res.status(400).json({ success:false,error:'Valid generation_id and positive or negative feedback required' });
  try {
    const performance = await db.transaction(req.tenant_id,async run => {
      const { rows } = await run('SELECT prompt_hash,agent_type,sub_type,rating FROM generations WHERE tenant_id = $1 AND id = $2 FOR UPDATE',[req.tenant_id,generation_id]);
      const generation = rows[0];
      if (!generation) throw Object.assign(new Error('Generation not found'),{ status:404 });
      await run('UPDATE generations SET rating = $3 WHERE tenant_id = $1 AND id = $2',[req.tenant_id,generation_id,feedback]);
      return learning.recordFeedback({ tenantId:req.tenant_id,promptHash:generation.prompt_hash,agentType:generation.agent_type,subType:generation.sub_type,feedback,previousFeedback:generation.rating },run);
    });
    res.json({ success:true,performance });
  } catch(error) { next(error); }
});
router.get('/history',async(req,res,next) => {
  try {
    const { rows } = await db.query('SELECT * FROM generations WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20',[req.tenant_id],req.tenant_id);
    res.json({ success:true,history:rows });
  } catch(error) { next(error); }
});
module.exports = router;
