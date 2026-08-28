#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'cross-testament-identity-review.schema.json');
const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates.jsonl');
const IDENTITY_OPTIONS_PATH = path.join(ROOT, 'data', 'identity-options.jsonl');
const OUTPUT_PATH = path.join(EDITORIAL_DIR, 'cross-testament-identity-review.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'cross-testament-identity-review-report.json');
const MANIFEST_PATH = path.join(ROOT, 'data', 'manifest.json');

const SOURCE_ID = 'source:0002';

function parseArg(name, fallback = process.env[name.toUpperCase()]) {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const withEqual = `${key}=`;
  const found = args.find((item) => item.startsWith(withEqual));
  if (found) return found.slice(withEqual.length);
  const idx = args.indexOf(key);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return fallback;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at ${filePath}:${idx + 1}`);
      }
    });
}

function normalizeIdentityKey(raw) {
  return String(raw || '')
    .split('@')[0]
    .replace(/^\s*>\s*/, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function createPendingDecision() {
  return {
    status: 'pending',
    decision_action: null,
    target_person_id: null,
    canonical_chinese: null,
    reviewer: null,
    decision_note: '',
    reviewed_at: null
  };
}

function validateRows(rows, schema) {
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [index, row] of rows.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at cross-testament-identity-review:${index + 1}: ${details}`);
    }
  }
}

