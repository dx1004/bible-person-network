#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'old-testament-person-review-sidecar.schema.json');
const BASE_REVIEW_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-review.jsonl');
const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-review-sidecar-merge-report.json');

const SOURCE_ID = 'source:0002';
const SIDECAR_FILE_PATTERN = /^old-testament-person-review-batch-.*\.jsonl$/;
const STAGE_ORDER = ['round1', 'round2', 'final_decision'];
const STAGES = new Set(STAGE_ORDER);

const REVIEW_REFERENCES = {
  round1: {
    roleId: 'editorial_a',
    modelId: 'gpt-5.6-sol',
    promptVersion: 'editorial-a-v1'
  },
  round2: {
    roleId: 'critic_b',
    modelId: 'gpt-5.5',
    promptVersion: 'critic-b-v1'
  },
  final_decision: {
    roleId: 'boardroom_adjudicator',
    modelId: 'gpt-5.6-terra',
    promptVersion: 'boardroom-v1'
  }
};

const EVIDENCE_REFERENCES = {
  evidence_auditor: {
    roleId: 'evidence_auditor',
    modelId: 'deterministic-validator',
    promptVersion: 'evidence-auditor-v1'
  }
};

const BIBLE_REF_RE = /[A-Z]{2,6}\s+\d{1,3}:\d{1,3}/;
const REPO_REF_RE = /^(?:data\/|editorial\/|schemas\/|scripts\/|names\/|web\/)/;

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

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function parseArgs() {
  return {
    checkOnly: process.argv.includes('--check-only') || process.argv.includes('--check')
  };
}

function loadSchemaValidator() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return {
    status: raw.status,
    decision_action: raw.decision_action ?? null,
    target_person_id: raw.target_person_id ?? null,
    canonical_chinese: raw.canonical_chinese ?? null,
    reviewer: raw.reviewer ?? null,
    decision_note: raw.decision_note ?? '',
    reviewed_at: raw.reviewed_at ?? null,
    reviewer_role_id: raw.reviewer_role_id ?? null,
    reviewer_model_id: raw.reviewer_model_id ?? null,
    reviewer_prompt_version: raw.reviewer_prompt_version ?? null,
    source_file: raw.source_file ?? null
  };
}

function decisionForBase(raw) {
  const normalized = normalizeDecision(raw);
  if (!normalized) return null;
  const { source_file: _sourceFile, ...decision } = normalized;
  return decision;
}

function normalizeEvidenceAudit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    status: raw.status,
    reviewer_role_id: raw.reviewer_role_id ?? null,
    reviewer_model_id: raw.reviewer_model_id ?? null,
    prompt_version: raw.prompt_version ?? null,
    checked_at: raw.checked_at ?? null,
    notes: raw.notes ?? '',
    evidence_refs: Array.isArray(raw.evidence_refs) ? raw.evidence_refs : []
  };
}

function isValidDateTime(value) {
  return value === null || value === undefined || !Number.isNaN(Date.parse(value));
}

function validateDecisionDecision(row, stage, rowId) {
  const decision = row.decision;
  if (!decision || !['pending', 'accepted', 'rejected'].includes(decision.status)) {
    throw new Error(`Invalid status for ${rowId} ${stage}: ${decision?.status}`);
  }

  if (!isValidDateTime(decision.reviewed_at)) {
    throw new Error(`Invalid reviewed_at for ${rowId} ${stage}`);
  }

  if (decision.status === 'pending') {
    if (
      decision.decision_action !== null ||
      decision.target_person_id !== null ||
      decision.canonical_chinese !== null ||
      decision.reviewed_at !== null ||
      decision.reviewer !== null ||
      decision.reviewer_role_id !== null ||
      decision.reviewer_model_id !== null ||
      decision.reviewer_prompt_version !== null
    ) {
      throw new Error(`Pending ${stage} must keep action/target/canonical/reviewer fields null: ${rowId}`);
    }
    if (decision.decision_note === undefined) {
      throw new Error(`Pending ${stage} requires decision_note: ${rowId}`);
    }
    return;
  }

  if (!decision.reviewer?.trim() || !decision.decision_note?.trim() || !decision.reviewed_at) {
    throw new Error(`${stage} ${decision.status} requires reviewer, decision_note, reviewed_at: ${rowId}`);
  }

  const ref = REVIEW_REFERENCES[stage];
  if (
    decision.reviewer_role_id !== ref.roleId ||
    decision.reviewer_model_id !== ref.modelId ||
    decision.reviewer_prompt_version !== ref.promptVersion
  ) {
    throw new Error(`Invalid reviewer metadata for ${rowId} ${stage}`);
  }

  if (decision.status === 'accepted') {
    if (!decision.decision_action || !decision.canonical_chinese?.trim()) {
      throw new Error(`Accepted ${stage} requires decision_action and canonical_chinese: ${rowId}`);
    }
    if (decision.decision_action === 'merge_existing' && !decision.target_person_id) {
      throw new Error(`Accepted ${stage} merge_existing requires target_person_id: ${rowId}`);
    }
    if (decision.decision_action === 'create_new' && decision.target_person_id !== null) {
      throw new Error(`Accepted ${stage} create_new must not have target_person_id: ${rowId}`);
    }
  }

  if (decision.status === 'rejected') {
    if (decision.decision_action !== null || decision.target_person_id !== null || decision.canonical_chinese !== null) {
      throw new Error(`Rejected ${stage} must not include action/target/canonical: ${rowId}`);
    }
  }
}

