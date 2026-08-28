#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const DATA_DIR = path.join(ROOT, 'data');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'old-testament-person-review.schema.json');
const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates.jsonl');
const REVIEWS_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-review.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-review-report.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const SOURCE_ID = 'source:0002';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force'),
    validateOnly: args.includes('--validate-only')
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}`);
      }
    });
}

function validateRows(rows, schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [idx, row] of rows.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at old-testament-person-review:${idx + 1}: ${details}`);
    }
  }
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

function buildReviewRows(candidates, timestamp) {
  const rows = candidates.map((candidate, index) => ({
    review_id: `otpr-${String(index + 1).padStart(4, '0')}`,
    candidate_id: candidate.candidate_id,
    step_identity_key: candidate.step_identity_key,
    candidate_status: 'pending',
    canonical_chinese: null,
    source_id: SOURCE_ID,
    round1: createPendingDecision(),
    round2: createPendingDecision(),
    final_decision: createPendingDecision(),
    created_at: timestamp,
    updated_at: timestamp,
    notes: 'Pending two-round OT identity review.'
  }));

  return rows;
}

function validateSemanticRules(reviews, candidates) {
  const candidateSet = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const seenCandidates = new Set();
  for (const row of reviews) {
    if (seenCandidates.has(row.candidate_id)) {
      throw new Error(`Duplicate candidate_id in review rows: ${row.candidate_id}`);
    }
    seenCandidates.add(row.candidate_id);
    const candidate = candidateSet.get(row.candidate_id);
    if (!candidate) {
      throw new Error(`Unknown candidate_id in review file: ${row.candidate_id}`);
    }
    for (const [name, decision] of [['round1', row.round1], ['round2', row.round2], ['final_decision', row.final_decision]]) {
      if (!decision || typeof decision !== 'object') {
        throw new Error(`Missing ${name} object for ${row.candidate_id}`);
      }

      if (!['pending', 'accepted', 'rejected'].includes(decision.status)) {
        throw new Error(`${name} status invalid for ${row.candidate_id}: ${decision.status}`);
      }
      if (decision.status === 'pending') {
        if (decision.decision_action !== null) {
          throw new Error(`Pending ${name}.decision_action must be null: ${row.candidate_id}`);
        }
        if (decision.target_person_id !== null || decision.canonical_chinese !== null) {
          throw new Error(`Pending ${name} fields must remain null: ${row.candidate_id}`);
        }
        if (decision.reviewer !== null) {
          throw new Error(`Pending ${name}.reviewer must be null: ${row.candidate_id}`);
        }
        if (decision.reviewed_at !== null) {
          throw new Error(`Pending ${name}.reviewed_at must be null: ${row.candidate_id}`);
        }
      }

      if (decision.status === 'rejected') {
        if (decision.decision_action !== null || decision.target_person_id !== null || decision.canonical_chinese !== null) {
          throw new Error(`Rejected ${name} should not specify decision_action/target/canonical_chinese: ${row.candidate_id}`);
        }
        if (!decision.reviewer?.trim()) {
          throw new Error(`Rejected ${name} requires reviewer: ${row.candidate_id}`);
        }
        if (!decision.decision_note.trim()) {
          throw new Error(`Rejected ${name} requires decision_note: ${row.candidate_id}`);
        }
        if (!decision.reviewed_at || Number.isNaN(Date.parse(decision.reviewed_at))) {
          throw new Error(`Rejected ${name} requires reviewed_at: ${row.candidate_id}`);
        }
      }

      if (decision.status === 'accepted') {
        if (!decision.decision_action) {
          throw new Error(`Accepted ${name} requires decision_action: ${row.candidate_id}`);
        }
        if (!decision.canonical_chinese?.trim()) {
          throw new Error(`Accepted ${name} requires canonical_chinese: ${row.candidate_id}`);
        }
        if (!decision.reviewer?.trim()) {
          throw new Error(`Accepted ${name} requires reviewer: ${row.candidate_id}`);
        }
        if (!decision.reviewed_at || Number.isNaN(Date.parse(decision.reviewed_at))) {
          throw new Error(`Accepted ${name} requires reviewed_at: ${row.candidate_id}`);
        }
        if (!decision.decision_note.trim()) {
          throw new Error(`Accepted ${name} requires decision_note: ${row.candidate_id}`);
        }
        if (decision.decision_action === 'merge_existing') {
          if (!decision.target_person_id) {
            throw new Error(`Accepted merge_existing ${name} requires target_person_id: ${row.candidate_id}`);
          }
        }
        if (decision.decision_action === 'create_new' && decision.target_person_id !== null) {
          throw new Error(`Accepted create_new ${name} must not include target_person_id: ${row.candidate_id}`);
        }
      }
    }

    if (row.final_decision.status === 'accepted') {
      if (row.round1.status !== 'accepted' || row.round2.status !== 'accepted') {
        throw new Error(`Final accepted requires round1 and round2 accepted: ${row.candidate_id}`);
      }
      if (row.final_decision.decision_action !== row.round2.decision_action || row.final_decision.decision_action !== row.round1.decision_action) {
        throw new Error(`Final accepted must match round2 and round1 action: ${row.candidate_id}`);
      }
      if (row.final_decision.canonical_chinese !== row.round2.canonical_chinese || row.final_decision.canonical_chinese !== row.round1.canonical_chinese) {
        throw new Error(`Final accepted must match round2 and round1 canonical_chinese: ${row.candidate_id}`);
      }
      if (row.final_decision.target_person_id !== row.round2.target_person_id || row.final_decision.target_person_id !== row.round1.target_person_id) {
        throw new Error(`Final accepted must match round2 and round1 target_person_id: ${row.candidate_id}`);
      }
      if (!row.final_decision.decision_note.trim()) {
        throw new Error(`Final accepted must include decision_note: ${row.candidate_id}`);
      }
    }
  }

  if (reviews.length !== candidates.length) {
    throw new Error(`Review count mismatch: ${reviews.length} rows, expected ${candidates.length}`);
  }
}

function buildReport(rows, inputCount, reportPath) {
  const createdAt = rows[0]?.created_at || new Date().toISOString();
  return {
    generated_at: createdAt,
    review_rows: rows.length,
    candidate_rows: inputCount,
    source_id: SOURCE_ID,
    report_path: path.relative(ROOT, reportPath),
    output_path: path.relative(ROOT, REVIEWS_PATH),
    pending: rows.filter((row) => row.final_decision.status === 'pending').length
  };
}

function runValidateOnly() {
  const reviews = readJsonl(REVIEWS_PATH);
  const candidates = readJsonl(CANDIDATES_PATH);
  validateRows(reviews, SCHEMA_PATH);
  validateSemanticRules(reviews, candidates);
  console.log(`OK validate:old-testament-person-review (${reviews.length} rows)`);
}

function main() {
  const args = parseArgs();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const timestamp = manifest.created_at;
  const candidates = readJsonl(CANDIDATES_PATH);

  if (args.validateOnly) {
    runValidateOnly();
    return;
  }

  if (fs.existsSync(REVIEWS_PATH) && !args.force) {
    throw new Error(`Review file already exists: ${REVIEWS_PATH}. Use --force to overwrite if intentional.`);
  }

  const reviews = buildReviewRows(candidates, timestamp);
  validateRows(reviews, SCHEMA_PATH);
  validateSemanticRules(reviews, candidates);

  const report = buildReport(reviews, candidates.length, REPORT_PATH);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(REVIEWS_PATH, `${reviews.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

main();
