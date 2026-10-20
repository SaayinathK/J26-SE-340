const crypto = require('node:crypto');
const { pool } = require('../config/db');

function hashPrompt(agentType, subType) {
  return crypto
    .createHash('sha256')
    .update(`${agentType}:${subType}`)
    .digest('hex');
}

async function recordPromptUse({ tenantId, agentType, subType, promptHash, promptSnapshot }) {
  const client = await pool.connect();
  try {
    await client.query('SET row_security = off');
    await client.query(
      `INSERT INTO prompt_performance
         (tenant_id, agent_type, sub_type, prompt_hash, prompt_snapshot, total_uses)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (tenant_id, prompt_hash, agent_type)
       DO UPDATE SET
         total_uses = prompt_performance.total_uses + 1`,
      [tenantId, agentType, subType, promptHash, JSON.stringify(promptSnapshot)]
    );
  } catch (err) {
    console.error('recordPromptUse error:', err.message);
  } finally {
    client.release();
  }
}

async function recordFeedback({ tenantId, promptHash, agentType, feedback }) {
  const isPositive = feedback === 'positive';
  const client = await pool.connect();
  try {
    await client.query('SET row_security = off');
    const result = await client.query(
      `UPDATE prompt_performance SET
         positive_ratings = positive_ratings + $1,
         success_rate = ROUND(
           (positive_ratings + $1)::decimal / total_uses * 100, 2
         ),
         is_champion = CASE
           WHEN total_uses >= 5
            AND ROUND((positive_ratings + $1)::decimal / total_uses * 100, 2) >= 60
           THEN true
           ELSE is_champion
         END
       WHERE tenant_id = $2
         AND prompt_hash = $3
         AND agent_type = $4
       RETURNING *`,
      [isPositive ? 1 : 0, tenantId, promptHash, agentType]
    );
    return result.rows[0];
  } catch (err) {
    console.error('recordFeedback error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { hashPrompt, recordPromptUse, recordFeedback };