function validateEvidenceAudit(audit, rowId, requireAudit = false) {
  if (!audit) {
    if (requireAudit) {
      throw new Error(`Missing evidence_audit for final accepted: ${rowId}`);
    }
    return;
  }

  if (!['passed', 'failed', 'pending'].includes(audit.status)) {
    throw new Error(`Invalid evidence_audit.status for ${rowId}: ${audit.status}`);
  }

  if (!isValidDateTime(audit.checked_at)) {
    throw new Error(`Invalid evidence_audit.checked_at for ${rowId}`);
  }

  if (audit.status === 'passed') {
    const refs = Array.isArray(audit.evidence_refs) ? audit.evidence_refs : [];
    if (audit.reviewer_role_id !== EVIDENCE_REFERENCES.evidence_auditor.roleId) {
      throw new Error(`Invalid evidence_auditor role for ${rowId}`);
    }
    if (audit.reviewer_model_id !== EVIDENCE_REFERENCES.evidence_auditor.modelId) {
      throw new Error(`Invalid evidence_auditor model for ${rowId}`);
    }
    if (audit.prompt_version !== EVIDENCE_REFERENCES.evidence_auditor.promptVersion) {
      throw new Error(`Invalid evidence_auditor prompt version for ${rowId}`);
    }
    if (!audit.checked_at || !audit.notes?.trim()) {
      throw new Error(`Passed evidence_audit requires checked_at and notes: ${rowId}`);
    }
    if (!refs.some((value) => BIBLE_REF_RE.test(value))) {
      throw new Error(`Passed evidence_audit requires at least one biblical locator: ${rowId}`);
    }
    if (!refs.some((value) => REPO_REF_RE.test(value))) {
      throw new Error(`Passed evidence_audit requires at least one repository locator: ${rowId}`);
    }
  }
}

function resolveLatestByKey(sideRows) {
  const selected = new Map();

  for (let index = 0; index < sideRows.length; index += 1) {
    const row = sideRows[index];

    const key = `${row.candidate_id}::${row.stage}`;
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, { row, order: index, createdAt: row.created_at });
      continue;
    }

    if (
      row.created_at > existing.createdAt ||
      (row.created_at === existing.createdAt && index > existing.order)
    ) {
      selected.set(key, { row, order: index, createdAt: row.created_at });
    }
  }

  const map = new Map();
  for (const { row } of selected.values()) {
    const fingerprint = row.fingerprint || crypto.createHash('sha256')
      .update(JSON.stringify({
        candidate_id: row.candidate_id,
        review_id: row.review_id,
        stage: row.stage,
        decision: row.decision,
        evidence_audit: row.evidence_audit || null
      }))
      .digest('hex');
    row.fingerprint = fingerprint;
    map.set(`${row.candidate_id}::${row.stage}`, { ...row, __order: row.order, fingerprint });
  }

  return map;
}

