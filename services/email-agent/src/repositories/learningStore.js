'use strict';
const model = require('../services/engagementModel');
const { event } = require('./sequenceStore');
const defaults = { enabled: false, auto_train: false, active_run_id: null, version: 0 };
async function settings(client) { return (await client.query('SELECT * FROM email_learning_settings')).rows[0] || { ...defaults }; }
async function trainWorkspace(client, user, { automatic = false } = {}) {
  // Serialize outcome-triggered and manual training within this workspace.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['email-learning-' + user.tenant_id]);
  const config = await settings(client);
  if (!config.enabled) { const error = new Error('Enable workspace learning before training a model.'); error.status = 409; throw error; }
  const rows = (await client.query("SELECT id,sequence_id,delivered,clicked,features FROM email_outcomes WHERE provenance='manual' ORDER BY id")).rows;
  let result;
  try { result = model.train(rows); } catch (error) { if (automatic && error.status === 422) return null; throw error; }
  const existing = (await client.query('SELECT * FROM email_learning_runs WHERE dataset_hash=$1 ORDER BY created_at DESC LIMIT 1', [result.dataset_hash])).rows[0];
  if (existing) return existing;
  const run = (await client.query('INSERT INTO email_learning_runs (tenant_id,status,dataset_hash,sample_count,sequence_count,model,evaluation) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [user.tenant_id, result.status, result.dataset_hash, result.sample_count, result.sequence_count, JSON.stringify(result.model), JSON.stringify(result.evaluation)])).rows[0];
  if (automatic && config.auto_train && run.status === 'validated') await client.query('UPDATE email_learning_settings SET active_run_id=$1,version=version+1,updated_at=now()', [run.id]);
  await event(client, user, 'Engagement model evaluated', result.status === 'validated' ? 'Candidate passed held-out evaluation.' : 'Candidate did not beat the baseline; the active model was kept.', 'activity');
  return run;
}
async function learningContext(client) {
  const config = await settings(client);
  if (!config.enabled || !config.active_run_id) return null;
  const run = (await client.query("SELECT * FROM email_learning_runs WHERE id=$1 AND status='validated' AND coalesce(evaluation->>'synthetic','false') <> 'true'", [config.active_run_id])).rows[0];
  return run ? { id: run.id, ...model.guidance(run.model) } : null;
}
module.exports = { settings, trainWorkspace, learningContext };
