const db = require('../config/db');
const { createHash } = require('node:crypto');
const profileFields = ['business_name','industry','website_url','offer_type','offer_name','offer_price','offer_date','offer_location','target_audience','value_propositions','brand_voice'];
function cleanProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw Object.assign(new Error('Campaign profile required'), {status:400});
  const result = {};
  for (const field of profileFields) {
    if (profile[field] != null && (typeof profile[field] !== 'string' || profile[field].length > 5000)) throw Object.assign(new Error(`Invalid ${field}`), {status:400});
    result[field] = (profile[field] || '').trim();
  }
  if (!result.business_name || !result.offer_name || !result.target_audience) throw Object.assign(new Error('Business name, offer name, and target audience are required'), {status:400});
  return result;
}
async function getCampaign(tenant, id) {
  if (!db.validTenant(id)) throw Object.assign(new Error('Invalid campaign ID'), {status:400});
  const {rows} = await db.query('SELECT * FROM content_campaigns WHERE tenant_id = $1 AND id = $2', [tenant,id],tenant);
  if (!rows[0]) throw Object.assign(new Error('Campaign not found'), {status:404});
  return rows[0];
}
// Hold a session advisory lock, never a long-running SQL transaction, during inference.
async function lockCampaign(tenant, id) {
  const client = await db.pool.connect();
  const key = `${tenant}:${id}`;
  try {
    const {rows} = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',[key]);
    if (!rows[0].locked) throw Object.assign(new Error('This campaign is already generating. Wait for it to finish.'),{status:409});
  } catch(error) { client.release(); throw error; }
  return async () => {
    try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))',[key]); }
    finally { client.release(); }
  };
}
function fingerprint(ctx, brief, mode, winner) {
  return createHash('sha256').update(JSON.stringify([ctx.business_profile,ctx.knowledge_revision,ctx.brand_voice,ctx.learning_guidance,ctx.research_evidence,ctx.crm_context?.revision,ctx.research_personas,brief,mode,winner,process.env.CONTENT_MODEL])).digest('hex');
}
module.exports = {cleanProfile,getCampaign,lockCampaign,fingerprint};
