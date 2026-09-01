#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJsonl = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const audit = readJsonl(path.join(ROOT, 'editorial/tahot-totht-coverage-audit.jsonl'));
const reviews = readJsonl(path.join(ROOT, 'editorial/tahot-totht-coverage-exception-review.jsonl'));
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/tahot-totht-coverage-exception-review.schema.json'), 'utf8'));
const ajv = new Ajv({allErrors:true,strict:true,validateSchema:false}); addFormats(ajv); const validate = ajv.compile(schema);
const expected = new Map(audit.filter((row) => row.status !== 'covered').map((row) => [row.candidate_id, row.status]));
const seen = new Set(); const errors = [];
for (const [index,row] of reviews.entries()) {
  if (!validate(row)) errors.push(`row ${index + 1}: ${ajv.errorsText(validate.errors)}`);
  if (seen.has(row.candidate_id)) errors.push(`duplicate ${row.candidate_id}`); seen.add(row.candidate_id);
  if (!expected.has(row.candidate_id)) errors.push(`review without exception ${row.candidate_id}`);
  else if (expected.get(row.candidate_id) !== row.audit_status) errors.push(`status mismatch ${row.candidate_id}`);
}
for (const candidateId of expected.keys()) if (!seen.has(candidateId)) errors.push(`missing review ${candidateId}`);
if (errors.length) throw new Error(`TAHOT/TOTHT exception review failed (${errors.length}):\n${errors.join('\n')}`);
console.log(`OK TAHOT/TOTHT exception review: ${reviews.length}/${expected.size}`);