function compareRoundsForFinal(candidateReview, rowId) {
  if (
    candidateReview.final_decision.reviewer_role_id === REVIEW_REFERENCES.final_decision.roleId &&
    candidateReview.final_decision.reviewer_model_id === REVIEW_REFERENCES.final_decision.modelId &&
    candidateReview.final_decision.reviewer_prompt_version === REVIEW_REFERENCES.final_decision.promptVersion &&
    candidateReview.evidence_audit?.status === 'passed'
  ) {
    return;
  }
  if (
    candidateReview.round1.status !== 'accepted' ||
    candidateReview.round2.status !== 'accepted'
  ) {
    throw new Error(`Final accepted requires round1/round2 accepted: ${rowId}`);
  }

  if (candidateReview.round1.decision_action !== candidateReview.round2.decision_action) {
    throw new Error(`Round1 and round2 decision_action mismatch: ${rowId}`);
  }
  if (candidateReview.round1.target_person_id !== candidateReview.round2.target_person_id) {
    throw new Error(`Round1 and round2 target_person_id mismatch: ${rowId}`);
  }
  if (candidateReview.round1.canonical_chinese !== candidateReview.round2.canonical_chinese) {
    throw new Error(`Round1 and round2 canonical_chinese mismatch: ${rowId}`);
  }
}

function compareRoundsForRejected(candidateReview, rowId) {
  if (
    candidateReview.final_decision.reviewer_role_id === REVIEW_REFERENCES.final_decision.roleId &&
    candidateReview.final_decision.reviewer_model_id === REVIEW_REFERENCES.final_decision.modelId &&
    candidateReview.final_decision.reviewer_prompt_version === REVIEW_REFERENCES.final_decision.promptVersion &&
    candidateReview.evidence_audit?.status === 'passed'
  ) {
    return;
  }
  if (
    candidateReview.round1.status !== 'rejected' ||
    candidateReview.round2.status !== 'rejected'
  ) {
    throw new Error(`Final rejected requires round1/round2 rejected: ${rowId}`);
  }
}

function applyRows(baseRows, updatesByKey) {
  const byCandidate = new Map(baseRows.map((row) => [row.candidate_id, row]));

  for (const entry of updatesByKey.values()) {
    const current = byCandidate.get(entry.candidate_id);
    if (!current) continue;

    current[entry.stage] = decisionForBase(entry.decision);

    if (entry.stage === 'final_decision' && entry.evidence_audit) {
      current.evidence_audit = entry.evidence_audit;
    }

    current.updated_at = entry.created_at;
  }

  const draftRows = Array.from(byCandidate.values());
  for (const row of draftRows) {
    if (row.final_decision.status === 'accepted') {
      compareRoundsForFinal(row, row.candidate_id);
      validateEvidenceAudit(row.evidence_audit, row.candidate_id, true);
      if (row.evidence_audit.status !== 'passed') {
        throw new Error(`Final accepted requires passed evidence_audit: ${row.candidate_id}`);
      }
    }

    if (row.final_decision.status === 'rejected') {
      compareRoundsForRejected(row, row.candidate_id);
    }

    if (
      row.final_decision.status !== 'pending' &&
      row.round1.status === 'pending' &&
      !(row.final_decision.reviewer_role_id === REVIEW_REFERENCES.final_decision.roleId && row.evidence_audit?.status === 'passed')
    ) {
      throw new Error(`Final decision must have round1 state: ${row.candidate_id}`);
    }
  }

  return draftRows;
}

function validateAllRows(sideRows, baseByCandidate, candidateSet) {
  const rowsByKey = resolveLatestByKey(sideRows.map((row) => ({
    ...row,
    decision: normalizeDecision(row.decision),
    evidence_audit: normalizeEvidenceAudit(row.evidence_audit)
  })));

  const deduped = new Map();
  for (const raw of rowsByKey.values()) {
    if (!candidateSet.has(raw.candidate_id)) {
      throw new Error(`Unknown candidate_id in sidecar: ${raw.candidate_id}`);
    }

    const stage = raw.stage;
    if (!STAGES.has(stage)) {
      throw new Error(`Invalid stage ${stage} for ${raw.candidate_id}`);
    }

    const base = baseByCandidate.get(raw.candidate_id);
    if (!base || !base[stage]) {
      throw new Error(`Base missing stage ${stage} for ${raw.candidate_id}`);
    }

    if (!isValidDateTime(raw.created_at) || !raw.created_at) {
      throw new Error(`Invalid created_at for ${raw.candidate_id} ${stage}`);
    }

    if (!deduped.has(`${raw.candidate_id}::${raw.stage}`)) {
      deduped.set(`${raw.candidate_id}::${raw.stage}`, new Set());
    }

    const normalized = {
      ...raw,
      decision: normalizeDecision(raw.decision),
      evidence_audit: normalizeEvidenceAudit(raw.evidence_audit),
      __order: raw.__order
    };

    validateDecisionDecision(normalized, stage, normalized.candidate_id);
    if (stage === 'final_decision' && normalized.decision.status === 'accepted') {
      validateEvidenceAudit(normalized.evidence_audit, normalized.candidate_id, true);
      // final decisions must not be sent directly unless A/B are accepted and aligned;
      // this is enforced after merge against draft base state.
    }

    deduped.get(`${raw.candidate_id}::${raw.stage}`).add(normalized);
  }

  const latestByKey = new Map();
  for (const [key, values] of deduped.entries()) {
    const list = Array.from(values);
    if (list.length === 0) continue;
    list.sort((a, b) => {
      if (a.created_at === b.created_at) return b.__order - a.__order;
      return a.created_at < b.created_at ? -1 : 1;
    });
    const pick = list[list.length - 1];
    latestByKey.set(key, pick);
  }

  const updates = Array.from(latestByKey.values());
  const merged = new Map(baseByCandidate);
  const draftRows = applyRows(baseRowsFromMap(baseByCandidate), latestByKey);

  // enforce final acceptance constraints after applying updates to avoid bypass
  for (const row of draftRows) {
    const cid = row.candidate_id;
    if (row.final_decision.status === 'accepted') {
      compareRoundsForFinal(row, cid);
      validateEvidenceAudit(row.evidence_audit, cid);
    }
    if (row.final_decision.status === 'rejected') {
      compareRoundsForRejected(row, cid);
    }
  }

  return { updates, draftRows };
}

