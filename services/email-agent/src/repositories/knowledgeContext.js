'use strict';
// Generation and draft validation use exactly the same source selection and
// truncation. No prompt rules, campaign goals or learned advice authorize offers.
async function retrieveKnowledge(client, tenantId, source = 'all') {
  if (source === 'none') return { facts: '', count: 0 };
  const documents = (await client.query("SELECT text FROM knowledge_base WHERE tenant_id=$1 AND coalesce(metadata->>'archived','false') <> 'true' AND ($2::uuid IS NULL OR entry_id=$2) ORDER BY created_at DESC,entry_id LIMIT 10", [tenantId, source === 'all' ? null : source])).rows;
  if (source !== 'all' && !documents.length) {
    const error = new Error('Knowledge source is unavailable in this workspace. Choose another source.'); error.status = 404; throw error;
  }
  return { facts: documents.map(document => document.text).join('\n---\n').slice(0, 24000), count: documents.length };
}
module.exports = { retrieveKnowledge };
