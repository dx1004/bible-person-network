#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_PATH = path.join(ROOT, 'editorial', 'source-access-review.jsonl');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'source-access-review.schema.json');
const VERIFY_LOCAL = process.argv.includes('--verify-local');
const SOURCES_ROOT = path.resolve(ROOT, '.sources');

function resolveSourcePath(localPath) {
  const resolved = path.resolve(ROOT, localPath);
  if (!resolved.startsWith(`${SOURCES_ROOT}${path.sep}`)) throw new Error(`source path escapes .sources: ${localPath}`);
  return resolved;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`${filePath}:${index + 1}: invalid JSON`); }
  });
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const rows = readJsonl(REVIEW_PATH);
const errors = [];
const expectedIds = new Set(['source:0006', 'source:0007', 'source:0008', 'source:0009']);
const seen = new Set();

for (const [index, row] of rows.entries()) {
  if (!validate(row)) {
    for (const error of validate.errors || []) errors.push(`row ${index + 1}${error.instancePath}: ${error.message}`);
  }
  if (seen.has(row.source_id)) errors.push(`duplicate source ${row.source_id}`);
  seen.add(row.source_id);
  if (!expectedIds.has(row.source_id)) errors.push(`unexpected source ${row.source_id}`);

  const isPublic = row.license_status === 'verified_public_domain';
  if (isPublic && row.access_status !== 'locked_public_download') errors.push(`${row.source_id}: public-domain source must be locked`);
  if (isPublic && !row.files?.length) errors.push(`${row.source_id}: locked public-domain source must record files`);
  if (!isPublic && row.files?.length) errors.push(`${row.source_id}: restricted source must not record full-text files`);
  if (!isPublic && row.full_text_in_git !== false) errors.push(`${row.source_id}: restricted full text must not be stored in Git`);
  if (row.systematic_review_status === 'completed' && row.access_status === 'member_catalog_unverified') {
    errors.push(`${row.source_id}: systematic review cannot complete before member access is verified`);
  }

  const resolvedFiles = new Map();
  for (const file of row.files || []) {
    try { resolvedFiles.set(file.local_path, resolveSourcePath(file.local_path)); }
    catch (error) { errors.push(`${row.source_id}: ${error.message}`); }
  }

  if (VERIFY_LOCAL) {
    for (const file of row.files || []) {
      const localPath = resolvedFiles.get(file.local_path);
      if (!localPath) continue;
      if (!fs.existsSync(localPath)) { errors.push(`${row.source_id}: missing ${file.local_path}`); continue; }
      const stat = fs.statSync(localPath);
      if (stat.size !== file.bytes) errors.push(`${row.source_id}: byte mismatch ${file.local_path}`);
      const lineCount = fs.readFileSync(localPath, 'utf8').split(/\n/).length - 1;
      if (lineCount !== file.line_count) errors.push(`${row.source_id}: line-count mismatch ${file.local_path}`);
      if (sha256(localPath) !== file.sha256) errors.push(`${row.source_id}: SHA-256 mismatch ${file.local_path}`);
    }
  }
}

for (const sourceId of expectedIds) if (!seen.has(sourceId)) errors.push(`missing source ${sourceId}`);
if (errors.length) throw new Error(`source access review failed (${errors.length}):\n${errors.join('\n')}`);

const summary = Object.fromEntries(rows.map((row) => [row.source_id, {
  access: row.access_status,
  license: row.license_status,
  systematicReview: row.systematic_review_status,
  files: row.files.length
}]));
console.log(JSON.stringify({ status: 'ok', verifyLocal: VERIFY_LOCAL, sources: summary }, null, 2));