function baseRowsFromMap(map) {
  return Array.from(map.values());
}

const SIDECAR_ALLOWED_STAGES = STAGES;

function buildReport({ baseRows, sidecarFiles, sideRows, updates, mergedRows }) {
  const updated = mergedRows.length ? mergedRows.filter((row) => row.updated_at).length : 0;
  return {
    generated_at: new Date().toISOString(),
    source_id: SOURCE_ID,
    base_rows: baseRows,
    sidecar_files: sidecarFiles,
    sidecar_rows: sideRows,
    merged_updates: updates,
    changed_rows: updated,
    output_path: path.relative(ROOT, BASE_REVIEW_PATH)
  };
}

function main() {
  const args = parseArgs();
  const validate = loadSchemaValidator();

  if (!fs.existsSync(BASE_REVIEW_PATH)) {
    throw new Error(`Missing base review file: ${BASE_REVIEW_PATH}`);
  }

  const candidates = readJsonl(CANDIDATES_PATH);
  const candidateSet = new Set(candidates.map((row) => row.candidate_id));

  const baseRows = readJsonl(BASE_REVIEW_PATH);
  const baseByCandidate = new Map(baseRows.map((row) => [row.candidate_id, row]));

  const sidecarFiles = fs.readdirSync(EDITORIAL_DIR)
    .filter((name) => SIDECAR_FILE_PATTERN.test(name))
    .sort()
    .map((name) => path.join(EDITORIAL_DIR, name));

  let sideRows = [];
  for (const file of sidecarFiles) {
    sideRows = sideRows.concat(readJsonl(file));
  }

  if (!sideRows.length) {
    console.log('No sidecar rows found for old testament person review.');
    return;
  }

  for (const [index, row] of sideRows.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || [])
        .map((err) => `${err.instancePath || err.dataPath}: ${err.message}`)
        .join('; ');
      throw new Error(`Sidecar schema validation failed at ${index + 1}: ${details}`);
    }
  }

  const uniqueRows = [];
  const seen = new Set();
  for (const row of sideRows) {
    const signature = JSON.stringify({
      candidate_id: row.candidate_id,
      stage: row.stage,
      review_id: row.review_id,
      created_at: row.created_at,
      decision: row.decision,
      evidence_audit: row.evidence_audit || null
    });
    if (seen.has(signature)) continue;
    seen.add(signature);
    uniqueRows.push(row);
  }

  const { updates, draftRows } = validateAllRows(uniqueRows, baseByCandidate, candidateSet);

  const changedRows = draftRows.filter((row) => {
    const original = baseByCandidate.get(row.candidate_id);
    return JSON.stringify(original) !== JSON.stringify(row);
  }).length;

  const report = buildReport({
    baseRows: baseRows.length,
    sidecarFiles: sidecarFiles.map((file) => path.basename(file)),
    sideRows: uniqueRows.length,
    updates: updates.length,
    mergedRows: changedRows
  });

  if (!args.checkOnly) {
    writeJsonl(REPORT_PATH, [report]);
    writeJsonl(BASE_REVIEW_PATH, draftRows);
  }

  console.log(`OK old-testament-person-review-sidecar ${args.checkOnly ? '(check-only)' : '(applied)'}`);
}

main();
