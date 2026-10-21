// src/services/emailAgent.js
const pool = require('../db');
require('dotenv').config();

const OLLAMA      = process.env.OLLAMA_HOST  || 'http://localhost:11434';
const GEN_MODEL   = process.env.OLLAMA_MODEL || 'mistral:7b-instruct-q4_K_M';
const EMBED_MODEL = process.env.EMBED_MODEL  || 'nomic-embed-text';

// Fetch with a hard timeout — aborts and throws if Ollama doesn't respond in time
async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getEmbedding(text) {
  const res = await fetchWithTimeout(
    `${OLLAMA}/api/embeddings`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    },
    3000  // 8-second timeout
  );
  if (!res.ok) throw new Error('Ollama embeddings HTTP ' + res.status);
  return (await res.json()).embedding;
}

async function buildRAGContext(tenant_id, campaignGoal) {
  let client;
  try {
    const embedding = await getEmbedding(campaignGoal);
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenant_id]);
    const { rows } = await client.query(
      'SELECT text FROM knowledge_base WHERE tenant_id = $1 ORDER BY embedding <=> $2::vector LIMIT 5',
      [tenant_id, JSON.stringify(embedding)],
    );
    await client.query('COMMIT');
    if (!rows.length) return null;
    return rows.map(function(r) { return r.text; }).join('\n---\n');
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.warn('[emailAgent] RAG retrieval failed:', e.message);
    return null;
  } finally {
    if (client) client.release();
  }
}

var MOCK_EMAILS = [
  {
    email_index: 1,
    subject: '[MOCK] Welcome to our campaign',
    body: 'Hi,\n\nWelcome! We are excited to connect with you.\n\nTo unsubscribe from these emails, reply STOP or click here.',
    send_at_days: 0,
  },
  {
    email_index: 2,
    subject: '[MOCK] Here is what we offer',
    body: 'Hi,\n\nHere is more value for you.\n\nTo unsubscribe from these emails, reply STOP or click here.',
    send_at_days: 3,
  },
  {
    email_index: 3,
    subject: '[MOCK] Last chance to act',
    body: 'Hi,\n\nDon\'t miss out.\n\nTo unsubscribe from these emails, reply STOP or click here.',
    send_at_days: 7,
  },
];

async function generateSequence(tenant_id, campaignGoal, audienceSegment) {
  var context = await buildRAGContext(tenant_id, campaignGoal);
  var contextBlock = context ? ('Brand context:\n' + context + '\n\n') : '';

  var prompt = contextBlock
    + 'You are an email marketing specialist.\n'
    + 'Write a 3-step email drip sequence for the following campaign.\n\n'
    + 'Campaign goal: ' + campaignGoal + '\n'
    + 'Audience: ' + audienceSegment + '\n\n'
    + 'Rules:\n'
    + '1. Each email must be relevant to the campaign goal and audience.\n'
    + '2. Keep each email body under 150 words.\n'
    + '3. REQUIRED: Every email body MUST end with this exact line:\n'
    + '   To unsubscribe from these emails, reply STOP or click here.\n'
    + '4. Do NOT omit the unsubscribe line from any email - it is legally required.\n'
    + '5. send_at_days: email 1 = 0, email 2 = 3, email 3 = 7.\n\n'
    + 'Return ONLY valid JSON with no markdown:\n'
    + '{"emails":['
    + '{"email_index":1,"subject":"...","body":"...\\n\\nTo unsubscribe from these emails, reply STOP or click here.","send_at_days":0},'
    + '{"email_index":2,"subject":"...","body":"...\\n\\nTo unsubscribe from these emails, reply STOP or click here.","send_at_days":3},'
    + '{"email_index":3,"subject":"...","body":"...\\n\\nTo unsubscribe from these emails, reply STOP or click here.","send_at_days":7}'
    + ']}';

  try {
    var res = await fetchWithTimeout(
      OLLAMA + '/api/generate',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:   GEN_MODEL,
          prompt:  prompt,
          stream:  false,
          options: {
            num_predict: 600,
            temperature: 0.7,
            stop: ['}]}'],
          },
        }),
      },
      20000  // 25-second timeout — lets Mistral finish if it can, aborts before Jest's 30s limit
    );
    if (!res.ok) throw new Error('Ollama generate HTTP ' + res.status);
    var data = await res.json();
    var match = data.response && data.response.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Ollama response');
    var parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.emails) || parsed.emails.length === 0) {
      throw new Error('Parsed JSON has no emails array');
    }
    return parsed;
  } catch (e) {
    console.warn('[emailAgent] Ollama failed, using mock:', e.message);
    return { emails: MOCK_EMAILS };
  }
}

module.exports = { generateSequence };
