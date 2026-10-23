'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runGuardrails } = require('../../src/agent/tools/guardrails');
const context = 'First month free. Refer a friend, earn $20 credit. No joining fee.';
const footer = '\n\nTo unsubscribe from these emails, reply STOP or click here.';
const email = body => [{ email_index:1, subject:'A useful introduction', body:body + footer }];
const hallucinations = result => result.flags.filter(flag => flag.check === 'HALLUCINATION');
test('Tenant A regression catches both invented codes, discount, scarcity and deadline', () => {
  const result = runGuardrails(email('Use code FIRSTMONTH or YOUNGPRO26. Save 10% off all services, first 10 sign-ups only, until tomorrow at midnight.'),context);
  assert.equal(result.passed,false);
  assert.ok(hallucinations(result).every(flag => flag.email_index === 1));
  assert.deepEqual(new Set(hallucinations(result).map(flag => flag.detail)),new Set(['Ungrounded: FIRSTMONTH','Ungrounded: YOUNGPRO26','Ungrounded: 10%','Ungrounded: first 10 sign-ups only','Ungrounded: until tomorrow at midnight']));
  assert.equal(hallucinations(result).length,5);
});
test('legitimate Tenant A copy and STOP footer pass', () => {
  assert.equal(runGuardrails(email('First month free. Refer a friend, earn $20 credit. No joining fee.'),context).passed,true);
});
test('percentages, dollar values, multipliers and codes fail closed without context', () => {
  for (const claim of ['10%','$20','2x','YOUNGPRO26','Use code FIRSTMONTH','Use code firstmonth']) {
    assert.ok(hallucinations(runGuardrails(email(claim))).length > 0,claim);
  }
});
test('matching formatting variants of supported commercial facts pass', () => {
  assert.equal(runGuardrails(email('Earn $ 20.00, save 10 %, and get 2X benefits. Use code FirstMonth.'),'Earn $20 credit. Save 10%. Get 2x benefits. Promo code FIRSTMONTH.').passed,true);
});
test('support requires a complete fact, not a substring of another amount or code', () => {
  for (const [claim,facts] of [['$2','$20'],['10%','110%'],['2x','12x'],['Use code SAVE20','Use code SAVE200'],['Use code FIRSTMONTH','Promo code EXTRAFIRSTMONTH'],['$9007199254740993','$9007199254740992'],['10.0000000000000001%','10%']]) {
    assert.ok(hallucinations(runGuardrails(email(claim),facts)).length > 0,claim);
  }
});
test('supported scarcity and deadline phrases pass; unsupported claims are flagged', () => {
  const claim = 'First 10 sign-ups only, until tomorrow at midnight.';
  assert.equal(runGuardrails(email(claim),claim).passed,true);
  assert.equal(hallucinations(runGuardrails(email(claim),context)).length,2);
});
test('duplicate facts within an email produce one grounding flag per unique fact', () => {
  assert.equal(hallucinations(runGuardrails(email('Use code FIRSTMONTH. FIRSTMONTH gives 10%. Save 10% today.'),context)).length,2);
});
test('missing and non-string context cannot silently disable grounding', () => {
  for (const value of [undefined,null,{},[]]) assert.equal(runGuardrails(email('Save 10%.'),value).passed,false);
});
test('opt-out instructions and denial of promo codes do not become invented code flags', () => {
  assert.equal(runGuardrails(email('No promo code required. There is no promo code available.'),context).passed,true);
});
test('relative expiry and qualitative scarcity in fresh model output cannot pass without context',() => {
  const claims = 'Your reserved cart will expire in 48 hours. Limited spots available.';
  assert.equal(hallucinations(runGuardrails(email(claims),context)).length,2);
  assert.equal(runGuardrails(email(claims),claims).passed,true);
  assert.equal(runGuardrails(email('We will follow up within 3 days. Book a 45-minute session.')).passed,true);
});
test('free service offers require matching knowledge, including the reverse first-session wording',() => {
  assert.equal(runGuardrails(email('Claim your free coaching session.'),'Your first session is free for new clients.').passed,true);
  assert.equal(runGuardrails(email('Get a free property valuation.'),'Free home valuation for sellers.').passed,true);
  assert.equal(hallucinations(runGuardrails(email('Claim your free session.'),'Sessions are 45 minutes.')).length,1);
  assert.equal(hallucinations(runGuardrails(email('Claim your free trial.'),'No free trial is available.')).length,1);
  assert.equal(runGuardrails(email('Enjoy your free time. You are free to contact us. No free trial is available.')).passed,true);
});
