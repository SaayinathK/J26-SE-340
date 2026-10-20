const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/auth');
const db         = require('../config/db');

router.get('/', protect, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM business_settings WHERE tenant_id = $1',
      [req.clientId], req.clientId
    );
    res.json({ success: true, settings: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const {
      business_name, offer_type, offer_name,
      offer_date, offer_location, offer_price,
      target_audience, value_propositions,
      brand_voice, industry, website_url,
    } = req.body;

    const result = await db.query(
      `INSERT INTO business_settings
         (tenant_id, business_name, offer_type, offer_name,
          offer_date, offer_location, offer_price,
          target_audience, value_propositions,
          brand_voice, industry, website_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id) DO UPDATE SET
         business_name      = EXCLUDED.business_name,
         offer_type         = EXCLUDED.offer_type,
         offer_name         = EXCLUDED.offer_name,
         offer_date         = EXCLUDED.offer_date,
         offer_location     = EXCLUDED.offer_location,
         offer_price        = EXCLUDED.offer_price,
         target_audience    = EXCLUDED.target_audience,
         value_propositions = EXCLUDED.value_propositions,
         brand_voice        = EXCLUDED.brand_voice,
         industry           = EXCLUDED.industry,
         website_url        = EXCLUDED.website_url
       RETURNING *`,
      [req.clientId, business_name, offer_type, offer_name,
       offer_date, offer_location, offer_price,
       target_audience, value_propositions,
       brand_voice, industry, website_url], req.clientId
    );

    res.json({ success: true, settings: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
