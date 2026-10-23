'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { features, train, guidance, fingerprint } = require('../../src/services/engagementModel');
const rows = () => ['a','b','c'].flatMap((id,i) => [1,2].map(index => ({ id: `${i}-${index}`, sequence_id:id, delivered:100, clicked:10, features:{ tone:'Professional', subject_length:'short', cta:'linked' } })));
test('training requires multiple measured sequences and a minimum delivery count', () => {
  assert.throws(() => train(rows().slice(0,4)), /at least 6/);
  assert.throws(() => train(rows().map(row => ({ ...row,delivered:1,clicked:0 }))), /100 total deliveries/);
});
test('validated engagement guidance uses a sequence-level holdout and contains no raw content', () => {
  const result = train(rows());
  assert.equal(result.status,'validated');
  assert.equal(result.evaluation.training_records,4);
  assert.equal(result.evaluation.validation_records,2);
  assert.equal(result.evaluation.split,'held-out sequences');
  assert.ok(result.evaluation.candidate <= result.evaluation.baseline);
  assert.ok(guidance(result.model).suggestions[0].includes('up to 40 characters'));
  assert.deepEqual(Object.keys(result.model.groups),['tone','subject_length','cta']);
});
test('a candidate that underperforms the baseline is not eligible for activation', () => {
  const data = rows().map(row => ({ ...row,clicked: row.sequence_id === 'a' ? 90 : 10,features:{ ...row.features,tone:row.sequence_id === 'b' ? 'Formal' : 'Friendly' } }));
  const result = train(data);
  assert.equal(result.status,'needs_review');
  assert.equal(result.evaluation.passed,false);
});
test('dataset fingerprints are stable under reordering and change when outcomes change', () => {
  assert.equal(fingerprint(rows()),fingerprint(rows().reverse()));
  const changed = rows(); changed[0].clicked++;
  assert.notEqual(fingerprint(rows()),fingerprint(changed));
});
test('feature extraction excludes identifiers, copy, and notes', () => {
  assert.deepEqual(features({ tone:'Formal',emails:[{ subject:'Hello Alice',body:'Hello {{first_name}}. {{cta_link}}',private:'ignore' }] },1),{ tone:'Formal',subject_length:'short',cta:'linked' });
});
