'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../../scripts/evaluate-guardrails.cjs');
test('C4-09: planted problems are caught and authorized facts or neutral numbers stay clean',() => {
  const report = evaluate();
  assert.deepEqual(report.metrics,{ total:20,planted:10,clean:10,caught:10,missed:0,recall:1,false_positives:0,false_positive_rate:0 });
  for (const item of report.cases) assert.deepEqual(item.detected_checks.sort(),item.expected_checks.sort(),item.id);
});
