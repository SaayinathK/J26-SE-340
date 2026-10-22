import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCRM,CRM_COLUMNS} from '../src/services/crmResearch.js';
const header=CRM_COLUMNS.join(',');
test('imports quoted commas, escaped quotes, and multiline CRM findings',()=>{
 const data=parseCRM(header+'\r\nReport,2026-01-01,12,Students,"Needs practice, especially "+"""Java"""+"\nexamples",Small sample'.replaceAll('"+"',''));
 assert.equal(data[0].sample_size,12);assert.ok(data[0].finding.includes('Needs practice,'));
});
test('rejects raw-contact headers, malformed rows, and nonnumeric sample size',()=>{
 assert.throws(()=>parseCRM('name,email\nA,a@example.com'),/columns/);
 assert.throws(()=>parseCRM(header+'\nReport,2026-01-01,many,Students,Finding,Limits'),/whole number/);
 assert.throws(()=>parseCRM(header+'\n"unclosed'),/Unclosed/);
});