function computeHash(filePaths) {
  const hash = crypto.createHash('sha256');
  for (const filePath of filePaths.sort()) {
    hash.update(filePath);
    hash.update('\u0000');
    hash.update(fs.readFileSync(filePath));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function writeJsonl(filePath, rows) {
  const data = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${data}${rows.length > 0 ? '\n' : ''}`, 'utf8');
}

function writeReport(filePath, report) {
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function buildMatches(candidates, identityOptions, timestamp) {
  const optionIndex = new Map();
  for (const opt of identityOptions) {
    const key = normalizeIdentityKey(opt.identity_key);
    const rows = optionIndex.get(key) || [];
    rows.push({
      person_id: opt.person_id,
      identity_key: opt.identity_key,
      identity_scope: opt.identity_scope,
      status: opt.status,
      identity_note: opt.editor_note || ''
    });
    optionIndex.set(key, rows);
  }

  const relevant = candidates
    .filter((row) => (row.nt_ref_count || 0) > 0 && row.candidate_status === 'pending')
    .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));

  const rows = [];
  const unmatched = [];
  for (const candidate of relevant) {
    const normalizedCandidateKey = normalizeIdentityKey(candidate.step_identity_key);
    const matches = optionIndex.get(normalizedCandidateKey) || [];
    const exactMatchIds = matches.map((match) => match.person_id);
    if (exactMatchIds.length === 0) {
      unmatched.push(candidate.candidate_id);
    }
    rows.push({
      review_id: '',
      candidate_id: candidate.candidate_id,
      step_identity_key: candidate.step_identity_key,
      candidate_canonical_name: candidate.canonical_name,
      nt_ref_count: candidate.nt_ref_count,
      step_identity_matches: matches.map((match) => ({ ...match })),
      round1: createPendingDecision(),
      round2: createPendingDecision(),
      final_decision: createPendingDecision(),
      source_id: SOURCE_ID,
      created_at: timestamp,
      updated_at: timestamp,
      notes: exactMatchIds.length > 0
        ? `Exact STEP identity-key match(es): ${exactMatchIds.join(', ')}`
        : 'No exact STEP identity-key matches in identity-options'
    });
  }

  return { rows, unmatchedCount: unmatched.length };
}

function buildReport(rows, candidateCount, unmatchedCount) {
  return {
    generated_at: null,
    source_id: SOURCE_ID,
    manifest_created_at: null,
    input_candidate_count: candidateCount,
    snapshot_count: rows.length,
    unmatched_count: unmatchedCount,
    exact_match_count: rows.filter((row) => row.step_identity_matches.length > 0).length,
    with_matches: rows.filter((row) => row.step_identity_matches.length > 0).length,
    without_matches: rows.filter((row) => row.step_identity_matches.length === 0).length,
    output_path: path.relative(ROOT, OUTPUT_PATH),
    report_path: path.relative(ROOT, REPORT_PATH),
    note: 'Cross-testament identity snapshot remains pending for manual OT/NT identity linkage review.'
  };
}

function ensureManifestCreatedAt(manifest) {
  if (!manifest?.created_at) {
    throw new Error('data/manifest.json missing created_at');
  }
  if (Number.isNaN(Date.parse(manifest.created_at))) {
    throw new Error(`Invalid data/manifest.json created_at: ${manifest.created_at}`);
  }
  return manifest.created_at;
}

function compareRows(expectedRows, actualRows) {
  if (expectedRows.length !== actualRows.length) {
    throw new Error(`Snapshot row count mismatch: expected ${expectedRows.length}, actual ${actualRows.length}`);
  }
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = JSON.stringify(expectedRows[index]);
    const actual = JSON.stringify(actualRows[index]);
    if (expected !== actual) {
      throw new Error(`Snapshot row mismatch at line ${index + 1}`);
    }
  }
}

function buildReportChecksum(report, rows) {
  const rowsHash = crypto.createHash('sha256');
  for (const row of rows) {
    rowsHash.update(JSON.stringify(row));
    rowsHash.update('\n');
  }
  report.row_hash = rowsHash.digest('hex');
}

function validateDecision(decision, label, rowId) {
  if (!decision || typeof decision !== 'object') {
    throw new Error(`Missing ${label} decision object for ${rowId}`);
  }
  if (!['pending', 'accepted', 'rejected'].includes(decision.status)) {
    throw new Error(`Invalid ${label}.status for ${rowId}: ${decision.status}`);
  }
  if (decision.status === 'pending') {
    if (decision.decision_action !== null) {
      throw new Error(`Pending ${label}.decision_action must be null: ${rowId}`);
    }
    if (decision.target_person_id !== null || decision.canonical_chinese !== null || decision.reviewed_at !== null) {
      throw new Error(`Pending ${label} fields must remain null: ${rowId}`);
    }
    if (decision.reviewer !== null) {
      throw new Error(`Pending ${label}.reviewer must be null: ${rowId}`);
    }
  }
  if (decision.status === 'rejected') {
    if (decision.decision_action !== null || decision.target_person_id !== null || decision.canonical_chinese !== null) {
      throw new Error(`Rejected ${label} should not specify decision_action/target/canonical_chinese: ${rowId}`);
    }
    if (!decision.reviewer?.trim() || !decision.decision_note?.trim()) {
      throw new Error(`Rejected ${label} requires reviewer and decision_note: ${rowId}`);
    }
    if (!decision.reviewed_at || Number.isNaN(Date.parse(decision.reviewed_at))) {
      throw new Error(`Rejected ${label} requires reviewed_at: ${rowId}`);
    }
  }
  if (decision.status === 'accepted') {
    if (!decision.decision_action || !decision.canonical_chinese?.trim() || !decision.reviewer?.trim()) {
      throw new Error(`Accepted ${label} requires decision_action, canonical_chinese, reviewer: ${rowId}`);
    }
    if (!decision.reviewed_at || Number.isNaN(Date.parse(decision.reviewed_at)) || !decision.decision_note?.trim()) {
      throw new Error(`Accepted ${label} requires reviewed_at and decision_note: ${rowId}`);
    }
    if (decision.decision_action === 'merge_existing' && !decision.target_person_id) {
      throw new Error(`Accepted merge_existing ${label} requires target_person_id: ${rowId}`);
    }
    if (decision.decision_action === 'create_new' && decision.target_person_id !== null) {
      throw new Error(`Accepted create_new ${label} must not include target_person_id: ${rowId}`);
    }
  }
}

function validateSemanticRules(rows) {
  for (const row of rows) {
    for (const [label, decision] of [['round1', row.round1], ['round2', row.round2], ['final_decision', row.final_decision]]) {
      validateDecision(decision, label, row.candidate_id);
    }
    if (row.final_decision.status === 'accepted') {
      if (row.round1.status !== 'accepted' || row.round2.status !== 'accepted') {
        throw new Error(`Final accepted requires round1 and round2 accepted: ${row.candidate_id}`);
      }
      if (row.final_decision.decision_action !== row.round1.decision_action || row.final_decision.decision_action !== row.round2.decision_action) {
        throw new Error(`Final accepted action mismatch: ${row.candidate_id}`);
      }
      if (row.final_decision.canonical_chinese !== row.round1.canonical_chinese || row.final_decision.canonical_chinese !== row.round2.canonical_chinese) {
        throw new Error(`Final accepted canonical_chinese mismatch: ${row.candidate_id}`);
      }
      if (row.final_decision.target_person_id !== row.round1.target_person_id || row.final_decision.target_person_id !== row.round2.target_person_id) {
        throw new Error(`Final accepted target_person_id mismatch: ${row.candidate_id}`);
      }
    }
  }
}

function main() {
  const validateOnly = process.argv.includes('--validate-only');
  const outputPath = parseArg('output', OUTPUT_PATH);
  const reportPath = parseArg('report', REPORT_PATH);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const candidates = readJsonl(CANDIDATES_PATH);
  const identityOptions = readJsonl(IDENTITY_OPTIONS_PATH);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const timestamp = ensureManifestCreatedAt(manifest);

  const { rows, unmatchedCount } = buildMatches(candidates, identityOptions, timestamp);
  rows.forEach((row, index) => {
    row.review_id = `ctir-${String(index + 1).padStart(4, '0')}`;
  });

  const report = buildReport(rows, candidates.length, unmatchedCount);
  report.manifest_created_at = timestamp;
  report.generated_at = timestamp;
  buildReportChecksum(report, rows);
  report.output_checksum = undefined;
  if (fs.existsSync(outputPath)) {
    report.output_checksum = computeHash([outputPath]);
  }
  if (validateOnly) {
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Missing snapshot file: ${outputPath}`);
    }
    if (!fs.existsSync(reportPath)) {
      throw new Error(`Missing report file: ${reportPath}`);
    }

  const actualRows = readJsonl(outputPath);
  const actualReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  validateRows(actualRows, schema);
  validateSemanticRules(actualRows);
  compareRows(rows, actualRows);

    const actualChecksum = computeHash([outputPath]);
    if (actualReport.output_checksum !== report.output_checksum && report.output_checksum !== undefined) {
      if (actualReport.output_checksum !== actualChecksum) {
        throw new Error(`Report output_checksum mismatch: expected ${actualChecksum} got ${actualReport.output_checksum}`);
      }
    }
    if (actualReport.generated_at !== report.generated_at) {
      throw new Error(`Report generated_at mismatch: expected ${report.generated_at} got ${actualReport.generated_at}`);
    }
    if (actualReport.input_candidate_count !== report.input_candidate_count || actualReport.snapshot_count !== report.snapshot_count) {
      throw new Error('Report counts mismatch');
    }
    if (actualReport.unmatched_count !== report.unmatched_count || actualReport.with_matches !== report.with_matches || actualReport.without_matches !== report.without_matches || actualReport.exact_match_count !== report.exact_match_count) {
      throw new Error('Report match-metric mismatch');
    }
    if (actualReport.row_hash !== report.row_hash) {
      throw new Error(`Report row_hash mismatch: expected ${report.row_hash} got ${actualReport.row_hash}`);
    }
    if (actualReport.source_id !== report.source_id) {
      throw new Error(`Report source_id mismatch: expected ${report.source_id} got ${actualReport.source_id}`);
    }
    if (actualReport.manifest_created_at !== report.manifest_created_at) {
      throw new Error(`Report manifest_created_at mismatch: expected ${report.manifest_created_at} got ${actualReport.manifest_created_at}`);
    }
    if (actualReport.output_path !== report.output_path || actualReport.report_path !== report.report_path) {
      throw new Error('Report path metadata mismatch');
    }

    return;
  }

  writeJsonl(outputPath, rows);
  writeReport(reportPath, report);
  report.output_checksum = computeHash([outputPath]);
  writeReport(reportPath, report);
  const writtenRows = readJsonl(outputPath);
  validateRows(writtenRows, schema);
  validateSemanticRules(writtenRows);
  console.log(`generated cross-testament identity snapshot: ${rows.length} rows`);
}

main();
