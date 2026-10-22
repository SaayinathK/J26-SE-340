const crypto = require('node:crypto');
const db = require('../config/db');
function hashPrompt(agentType, subType, variant = {}) {
  return crypto.createHash('sha256').update(JSON.stringify([agentType,subType,variant])).digest('hex');
}
async function recordPromptUse({tenantId,agentType,subType,promptHash,promptSnapshot}, run) {
  if(!run) return db.transaction(tenantId, query=>recordPromptUse({tenantId,agentType,subType,promptHash,promptSnapshot},query));
  await run(`INSERT INTO prompt_performance
    (tenant_id,agent_type,sub_type,prompt_hash,prompt_snapshot,total_uses)
    VALUES ($1,$2,$3,$4,$5,1) ON CONFLICT (tenant_id,prompt_hash,agent_type)
    DO UPDATE SET total_uses=prompt_performance.total_uses+1`,
    [tenantId,agentType,subType,promptHash,JSON.stringify(promptSnapshot)]);
}
// The caller locks the generation and passes its previous rating in this SAME transaction.
async function recordFeedback({tenantId,promptHash,agentType,feedback,previousRating},run) {
  if(!run) throw new Error('Feedback requires the generation transaction');
  const positive=Number(feedback==='positive')-Number(previousRating==='positive');
  const negative=Number(feedback==='negative')-Number(previousRating==='negative');
  const {rows}=await run(`UPDATE prompt_performance SET
    positive_ratings=GREATEST(0,positive_ratings+$1),
    negative_ratings=GREATEST(0,negative_ratings+$2),
    success_rate=ROUND(GREATEST(0,positive_ratings+$1)::decimal/GREATEST(positive_ratings+$1+negative_ratings+$2,1)*100,2),
    is_champion=(positive_ratings+$1+negative_ratings+$2>=5 AND
      (positive_ratings+$1)::decimal/GREATEST(positive_ratings+$1+negative_ratings+$2,1)>=0.6)
    WHERE tenant_id=$3 AND prompt_hash=$4 AND agent_type=$5 RETURNING *`,
    [positive,negative,tenantId,promptHash,agentType]);
  return rows[0];
}
module.exports={hashPrompt,recordPromptUse,recordFeedback};
