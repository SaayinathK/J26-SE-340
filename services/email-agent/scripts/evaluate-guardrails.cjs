'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runGuardrails } = require('../src/agent/tools/guardrails');
const fixture = require('../tests/fixtures/c4-09-cases.json');
const limitation = 'pattern-based; numeric, code, scarcity and deadline claims are verified against tenant knowledge; qualitative claims (e.g. ‘certified coaches’) are not verified and are covered by human review before approval.';
function evaluate() {
  const cases = fixture.cases.map(item => {
    const { flags } = runGuardrails([item.email],fixture.context);
    return { id:item.id,label:item.label,expected_checks:item.expected_checks,detected_checks:[...new Set(flags.map(flag => flag.check))],flags };
  });
  const planted = cases.filter(item => item.label === 'planted');
  const clean = cases.filter(item => item.label === 'clean');
  const caught = planted.filter(item => item.expected_checks.every(check => item.detected_checks.includes(check))).length;
  const falsePositives = clean.filter(item => item.flags.length > 0).length;
  return { provenance:fixture.provenance,scope:'20 manually authored emails; recall requires every planted check type in each problem email to be detected. Clean cases fail if any check flags them.', metrics:{ total:cases.length,planted:planted.length,clean:clean.length,caught,missed:planted.length-caught,recall:caught/planted.length,false_positives:falsePositives,false_positive_rate:falsePositives/clean.length },limitation,cases };
}
if (require.main === module) {
  const result = evaluate();
  const output = path.resolve(process.argv[2] || path.join(__dirname,'../../../docs/evidence/c4-09'));
  fs.mkdirSync(output,{ recursive:true });
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2) + '\n');
  const m = result.metrics;
  fs.writeFileSync(path.join(output,'README.md'),`# C4-09 guardrail evidence\n\n${result.provenance}\n\n| Measure | Result |\n| --- | --- |\n| Planted problems detected | ${m.caught}/${m.planted} |\n| Recall | ${m.recall * 100}% |\n| Clean emails flagged | ${m.false_positives}/${m.clean} |\n| False positive rate | ${m.false_positive_rate * 100}% |\n\nRecall requires every expected check type in a planted email to be detected. These small, hand-authored cases demonstrate the implementation; they do not establish production accuracy or fine-tuned model accuracy. See [case-level results](results.json) and the source fixture for exact inputs.\n\nRun from the repository root: \`node services/email-agent/scripts/evaluate-guardrails.cjs\`.\n\nGeneration retries once on hallucination flags, using the same retrieved knowledge snapshot and sharing a 90-second model budget. A usable draft returns HTTP 200 even if flags remain; a failed retry preserves the previous usable draft. Draft saves return updated flags. Approval rechecks current tenant knowledge and returns HTTP 422 for unresolved flags. Sending is not connected. The model has not been retrained by this change.\n\n${limitation}\n\n## Replay provenance\n\nThe FIRSTMONTH replay is reconstructed from the five claims reported by the user, not an archived raw model response. A screenshot of that replay is clearly labelled in the campaign brief. An original raw response is still needed to present this as captured real model output.\n`);
  fs.appendFileSync(path.join(output,'README.md'),'\n[Replay screenshot](replay.png) · [Workflow replay results](replay.json) · [20-email source fixture](../../../services/email-agent/tests/fixtures/c4-09-cases.json)\n\nTo regenerate the browser evidence with installed local dependencies and PostgreSQL available, run `npm --prefix frontend run build`, then `node tests/e2e/verify-service-flow.cjs --guardrail-only`. The runner creates and removes only its own temporary databases.\n');
  console.log(JSON.stringify(result.metrics));
  if (m.missed || m.false_positives) process.exitCode = 1;
}
module.exports = { evaluate };
