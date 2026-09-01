#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_PATH = path.join(ROOT, 'editorial', 'source-access-review.jsonl');
const ANCHOR_ENV_AUDIT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-environment-audit.json');
const ANCHOR_OCR_ACCESS_AUDIT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-ocr-access-audit.json');
const ISBE_COVERAGE_REPORT_PATH = path.join(ROOT, 'editorial', 'isbe-1915-coverage-review-report.json');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'source-access-review.schema.json');
const VERIFY_LOCAL = process.argv.includes('--verify-local');
const REQUIRE_COMPLETE = process.argv.includes('--require-complete');
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
const expectedIds = new Set(['source:0006', 'source:0007', 'source:0008', 'source:0009', 'source:0010']);
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
  const reviewableAccess = new Set([
    'locked_public_download',
    'official_temporary_access_verified',
    'controlled_digital_lending_verified',
    'member_access_verified',
  ]);
  if (row.systematic_review_status !== 'not_started' && !reviewableAccess.has(row.access_status)) {
    errors.push(`${row.source_id}: systematic review cannot start before approved access is verified`);
  }
  if (REQUIRE_COMPLETE && row.release_required !== false && row.systematic_review_status !== 'completed') {
    errors.push(`${row.source_id}: systematic review must be completed for release`);
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

const anchorRow = rows.find((row) => row.source_id === 'source:0009');
const isbeRow = rows.find((row) => row.source_id === 'source:0010');
if (isbeRow?.systematic_review_status === 'completed') {
  if (!fs.existsSync(ISBE_COVERAGE_REPORT_PATH)) {
    errors.push('source:0010: missing ISBE coverage report while review is completed');
  } else {
    try {
      const report = JSON.parse(fs.readFileSync(ISBE_COVERAGE_REPORT_PATH, 'utf8'));
      if (report.source_id !== 'source:0010' || report.status !== 'completed_coverage_audit' || report.candidate_count !== 2720) errors.push('source:0010: invalid completed coverage report');
      if (report.relationship_evidence_retained !== 0 || report.copyright_boundary?.source_text_stored !== false) errors.push('source:0010: coverage boundary mismatch');
    } catch (error) { errors.push(`source:0010: invalid coverage report: ${error.message}`); }
  }
}
if (anchorRow?.systematic_review_status === 'in_progress') {
  if (!fs.existsSync(ANCHOR_ENV_AUDIT_PATH)) {
    errors.push('source:0009: missing environment audit while review is in_progress');
  } else {
    try {
      const audit = JSON.parse(fs.readFileSync(ANCHOR_ENV_AUDIT_PATH, 'utf8'));
      if (audit.source_id !== 'source:0009') errors.push('source:0009: environment audit source_id mismatch');
      if (!['environment_blocked', 'environment_partially_mitigated'].includes(audit.status)) {
        errors.push('source:0009: environment audit status is invalid');
      }
      if (!audit.environment_fault?.category || !audit.environment_fault?.recommended_action) {
        errors.push('source:0009: environment audit is missing fault classification or recovery action');
      }
      if (audit.verified?.source_text_stored !== false || audit.verified?.screenshots_stored !== false) {
        errors.push('source:0009: environment audit must preserve the restricted-content boundary');
      }
    } catch (error) {
      errors.push(`source:0009: invalid environment audit: ${error.message}`);
    }
  }

  if (!fs.existsSync(ANCHOR_OCR_ACCESS_AUDIT_PATH)) {
    errors.push('source:0009: missing OCR access audit while review is in_progress');
  } else {
    try {
      const ocrAudit = JSON.parse(fs.readFileSync(ANCHOR_OCR_ACCESS_AUDIT_PATH, 'utf8'));
      if (ocrAudit.source_id !== 'source:0009') errors.push('source:0009: OCR access audit source_id mismatch');
      if (ocrAudit.status !== 'access_verified_scan_pending') errors.push('source:0009: OCR access audit status mismatch');
      if (ocrAudit.active_volume_loans !== 6 || ocrAudit.volumes?.length !== 6) {
        errors.push('source:0009: OCR access audit must cover six active volume loans');
      }
      if (ocrAudit.volumes?.some((volume) => volume.ocr_access_verified !== true || volume.scan_page_max < 1)) {
        errors.push('source:0009: OCR access audit contains an unverified volume');
      }
      if (
        ocrAudit.verified?.source_text_stored !== false
        || ocrAudit.verified?.snippets_stored !== false
        || ocrAudit.verified?.screenshots_stored !== false
      ) {
        errors.push('source:0009: OCR access audit must preserve restricted-content boundary');
      }
      if (!ocrAudit.environment_fault?.category || !ocrAudit.environment_fault?.recommended_action) {
        errors.push('source:0009: OCR access audit missing fault classification or recovery action');
      }
    } catch (error) {
      errors.push(`source:0009: invalid OCR access audit: ${error.message}`);
    }
  }
}
if (errors.length) throw new Error(`source access review failed (${errors.length}):\n${errors.join('\n')}`);

const summary = Object.fromEntries(rows.map((row) => [row.source_id, {
  access: row.access_status,
  license: row.license_status,
  systematicReview: row.systematic_review_status,
  files: row.files.length
}]));
console.log(JSON.stringify({ status: 'ok', verifyLocal: VERIFY_LOCAL, requireComplete: REQUIRE_COMPLETE, sources: summary }, null, 2));
