#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

const NAMES_PATH = path.join(DATA_DIR, 'names.jsonl');
const REVIEWS_PATH = path.join(EDITORIAL_DIR, 'name-review.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'name-review-report.json');
const SCHEMA_PATH = path.join(SCHEMAS_DIR, 'name-review.schema.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const INPUTS = {
  round1: '/private/tmp/bible-name-review-round-a.jsonl',
  round2: '/private/tmp/bible-name-review-round-b.jsonl'
};

const REVIEW_ROLES = {
  round1: { reviewer_role_id: 'editorial_a', reviewer_model_id: 'gpt-5.6-sol', reviewer_prompt_version: 'name-review-editorial-v1' },
  round2: { reviewer_role_id: 'critic_b', reviewer_model_id: 'gpt-5.5', reviewer_prompt_version: 'name-review-critic-v1' },
  final_decision: { reviewer_role_id: 'boardroom_adjudicator', reviewer_model_id: 'gpt-5.6-terra', reviewer_prompt_version: 'name-review-boardroom-v1' }
};

const SOURCE_ID = 'source:0005';
const REVIEW_TIMESTAMP = '2026-08-31T00:00:00Z';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    validateOnly: args.includes('--validate-only'),
    force: args.includes('--force')
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

function readText(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeInputRow(row, expectedReviewerMode, sourceLabel) {
  if (!row || typeof row !== 'object') {
    throw new Error(`Invalid row in ${sourceLabel}`);
  }
  const { name_id, person_id, decision, reason, evidence_refs, reviewer_mode } = row;
  if (typeof name_id !== 'string' || !/^name-\d{4}$/.test(name_id)) {
    throw new Error(`Invalid name_id in ${sourceLabel}`);
  }
  if (typeof person_id !== 'string' || !person_id) {
    throw new Error(`Invalid person_id for ${name_id}`);
  }
  if (decision !== 'accepted' && decision !== 'rejected') {
    throw new Error(`Invalid decision for ${name_id}`);
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error(`Missing reason for ${name_id}`);
  }
  if (!Array.isArray(evidence_refs) || evidence_refs.length === 0) {
    throw new Error(`Missing evidence_refs for ${name_id}`);
  }
  if (!evidence_refs.every((ref) => typeof ref === 'string' && ref.trim())) {
    throw new Error(`Invalid evidence_refs for ${name_id}`);
  }
  if (reviewer_mode !== expectedReviewerMode) {
    throw new Error(`Unexpected reviewer_mode for ${name_id}: ${reviewer_mode}`);
  }
  return { name_id, person_id, decision, reason: reason.trim(), evidence_refs: evidence_refs.map((ref) => ref.trim()).sort() };
}

function buildSnapshots() {
  const round1Raw = readText(INPUTS.round1).trim();
  const round2Raw = readText(INPUTS.round2).trim();
  return {
    round1: { path: INPUTS.round1, line_count: round1Raw.split('\n').length, sha256: sha256Text(round1Raw) },
    round2: { path: INPUTS.round2, line_count: round2Raw.split('\n').length, sha256: sha256Text(round2Raw) }
  };
}

function computeSignature(rounds, reviewedNameIds) {
  const canonical = {
    round1: rounds.round1.sha256,
    round2: rounds.round2.sha256,
    reviewed_name_ids: reviewedNameIds
  };
  return sha256Text(JSON.stringify(canonical));
}

function makeFinalDecision(round1Row, round2Row) {
  const sameStatus = round1Row.decision === round2Row.decision;
  const finalStatus = sameStatus ? round1Row.decision : 'pending';
  const finalReason = sameStatus
    ? (round1Row.name_id === 'name-0470'
      ? 'Rejected as textual-variant identity leakage for unresolved homonym ambiguity.'
      : round1Row.reason)
    : `Round disagreement: round1=${round1Row.decision}, round2=${round2Row.decision}`;
  const finalEvidence = sameStatus
    ? [...new Set([...round1Row.evidence_refs, ...round2Row.evidence_refs])].sort()
    : [];
  return { finalStatus, finalReason, finalEvidence };
}

function validateRows(rows, schema) {
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [index, row] of rows.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || []).map((error) => `${error.instancePath || error.dataPath}: ${error.message}`).join('; ');
      throw new Error(`Schema validation failed at name-review:${index + 1}: ${details}`);
    }
  }
}

function validateCrossChecks(rows, namesById, snapshots, signature) {
  const reviewedIds = new Set(rows.map((row) => row.name_id));
  for (const row of rows) {
    const sourceName = namesById.get(row.name_id);
    if (!sourceName) throw new Error(`Missing source name ${row.name_id}`);
    if (sourceName.person_id !== row.person_id) {
      throw new Error(`Person mismatch for ${row.name_id}: ${sourceName.person_id} vs ${row.person_id}`);
    }
    if (row.round1.status !== row.round2.status || row.final_decision.status !== row.round1.status) {
      throw new Error(`Round mismatch for ${row.name_id}`);
    }
    if (row.name_id === 'name-0470' && !row.final_decision.decision_reason.includes('textual-variant identity leakage')) {
      throw new Error('name-0470 must be rejected as textual-variant identity leakage');
    }
    if (!row.snapshot || row.snapshot.signature !== signature) {
      throw new Error(`Snapshot signature mismatch for ${row.name_id}`);
    }
    if (row.snapshot.round1_input.sha256 !== snapshots.round1.sha256 || row.snapshot.round2_input.sha256 !== snapshots.round2.sha256) {
      throw new Error(`Round snapshot hash mismatch for ${row.name_id}`);
    }
    if (!row.snapshot.reviewed_name_ids.every((id) => reviewedIds.has(id))) {
      throw new Error(`Snapshot name-id set mismatch for ${row.name_id}`);
    }
  }
  if (rows.length !== reviewedIds.size) {
    throw new Error('Duplicate name_id in generated review file');
  }
}

