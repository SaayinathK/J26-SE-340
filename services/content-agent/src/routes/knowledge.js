const router = require('express').Router();
const { randomUUID } = require('node:crypto');
const { protect } = require('../middleware/auth');
const db = require('../config/db');
const { getEmbedding } = require('../services/llmService');
const types = ['brand_voice', 'brand', 'product', 'audience', 'proven_hook', 'failed_hook', 'campaign_result', 'objection', 'audience_insight', 'value_proposition'];
router.use(protect);
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT entry_id, type, text, created_at FROM knowledge_base WHERE tenant_id = $1 ORDER BY created_at DESC, entry_id', [req.tenant_id], req.tenant_id);
    res.json({ success: true, entries: rows });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  const { type, text } = req.body;
  if (!types.includes(type) || typeof text !== 'string' || !text.trim() || text.length > 10000) {
    return res.status(400).json({ success: false, error: 'Provide a supported knowledge type and text (1–10000 characters).' });
  }
  try {
    const embedding = await getEmbedding(text.trim());
    const { rows } = await db.query(`INSERT INTO knowledge_base (entry_id, tenant_id, type, text, embedding)
      VALUES ($1, $2, $3, $4, $5::vector) RETURNING entry_id, type, text, created_at`,
      [randomUUID(), req.tenant_id, type, text.trim(), JSON.stringify(embedding)], req.tenant_id);
    res.status(201).json({ success: true, entry: rows[0] });
  } catch (error) { next(error); }
});
router.delete('/:id', async (req, res, next) => {
  if (!db.validTenant(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid entry ID.' });
  try {
    const { rows } = await db.query('DELETE FROM knowledge_base WHERE tenant_id = $1 AND entry_id = $2 RETURNING entry_id', [req.tenant_id, req.params.id], req.tenant_id);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Knowledge entry not found.' });
    res.json({ success: true });
  } catch (error) { next(error); }
});
module.exports = router;
