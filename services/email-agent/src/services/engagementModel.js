'use strict';
const crypto = require('node:crypto');
const keys = ['tone', 'subject_length', 'cta'];
function features(sequence, index) {
  const email = sequence.emails[index - 1];
  return { tone: sequence.tone, subject_length: email.subject.length <= 40 ? 'short' : email.subject.length <= 60 ? 'medium' : 'long', cta: email.body.includes('{{cta_link}}') ? 'linked' : 'unlinked' };
}
function fingerprint(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, row.sequence_id, row.delivered, row.clicked, row.features]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex');
}
function fit(rows) {
  const total = rows.reduce((sum, row) => ({ delivered: sum.delivered + row.delivered, clicked: sum.clicked + row.clicked }), { delivered: 0, clicked: 0 });
  const prior = (total.clicked + 1) / (total.delivered + 2);
  const groups = {};
  for (const key of keys) {
    groups[key] = {};
    for (const row of rows) {
      const value = row.features[key];
      const group = groups[key][value] ||= { records: 0, delivered: 0, clicked: 0 };
      group.records++; group.delivered += row.delivered; group.clicked += row.clicked;
    }
    for (const group of Object.values(groups[key])) group.rate = (group.clicked + prior * 20) / (group.delivered + 20);
  }
  return { prior, delivered: total.delivered, clicked: total.clicked, groups };
}
function predict(model, values) {
  const rates = keys.map(key => model.groups[key][values[key]]).filter(group => group?.records >= 2).map(group => group.rate);
  return rates.length ? (model.prior + rates.reduce((sum, value) => sum + value, 0)) / (rates.length + 1) : model.prior;
}
function train(rows) {
  const usable = rows.filter(row => row.delivered > 0);
  const sequenceIds = [...new Set(usable.map(row => row.sequence_id))].sort();
  if (usable.length < 6 || sequenceIds.length < 3 || usable.reduce((sum, row) => sum + row.delivered, 0) < 100) {
    const error = new Error('Learning needs at least 6 measured email steps across 3 sequences and 100 total deliveries.'); error.status = 422; throw error;
  }
  // Hold out complete sequences so neighboring steps never leak into validation.
  const heldOut = new Set(sequenceIds.filter((_id, index) => index % 3 === 2));
  const training = usable.filter(row => !heldOut.has(row.sequence_id));
  const validation = usable.filter(row => heldOut.has(row.sequence_id));
  const candidate = fit(training);
  const error = probability => validation.reduce((sum, row) => sum + row.delivered * (row.clicked / row.delivered - probability(row)) ** 2, 0) / validation.reduce((sum, row) => sum + row.delivered, 0);
  const baseline = error(() => candidate.prior);
  const brier = error(row => predict(candidate, row.features));
  const status = brier <= baseline + 1e-10 ? 'validated' : 'needs_review';
  return { status, model: fit(usable), dataset_hash: fingerprint(usable), sample_count: usable.length, sequence_count: sequenceIds.length,
    evaluation: { metric: 'delivery-weighted squared error of aggregate click rates', candidate: brier, baseline, training_records: training.length, validation_records: validation.length, split: 'held-out sequences', passed: status === 'validated' } };
}
function guidance(model) {
  const best = key => Object.entries(model.groups[key] || {}).filter(([, group]) => group.records >= 2 && group.delivered >= 30).sort((a, b) => b[1].rate - a[1].rate)[0]?.[0];
  const subject = best('subject_length');
  const cta = best('cta');
  const suggestions = [];
  if (subject) suggestions.push(`Consider ${subject === 'short' ? 'subject lines of up to 40 characters' : subject === 'medium' ? 'subject lines of 41–60 characters' : 'longer descriptive subject lines'}; this format has the strongest smoothed click rate in this workspace.`);
  if (cta === 'linked') suggestions.push('Use a clear action with the {{cta_link}} placeholder.');
  return { preferred_tone: best('tone') || null, subject_length: subject || null, suggestions };
}
module.exports = { features, fingerprint, fit, predict, train, guidance };