function validateSingleReview(row, round1Row, round2Row) {
  if (round1Row.decision === 'pending' || round2Row.decision === 'pending') {
    throw new Error(`Round decisions should be accepted/rejected for ${row.name_id}`);
  }
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

function writeReport(filePath, reviewRows, snapshots, signature) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const report = {
    generated_at: new Date().toISOString(),
    source_id: SOURCE_ID,
    review_rows: reviewRows.length,
    signature,
    accepted: reviewRows.filter((row) => row.final_decision.status === 'accepted').length,
    rejected: reviewRows.filter((row) => row.final_decision.status === 'rejected').length,
    pending: reviewRows.filter((row) => row.final_decision.status === 'pending').length,
    round1: snapshots.round1,
    round2: snapshots.round2,
    manifest_created_at: manifest.created_at,
    output_path: path.relative(ROOT, REVIEWS_PATH).replace(/\\/g, '/')
  };
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

function main() {
  const { validateOnly, force } = parseArgs();
  const namesRows = readJsonl(NAMES_PATH);
  const namesById = new Map(namesRows.map((row) => [row.name_id, row]));
  const round1Rows = readJsonl(INPUTS.round1).map((row) => normalizeInputRow(row, 'editorial', INPUTS.round1));
  const round2Rows = readJsonl(INPUTS.round2).map((row) => normalizeInputRow(row, 'critic', INPUTS.round2));

  if (round1Rows.length !== 138 || round2Rows.length !== 138) {
    throw new Error(`Expected 138 decisions per round, got ${round1Rows.length}/${round2Rows.length}`);
  }

  const round1ByName = new Map();
  const round2ByName = new Map();
  for (const row of round1Rows) {
    if (round1ByName.has(row.name_id)) throw new Error(`Duplicate name_id in round1: ${row.name_id}`);
    round1ByName.set(row.name_id, row);
  }
  for (const row of round2Rows) {
    if (round2ByName.has(row.name_id)) throw new Error(`Duplicate name_id in round2: ${row.name_id}`);
    round2ByName.set(row.name_id, row);
  }

  const allNameIds = [...round1ByName.keys()].sort();
  if (allNameIds.length !== 138) {
    throw new Error(`Expected 138 unique names in round1, got ${allNameIds.length}`);
  }
  for (const nameId of allNameIds) {
    if (!round2ByName.has(nameId)) throw new Error(`Missing round2 name_id: ${nameId}`);
    const r1 = round1ByName.get(nameId);
    const r2 = round2ByName.get(nameId);
    if (r1.person_id !== r2.person_id) throw new Error(`Person mismatch for ${nameId}`);
    if (!namesById.has(nameId)) throw new Error(`Missing source name in names.jsonl: ${nameId}`);
  }

  const snapshots = buildSnapshots();
  const signature = computeSignature(snapshots, allNameIds);

  const reviewRows = allNameIds.map((nameId, index) => {
    const round1Row = round1ByName.get(nameId);
    const round2Row = round2ByName.get(nameId);
    const sourceName = namesById.get(nameId);
    const { finalStatus, finalReason, finalEvidence } = makeFinalDecision(round1Row, round2Row);

    const row = {
      review_id: `nr-${String(index + 1).padStart(4, '0')}`,
      name_id: nameId,
      person_id: sourceName.person_id,
      name_text: sourceName.name_text,
      round1: {
        status: round1Row.decision,
        reviewer: 'editorial_a',
        decision_reason: round1Row.reason,
        evidence_refs: round1Row.evidence_refs,
        reviewed_at: REVIEW_TIMESTAMP
      },
      round2: {
        status: round2Row.decision,
        reviewer: 'critic_b',
        decision_reason: round2Row.reason,
        evidence_refs: round2Row.evidence_refs,
        reviewed_at: REVIEW_TIMESTAMP
      },
      final_decision: {
        status: finalStatus,
        reviewer: 'boardroom_adjudicator',
        decision_reason: finalReason,
        evidence_refs: finalEvidence,
        reviewed_at: REVIEW_TIMESTAMP
      },
      review_roles: REVIEW_ROLES,
      source_id: SOURCE_ID,
      snapshot: {
        reviewed_name_ids: allNameIds,
        round1_input: snapshots.round1,
        round2_input: snapshots.round2,
        signature
      },
      created_at: REVIEW_TIMESTAMP,
      updated_at: REVIEW_TIMESTAMP,
      notes: `boardroom=${finalStatus}; round1=${round1Row.decision}; round2=${round2Row.decision}`
    };
    validateSingleReview(row, round1Row, round2Row);
    return row;
  });

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  validateRows(reviewRows, schema);
  validateCrossChecks(reviewRows, namesById, snapshots, signature);

  if (validateOnly) {
    console.log('OK validate:name-review');
    return;
  }
  if (fs.existsSync(REVIEWS_PATH) && !force) {
    throw new Error(`Review file already exists: ${REVIEWS_PATH}. Use --force to overwrite.`);
  }

  writeJsonl(REVIEWS_PATH, reviewRows);
  writeReport(REPORT_PATH, reviewRows, snapshots, signature);
  console.log(`Generated ${path.relative(ROOT, REVIEWS_PATH)}`);
  console.log(`Generated ${path.relative(ROOT, REPORT_PATH)}`);
}

main();
