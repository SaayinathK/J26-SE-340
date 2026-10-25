const router = require("express").Router();
const { randomUUID } = require("node:crypto");
const db = require("../config/db");
const { protect, checkLimit } = require("../middleware/auth");
const { validateRequest } = require("./context");
const engine = require("../services/contextEngine");
const generator = require("../services/contentGenerator");
const learning = require("../services/learningService");
const campaigns = require('../services/campaignService');
router.use(protect);
router.post(
  "/generate",
  validateRequest,
  checkLimit,
  async (req, res, next) => {
    const streaming = req.body.content_type === 'meta_ad' && req.get('accept')?.includes('application/x-ndjson');
    const controller = new AbortController();
    let heartbeat, unlock, stage = 'context';
    const requestId = randomUUID();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    const send = event => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
    res.on('close', disconnect);
    try {
      const { content_type, brief, brand_voice_id, campaign_id, generation_mode = 'initial' } = req.body,
        tenantId = req.tenant_id;
      let campaign;
      if (campaign_id) {
        await campaigns.getCampaign(tenantId,campaign_id);
        unlock = await campaigns.lockCampaign(tenantId,campaign_id);
        campaign = await campaigns.getCampaign(tenantId,campaign_id);
        if (campaign.auto_learning) {
          await db.transaction(tenantId,run=>require('../services/performanceLearning').evaluateAndSave(tenantId,campaign,run));
          campaign = await campaigns.getCampaign(tenantId,campaign_id);
        }
      }
      if (generation_mode === 'winner' && (content_type !== 'meta_ad' || !campaign?.personas?.[campaign.winner_index])) {
        throw Object.assign(new Error('Complete the initial campaign and select a winning persona first'),{status:400});
      }
      const ctx = await engine.buildContext(
        tenantId,
        content_type,
        brief,
        brand_voice_id,
        campaign
      );
      if (ctx.missing_fields.length)
        return res
          .status(400)
          .json({ success: false, missing: ctx.missing_fields });
      if (generation_mode === 'initial') { ctx.learning_guidance = null; ctx.research_personas = []; }
      const effectiveBrief = ctx.brief || brief;
      controller.signal.throwIfAborted();
      if (streaming) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        send({type:'status', message:'Preparing your campaign…'});
        heartbeat = setInterval(() => send({type:'heartbeat'}), 15000);
      }
      const selectedPersona = generation_mode === 'winner' ? campaign.personas[campaign.winner_index] : undefined;
      const key = campaigns.fingerprint(ctx,effectiveBrief,generation_mode,selectedPersona);
      let draft = campaign?.draft?.key === key ? campaign.draft : {key,plan:null,completed:[]};
      const onProgress = async event => {
        if (campaign && content_type === 'meta_ad' && (event.type === 'plan' || event.type === 'persona')) {
          if (event.type === 'plan') draft.plan = {personas:event.personas};
          else draft.completed[event.index] = event.persona;
          stage = 'checkpoint';
          await db.query('UPDATE content_campaigns SET draft=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenantId,campaign.id,JSON.stringify(draft)],tenantId);
        }
        stage = 'generation';
        if (streaming) send(event);
      };
      stage = 'generation';
      const result = await generator.generateWithRetry(ctx, effectiveBrief, content_type, 3, {
        onProgress,signal:controller.signal,selectedPersona,
        savedPlan:draft.plan,completedPersonas:draft.completed,
      });
      controller.signal.throwIfAborted();
      const id = randomUUID(),
        promptHash = learning.hashPrompt(content_type, ctx.intent.sub_type, {template_version:3,system:result.systemPrompt, mode:generation_mode, guidance:ctx.learning_guidance || null, model:process.env.CONTENT_MODEL || 'mistral:7b-instruct-q4_K_M'});
      const personaSetId = generation_mode === 'initial' ? id : campaign?.persona_set_id;
      stage = 'save';
      await db.transaction(tenantId, async (run) => {
        const limit = await run(
          "UPDATE clients SET generations_used = generations_used + 1 WHERE id = $1 AND is_active = true AND generations_used < generations_limit RETURNING id",
          [tenantId]
        );
        if (!limit.rows.length)
          throw Object.assign(new Error("Generation limit reached"), {
            status: 429,
          });
        await run(
          `INSERT INTO generations (id,tenant_id,agent_type,sub_type,input_params,output,tokens_used,prompt_hash,model_version,created_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() WHERE $2::uuid = current_setting('app.current_tenant')::uuid`,
          [
            id,
            tenantId,
            content_type,
            ctx.intent.sub_type,
            JSON.stringify({
              content_type,
              campaign_id,
              generation_mode,
              persona_set_id: personaSetId,
              learning_revision: ctx.learning_guidance ? campaign.learning_revision : 0,
              brief: effectiveBrief,
              user_brief: brief,
              brief_source: ctx.brief_source || 'custom',
              brand_voice_id,
              context_ids: ctx.kb_entries.map((e) => e.entry_id),
            }),
            JSON.stringify(result.output),
            result.tokensUsed,
            promptHash,
            process.env.CONTENT_MODEL || "mistral:7b-instruct-q4_K_M",
          ]
        );
        if (campaign && content_type === 'meta_ad') {
          await run(generation_mode === 'initial'
            ? "UPDATE content_campaigns SET personas=$3, winner_index=NULL, winner_source=NULL, persona_set_id=$4, learning_guidance=NULL, learning_evidence=NULL, draft=NULL, version=version+1, updated_at=now() WHERE tenant_id=$1 AND id=$2"
            : "UPDATE content_campaigns SET draft=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2",
            generation_mode === 'initial' ? [tenantId,campaign.id,JSON.stringify(result.output.personas.map(({name,description,pain_points})=>({name,description,pain_points}))),personaSetId] : [tenantId,campaign.id]);
        }
        await learning.recordPromptUse(
          {
            tenantId,
            agentType: content_type,
            subType: ctx.intent.sub_type,
            promptHash,
            promptSnapshot: {
              template_version:3,
              system: result.systemPrompt,
              user: result.userPrompt,
              addition: ctx.champion || "",
            },
          }, run
        );
      });
      stage = 'complete';
      const response = {
        success: true,
        content_id: id,
        campaign_id,
        generation_mode,
        ...result.output,
        attempts: result.attempts,
        context_ids: ctx.kb_entries.map((e) => e.entry_id),
      };
      if (streaming) { send({type:'complete', data:response}); res.end(); }
      else res.json(response);
    } catch (error) {
      if (res.destroyed || controller.signal.aborted) return;
      console.error('Campaign request failed', {requestId, stage, name:error.name, code:error.code, message:error.message});
      if (res.headersSent) {
        const fallback = stage === 'save'
          ? 'Campaign saving failed. Check History before retrying; saved draft progress can be resumed.'
          : stage === 'checkpoint'
            ? 'Could not save campaign progress. Retry with the same settings to resume the last saved step.'
            : 'Campaign generation failed before the final save. Retry with the same settings to resume saved progress.';
        send({type:'error', status:error.status || 500, request_id:requestId, stage, error:error.status ? error.message : fallback});
        res.end();
      } else next(error);
    } finally {
      clearInterval(heartbeat);
      res.off('close', disconnect);
      if (unlock) {
        try { await unlock(); }
        catch (error) { console.error('Campaign lock cleanup failed', {requestId, code:error.code, message:error.message}); }
      }
    }
  }
);
router.post("/feedback", async (req, res, next) => {
  const { generation_id, feedback } = req.body;
  if (
    !db.validTenant(generation_id) ||
    !["positive", "negative"].includes(feedback)
  )
    return res
      .status(400)
      .json({
        success: false,
        error: "Valid generation_id and positive or negative feedback required",
      });
  try {
    const performance = await db.transaction(req.tenant_id, async (run) => {
      const { rows } = await run(
        "SELECT prompt_hash,agent_type,sub_type,rating FROM generations WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [req.tenant_id, generation_id]
      );
      const generation = rows[0];
      if (!generation)
        throw Object.assign(new Error("Generation not found"), { status: 404 });
      await run(
        "UPDATE generations SET rating = $3 WHERE tenant_id = $1 AND id = $2",
        [req.tenant_id, generation_id, feedback]
      );
      return learning.recordFeedback(
        {
          tenantId: req.tenant_id,
          promptHash: generation.prompt_hash,
          agentType: generation.agent_type,
          feedback,
          previousRating:generation.rating,
        }, run
      );
    });
    res.json({ success: true, performance });
  } catch (error) {
    next(error);
  }
});
router.get("/history", async (req, res, next) => {
  try {
    if (req.query.campaign_id && !db.validTenant(req.query.campaign_id)) return res.status(400).json({success:false,error:'Invalid campaign ID'});
    const { rows } = await db.query(
      `SELECT * FROM generations WHERE tenant_id = $1 ${req.query.campaign_id ? "AND input_params->>'campaign_id' = $2" : ''} ORDER BY created_at DESC, id DESC LIMIT 20`,
      req.query.campaign_id ? [req.tenant_id,req.query.campaign_id] : [req.tenant_id],
      req.tenant_id
    );
    res.json({ success: true, history: rows });
  } catch (error) {
    next(error);
  }
});
module.exports = router;
