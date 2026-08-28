import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'old-testament-person-review.schema.json');
const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates.jsonl');
const OUTPUT_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-review.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-review-report.json');

const SOURCE_ID = 'source:0002';
const REVIEW_METHOD = 'multi_agent_ai_review';
const PROTOCOL_VERSION = '2.0.0';
const BIBLE_REF_RE = /[A-Z]{2,6}\s+\d{1,3}:\d{1,3}/;
const REPO_REF_RE = /^(?:data\/|editorial\/|schemas\/|scripts\/|names\/|web\/)/;
const REFERENCE_MODELS = {
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

function createReviewRoles() {
  return {
    editorial: {
      role_id: REFERENCE_MODELS.round1.roleId,
      model_id: REFERENCE_MODELS.round1.modelId,
      prompt_version: REFERENCE_MODELS.round1.promptVersion
    },
    critic: {
      role_id: REFERENCE_MODELS.round2.roleId,
      model_id: REFERENCE_MODELS.round2.modelId,
      prompt_version: REFERENCE_MODELS.round2.promptVersion
    },
    boardroom: {
      role_id: REFERENCE_MODELS.final_decision.roleId,
      model_id: REFERENCE_MODELS.final_decision.modelId,
      prompt_version: REFERENCE_MODELS.final_decision.promptVersion
    }
  };
}

function validateReviewMetadata(row) {
  if (row.review_method !== REVIEW_METHOD) {
    throw new Error(`Invalid review_method for ${row.candidate_id}`);
  }
  if (row.protocol_version !== PROTOCOL_VERSION) {
    throw new Error(`Invalid protocol_version for ${row.candidate_id}`);
  }
  if (JSON.stringify(row.review_roles) !== JSON.stringify(createReviewRoles())) {
    throw new Error(`Review role metadata mismatch for ${row.candidate_id}`);
  }
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

function validateRows(rows, schema) {
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [index, row] of rows.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at old-testament-person-review:${index + 1}: ${details}`);
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
    reviewed_at: null,
    reviewer_role_id: null,
    reviewer_model_id: null,
    reviewer_prompt_version: null
  };
}

function normalizeDecision(decision = {}, rowId, stage) {
  return {
    ...createPendingDecision(),
    ...decision,
    reviewer_role_id: decision?.reviewer_role_id ?? null,
    reviewer_model_id: decision?.reviewer_model_id ?? null,
    reviewer_prompt_version: decision?.reviewer_prompt_version ?? null
  };
}

function normalizeEvidenceAudit(audit) {
  if (!audit || typeof audit !== 'object') return null;
  return {
    status: audit.status,
    reviewer_role_id: audit.reviewer_role_id,
    reviewer_model_id: audit.reviewer_model_id,
    prompt_version: audit.prompt_version,
    checked_at: audit.checked_at,
    notes: audit.notes || '',
    evidence_refs: Array.isArray(audit.evidence_refs) ? audit.evidence_refs : []
  };
}

function validateEvidenceAudit(audit, rowId, required = false) {
  if (!audit) {
    if (required) throw new Error(`Final accepted requires evidence_audit: ${rowId}`);
    return;
  }
  if (!['pending', 'passed', 'failed'].includes(audit.status)) {
    throw new Error(`Invalid evidence_audit.status: ${rowId}`);
  }
  if (audit.status === 'passed') {
    if (
      audit.reviewer_role_id !== 'evidence_auditor' ||
      audit.reviewer_model_id !== 'deterministic-validator' ||
      audit.prompt_version !== 'evidence-auditor-v1' ||
      !audit.checked_at || Number.isNaN(Date.parse(audit.checked_at)) ||
      !audit.notes?.trim() || !audit.evidence_refs?.length
    ) {
      throw new Error(`Invalid passed evidence_audit metadata: ${rowId}`);
    }
    if (!audit.evidence_refs.some((ref) => BIBLE_REF_RE.test(ref))) {
      throw new Error(`Passed evidence_audit requires Bible locator: ${rowId}`);
    }
    if (!audit.evidence_refs.some((ref) => REPO_REF_RE.test(ref))) {
      throw new Error(`Passed evidence_audit requires repository locator: ${rowId}`);
    }
  }
}

function mapById(rows) {
  const m = new Map();
  for (const row of rows) {
    if (row?.candidate_id) m.set(row.candidate_id, row);
  }
  return m;
}

function validateDecision(decision, label, rowId) {
  if (!decision || typeof decision !== 'object') {
    throw new Error(`Missing ${label} decision object ${rowId}`);
  }
  if (!['pending', 'accepted', 'rejected'].includes(decision.status)) {
    throw new Error(`${label} status invalid ${rowId}: ${decision.status}`);
  }

  if (decision.status === 'pending') {
    if (decision.decision_action !== null || decision.target_person_id !== null || decision.canonical_chinese !== null || decision.reviewed_at !== null) {
      throw new Error(`Pending ${label} fields must remain null: ${rowId}`);
    }
    if (decision.reviewer !== null && decision.reviewer !== undefined) {
      throw new Error(`Pending ${label} reviewer must be null: ${rowId}`);
    }
    if (decision.reviewer_role_id !== null && decision.reviewer_role_id !== undefined) {
      throw new Error(`Pending ${label} reviewer_role_id must be null: ${rowId}`);
    }
    if (decision.reviewer_model_id !== null && decision.reviewer_model_id !== undefined) {
      throw new Error(`Pending ${label} reviewer_model_id must be null: ${rowId}`);
    }
    if (decision.reviewer_prompt_version !== null && decision.reviewer_prompt_version !== undefined) {
      throw new Error(`Pending ${label} reviewer_prompt_version must be null: ${rowId}`);
    }
    if (decision.decision_note === undefined) {
      throw new Error(`Pending ${label} requires decision_note: ${rowId}`);
    }
  }

  if (decision.status === 'rejected') {
    if (decision.decision_action !== null || decision.target_person_id !== null || decision.canonical_chinese !== null) {
      throw new Error(`Rejected ${label} should not specify action/target/canonical: ${rowId}`);
    }
    if (!decision.reviewer?.trim() || !decision.decision_note?.trim() || !decision.reviewed_at || Number.isNaN(Date.parse(decision.reviewed_at))) {
      throw new Error(`Rejected ${label} requires reviewer, decision_note, reviewed_at: ${rowId}`);
    }
    if (
      decision.reviewer_role_id !== REFERENCE_MODELS[label].roleId ||
      decision.reviewer_model_id !== REFERENCE_MODELS[label].modelId ||
      decision.reviewer_prompt_version !== REFERENCE_MODELS[label].promptVersion
    ) {
      throw new Error(`Rejected ${label} requires ${REFERENCE_MODELS[label].roleId} metadata: ${rowId}`);
    }
  }

  if (decision.status === 'accepted') {
    const expected = REFERENCE_MODELS[label];
    if (!decision.decision_action || !decision.canonical_chinese?.trim() || !decision.reviewer?.trim() || !decision.reviewed_at || !decision.decision_note?.trim()) {
      throw new Error(`Accepted ${label} requires action/canonical/reviewer/decision_note/reviewed_at: ${rowId}`);
    }
    if (Number.isNaN(Date.parse(decision.reviewed_at))) {
      throw new Error(`Accepted ${label} requires valid reviewed_at: ${rowId}`);
    }
    if (decision.reviewer_role_id !== expected.roleId || !decision.reviewer_model_id || decision.reviewer_prompt_version !== expected.promptVersion) {
      throw new Error(`Accepted ${label} must include reference reviewer metadata ${expected.roleId}: ${rowId}`);
    }
    if (decision.reviewer_model_id !== expected.modelId) {
      throw new Error(`Accepted ${label} wrong model ${decision.reviewer_model_id}: ${rowId}`);
    }
    if (decision.decision_action === 'merge_existing' && !decision.target_person_id) {
      throw new Error(`Accepted merge_existing ${label} requires target_person_id: ${rowId}`);
    }
    if (decision.decision_action === 'create_new' && decision.target_person_id !== null) {
      throw new Error(`Accepted create_new ${label} must not include target_person_id: ${rowId}`);
    }
  }
}

function validateSemantics(rows, candidateSet) {
  const seenCandidates = new Set();
  for (const row of rows) {
    if (!row.candidate_id) throw new Error('Row missing candidate_id');
    if (seenCandidates.has(row.candidate_id)) throw new Error(`Duplicate candidate_id in review rows: ${row.candidate_id}`);
    seenCandidates.add(row.candidate_id);

    const candidate = candidateSet.get(row.candidate_id);
    if (!candidate) {
      throw new Error(`Unknown candidate_id in review file: ${row.candidate_id}`);
    }

    validateReviewMetadata(row);

    for (const name of ['round1', 'round2', 'final_decision']) {
      validateDecision(row[name], name, row.candidate_id);
    }

    if (row.final_decision.status === 'accepted') {
      if (row.round1.status !== 'accepted' || row.round2.status !== 'accepted') {
        throw new Error(`Final accepted requires round1 and round2 accepted: ${row.candidate_id}`);
      }
      if (row.final_decision.decision_action !== row.round1.decision_action || row.final_decision.decision_action !== row.round2.decision_action) {
        throw new Error(`Final accepted decision_action mismatch: ${row.candidate_id}`);
      }
      if (row.final_decision.target_person_id !== row.round1.target_person_id || row.final_decision.target_person_id !== row.round2.target_person_id) {
        throw new Error(`Final accepted target_person_id mismatch: ${row.candidate_id}`);
      }
      if (row.final_decision.canonical_chinese !== row.round1.canonical_chinese || row.final_decision.canonical_chinese !== row.round2.canonical_chinese) {
        throw new Error(`Final accepted canonical_chinese mismatch: ${row.candidate_id}`);
      }
      validateEvidenceAudit(row.evidence_audit, row.candidate_id, true);
      if (row.evidence_audit.status !== 'passed') {
        throw new Error(`Final accepted requires passed evidence_audit: ${row.candidate_id}`);
      }
    } else {
      validateEvidenceAudit(row.evidence_audit, row.candidate_id, false);
    }

    for (const [name, decision] of [['round1', row.round1], ['round2', row.round2], ['final_decision', row.final_decision]]) {
      const expected = REFERENCE_MODELS[name];
      if (decision.status !== 'pending') {
        if (decision.reviewer_role_id !== expected.roleId) {
          throw new Error(`Decision reviewer role mismatch ${name} for ${row.candidate_id}`);
        }
      }
    }
  }
}

function buildReviewRows(candidates, existingRows, timestamp) {
  const existing = mapById(existingRows);
  const selected = candidates
    .filter((row) => row.candidate_status === 'pending')
    .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));

  const rows = selected.map((candidate, index) => {
    const existingRow = existing.get(candidate.candidate_id);
    const review_id = `otpr-${String(index + 1).padStart(4, '0')}`;
    const base = {
      review_id,
      candidate_id: candidate.candidate_id,
      step_identity_key: candidate.step_identity_key,
      candidate_status: candidate.candidate_status || 'pending',
      canonical_chinese: existingRow?.canonical_chinese ?? null,
      review_method: REVIEW_METHOD,
      review_roles: createReviewRoles(),
      protocol_version: PROTOCOL_VERSION,
      source_id: SOURCE_ID,
      round1: existingRow ? normalizeDecision(existingRow.round1, candidate.candidate_id, 'round1') : createPendingDecision(),
      round2: existingRow ? normalizeDecision(existingRow.round2, candidate.candidate_id, 'round2') : createPendingDecision(),
      final_decision: existingRow ? normalizeDecision(existingRow.final_decision, candidate.candidate_id, 'final_decision') : createPendingDecision(),
      created_at: existingRow?.created_at || timestamp,
      updated_at: existingRow?.updated_at || timestamp,
      notes: existingRow?.notes || 'Pending two-round OT identity review.'
    };
    const evidenceAudit = normalizeEvidenceAudit(existingRow?.evidence_audit);
    if (evidenceAudit) base.evidence_audit = evidenceAudit;
    return base;
  });

  return rows;
}

function buildReport(rows, candidateCount, pendingCount) {
  return {
    generated_at: new Date().toISOString(),
    review_rows: rows.length,
    candidate_rows: candidateCount,
    source_id: SOURCE_ID,
    report_path: path.relative(ROOT, REPORT_PATH),
    output_path: path.relative(ROOT, OUTPUT_PATH),
    pending: pendingCount
  };
}

function writeJsonl(filePath, rows) {
  const data = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${data}${rows.length > 0 ? '\n' : ''}`, 'utf8');
}

function deriveReviewCounts(rows) {
  const counts = {
    total: rows.length,
    accepted: 0,
    rejected: 0,
    pending: 0,
    evidence_audit_passed: 0
  };
  for (const row of rows) {
    const status = row?.final_decision?.status || 'pending';
    if (status === 'accepted') counts.accepted += 1;
    else if (status === 'rejected') counts.rejected += 1;
    else counts.pending += 1;

    if (row?.evidence_audit?.status === 'passed') counts.evidence_audit_passed += 1;
  }
  return counts;
}

function writeReport(filePath, report) {
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes('--validate-only');
  const force = args.includes('--force');

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const candidates = readJsonl(CANDIDATES_PATH);
  const candidateSet = new Map(candidates.map((row) => [row.candidate_id, row]));
  const existingRows = fs.existsSync(OUTPUT_PATH) ? readJsonl(OUTPUT_PATH) : [];

  if (validateOnly) {
    if (!fs.existsSync(OUTPUT_PATH)) {
      throw new Error(`Missing ${OUTPUT_PATH}`);
    }
    const rows = readJsonl(OUTPUT_PATH);
    validateRows(rows, schema);
    validateSemantics(rows, candidateSet);
    const counts = deriveReviewCounts(rows);
    if (!fs.existsSync(REPORT_PATH)) {
      throw new Error(`Missing ${REPORT_PATH}`);
    }
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    if (report.review_rows !== rows.length) throw new Error(`Report review_rows mismatch: report=${report.review_rows} actual=${rows.length}`);
    if (report.candidate_rows !== candidates.length) throw new Error(`Report candidate_rows mismatch: report=${report.candidate_rows} actual=${candidates.length}`);
    if (report.total_candidates !== candidates.length) throw new Error(`Report total_candidates mismatch: report=${report.total_candidates} actual=${candidates.length}`);
    if (report.accepted !== counts.accepted) throw new Error(`Report accepted mismatch: report=${report.accepted} actual=${counts.accepted}`);
    if (report.rejected !== counts.rejected) throw new Error(`Report rejected mismatch: report=${report.rejected} actual=${counts.rejected}`);
    if (report.pending !== counts.pending) throw new Error(`Report pending mismatch: report=${report.pending} actual=${counts.pending}`);
    if (report.evidence_audit_passed !== counts.evidence_audit_passed) throw new Error(`Report evidence_audit_passed mismatch: report=${report.evidence_audit_passed} actual=${counts.evidence_audit_passed}`);
    console.log(`validated old-testament-person-review rows: ${rows.length}`);
    return;
  }

  if (fs.existsSync(OUTPUT_PATH) && !force) {
    throw new Error(`${OUTPUT_PATH} already exists. Use --force to regenerate.`);
  }

  const rows = buildReviewRows(candidates, existingRows, '2026-08-26T00:00:00Z');
  validateRows(rows, schema);
  validateSemantics(rows, candidateSet);

  writeJsonl(OUTPUT_PATH, rows);
  const counts = deriveReviewCounts(rows);
  const report = buildReport(rows, candidates.length, counts.pending);
  report.accepted = counts.accepted;
  report.rejected = counts.rejected;
  report.evidence_audit_passed = counts.evidence_audit_passed;
  report.total_candidates = candidates.length;
  writeReport(REPORT_PATH, report);
  console.log(`generated old-testament-person-review rows: ${rows.length}`);
}

main();
