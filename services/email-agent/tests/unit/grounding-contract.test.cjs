'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildEmailPrompt, BRAND_CONTEXT_LINE } = require('../../src/agent/prompts/emailPrompt');
test('the training prompt contract passes the extracted brand context into live guardrails', () => {
  const context = 'First month free. Refer a friend, earn $20 credit. No joining fee.\n' + BRAND_CONTEXT_LINE;
  const prompt = buildEmailPrompt('Introduce our gym','New members',context);
  const fixture = body => ({ messages:[{ role:'user',content:prompt },{ role:'assistant',content:JSON.stringify({ emails:[0,3,7].map((day,index) => ({ email_index:index + 1,send_at_days:day,subject:'A useful introduction',body:body + '\nTo unsubscribe from these emails, reply STOP or click here.' })) }) }] });
  const result = spawnSync(process.execPath,[path.resolve(__dirname,'../../../../ml/email-agent/training/prompt_contract.cjs')],{ input:JSON.stringify([fixture('Refer a friend, earn $20 credit.'),fixture('Use code FIRSTMONTH for 10% off.')]),encoding:'utf8',windowsHide:true });
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).map(row => [row.prompt_matches_app,row.app_guardrails_pass]),[[true,true],[true,false]]);
});
