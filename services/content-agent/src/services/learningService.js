const { createHash, randomUUID } = require('node:crypto');
const db = require('../config/db');
function hashPrompt(systemPrompt, userPrompt) { return createHash('sha256').update(JSON.stringify([systemPrompt, userPrompt])).digest('hex'); }
async function recordPromptUse({ tenantId, agentType, subType, promptHash, promptSnapshot }, run) {
  if (!run) return db.transaction(tenantId, q => recordPromptUse({ tenantId, agentType, subType, promptHash, promptSnapshot }, q));
  // The supplied schema has no composite unique constraint. Serialize this key without schema changes.
  await run('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${agentType}:${subType}:${promptHash}`]);
  const existing = await run('SELECT id FROM prompt_performance WHERE tenant_id = $1 AND prompt_hash = $2 AND agent_type = $3 AND sub_type = $4 FOR UPDATE', [tenantId,promptHash,agentType,subType]);
  const id = existing.rows[0]?.id || randomUUID();
  const { rows } = await run(`INSERT INTO prompt_performance (id, tenant_id, prompt_hash, agent_type, sub_type, total_uses, positive_ratings, success_rate, is_champion, prompt_snapshot, created_at)
    VALUES ($1,$2,$3,$4,$5,1,0,0,false,$6,NOW()) ON CONFLICT (id) DO UPDATE
    SET total_uses = prompt_performance.total_uses + 1,
    success_rate = 100.0 * prompt_performance.positive_ratings / (prompt_performance.total_uses + 1),
    is_champion = (prompt_performance.total_uses + 1 >= 5 AND 100.0 * prompt_performance.positive_ratings / (prompt_performance.total_uses + 1) >= 60)
    WHERE prompt_performance.tenant_id = $2 RETURNING *`, [id,tenantId,promptHash,agentType,subType,JSON.stringify(promptSnapshot)]);
  return rows[0];
}
async function recordFeedback({ tenantId, promptHash, agentType, subType, feedback, previousFeedback }, run) {
  if (!run) return db.transaction(tenantId, q => recordFeedback({ tenantId,promptHash,agentType,subType,feedback,previousFeedback },q));
  const delta = Number(feedback === 'positive') - Number(previousFeedback === 'positive');
  const { rows } = await run(`UPDATE prompt_performance SET positive_ratings = positive_ratings + $5,
    success_rate = ROUND(100.0 * (positive_ratings + $5) / GREATEST(total_uses,1),2),
    is_champion = (total_uses >= 5 AND 100.0 * (positive_ratings + $5) / GREATEST(total_uses,1) >= 60)
    WHERE tenant_id = $1 AND prompt_hash = $2 AND agent_type = $3 AND sub_type = $4 RETURNING *`, [tenantId,promptHash,agentType,subType,delta]);
  if (!rows[0]) throw new Error('Prompt performance record missing');
  return rows[0];
}
module.exports = { hashPrompt, recordPromptUse, recordFeedback };
