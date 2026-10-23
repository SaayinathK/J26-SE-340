import test from 'node:test';
import assert from 'node:assert/strict';
import { flaggedSegments } from '../src/features/email/lib/guardrailPreview.js';
test('preview highlights whole affected sentences without moving saved offsets or touching safe facts',() => {
  const value = 'Hello {{first_name}}. Earn $20 credit. Use code FIRSTMONTH.\nExplore our services.';
  const start = value.indexOf('FIRSTMONTH');
  const flags = [{email_index:1,detail:'Ungrounded: FIRSTMONTH',occurrences:[{field:'body',start,end:start+10}]}];
  const result = flaggedSegments(value,flags,1,'body');
  assert.equal(result.map(item => item.text).join(''),value);
  assert.deepEqual(result.filter(item => item.reasons.length).map(item => item.text),[' Use code FIRSTMONTH.']);
  assert.equal(flaggedSegments(value,flags,2,'body').some(item => item.reasons.length),false);
  assert.equal(flaggedSegments(value,flags,1,'subject').some(item => item.reasons.length),false);
});
