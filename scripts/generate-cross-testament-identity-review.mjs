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
const AI_ROUND1_PATH = path.join(EDITORIAL_DIR, 'ai-round1-cross-testament.jsonl');
const AI_ROUND1_V2_PATH = path.join(EDITORIAL_DIR, 'ai-round1-cross-testament-v2.jsonl');
const AI_ROUND2_PATH = path.join(EDITORIAL_DIR, 'ai-round2-cross-testament.jsonl');
const AI_ROUND2_V2_PATH = path.join(EDITORIAL_DIR, 'ai-round2-cross-testament-v2.jsonl');
const AI_BOARDROOM_PATH = path.join(EDITORIAL_DIR, 'ai-boardroom-cross-testament.jsonl');
const AI_BOARDROOM_V2_PATH = path.join(EDITORIAL_DIR, 'ai-boardroom-cross-testament-v2.jsonl');
const PEOPLE_PATH = path.join(ROOT, 'data', 'people.jsonl');

const SOURCE_ID = 'source:0002';
const REVIEW_METHOD = 'multi_agent_ai_review';
const PROTOCOL_VERSION = 'cross-testament-identity-review-v1';
const EVIDENCE_AUDITOR_ROLE = {
  roleId: 'evidence_auditor',
  modelId: 'deterministic-validator',
  promptVersion: 'evidence-auditor-v1'
};
const REVIEW_ROLES = {
  round1: { roleId: 'editorial_a', modelId: 'gpt-5.6-sol', promptVersion: 'editorial-a-v1' },
  round2: { roleId: 'critic_b', modelId: 'gpt-5.5', promptVersion: 'critic-b-v1' },
  final_decision: { roleId: 'boardroom_adjudicator', modelId: 'gpt-5.6-terra', promptVersion: 'boardroom-v1' }
};

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
    reviewed_at: null,
    reviewer_role_id: null,
    reviewer_model_id: null,
    reviewer_prompt_version: null
  };
}

function createPendingEvidenceAudit() {
  return {
    status: 'pending',
    reviewer_role_id: null,
    reviewer_model_id: null,
    prompt_version: null,
    checked_at: null,
    notes: '',
    evidence_refs: []
  };
}

function normalizeDecisionShape(row, stage) {
  const base = createPendingDecision();
  const normalized = {
    ...base,
    ...row,
    reviewer_role_id: row?.reviewer_role_id ?? base.reviewer_role_id,
    reviewer_model_id: row?.reviewer_model_id ?? base.reviewer_model_id,
    reviewer_prompt_version: row?.reviewer_prompt_version ?? base.reviewer_prompt_version
  };

  // Backfill metadata for non-pending decisions from AI batches when metadata is omitted.
  if (row && row.status && row.status !== 'pending' && normalized.reviewer_role_id === null && stage) {
    normalized.reviewer_role_id = REVIEW_ROLES[stage]?.roleId ?? normalized.reviewer_role_id;
    normalized.reviewer_model_id = REVIEW_ROLES[stage]?.modelId ?? normalized.reviewer_model_id;
    normalized.reviewer_prompt_version = REVIEW_ROLES[stage]?.promptVersion ?? normalized.reviewer_prompt_version;
  }
  return normalized;
}

function createReviewRoles() {
  return {
    round1: {
      reviewer_role_id: REVIEW_ROLES.round1.roleId,
      reviewer_model_id: REVIEW_ROLES.round1.modelId,
      reviewer_prompt_version: REVIEW_ROLES.round1.promptVersion
    },
    round2: {
      reviewer_role_id: REVIEW_ROLES.round2.roleId,
      reviewer_model_id: REVIEW_ROLES.round2.modelId,
      reviewer_prompt_version: REVIEW_ROLES.round2.promptVersion
    },
    final_decision: {
      reviewer_role_id: REVIEW_ROLES.final_decision.roleId,
      reviewer_model_id: REVIEW_ROLES.final_decision.modelId,
      reviewer_prompt_version: REVIEW_ROLES.final_decision.promptVersion
    },
    evidence_auditor: {
      reviewer_role_id: EVIDENCE_AUDITOR_ROLE.roleId,
      reviewer_model_id: EVIDENCE_AUDITOR_ROLE.modelId,
      reviewer_prompt_version: EVIDENCE_AUDITOR_ROLE.promptVersion
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

function normalizeBoardroomDecision(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    ...row,
    status: row.status,
    decision_action: row.decision_action ?? null,
    target_person_id: row.target_person_id ?? null,
    canonical_chinese: row.canonical_chinese ?? null,
    reviewer: row.reviewer ?? null,
    decision_note: row.decision_note ?? '',
    reviewed_at: row.reviewed_at ?? null,
    evidence_refs: Array.isArray(row.evidence_refs) ? row.evidence_refs : []
  };
}

function hasBibleRef(ref) {
  const normalized = String(ref || '').replace(/^Bible:\s*/i, '').trim();
  return /^[1-3]?\s*[A-Z]{2,6}\s+\d+:\d+$/i.test(normalized) || /^[A-Z]{2,6}\.\d+:\d+$/i.test(normalized);
}

function hasRepositoryRef(ref) {
  return /^data\//.test(ref) || /^editorial\//.test(ref) || /^names\//.test(ref);
}

function uniqueArray(values) {
  return Array.from(new Set((values || []).filter((value) => value)));
}

function normalizeEvidenceAudit(row) {
  const base = createPendingEvidenceAudit();
  return {
    ...base,
    ...(row || {}),
    reviewer_role_id: row?.reviewer_role_id ?? base.reviewer_role_id,
    reviewer_model_id: row?.reviewer_model_id ?? base.reviewer_model_id,
    prompt_version: row?.prompt_version ?? base.prompt_version,
    checked_at: row?.checked_at ?? base.checked_at,
    evidence_refs: Array.isArray(row?.evidence_refs) ? row.evidence_refs : []
  };
}

function normalizeExistingRow(row, round1Inputs, round2Inputs) {
  const candidateId = row?.candidate_id;
  const round1Source = round1Inputs.get(candidateId)?.decision || null;
  const round2Source = round2Inputs.get(candidateId)?.decision || null;
  return {
    ...row,
    round1: normalizeDecisionShape(row?.round1 || round1Source || null, 'round1'),
    round2: normalizeDecisionShape(row?.round2 || round2Source || null, 'round2'),
    final_decision: normalizeDecisionShape(row?.final_decision || {}, 'final_decision'),
    evidence_audit: normalizeEvidenceAudit(row?.evidence_audit)
  };
}

function loadDecisions(filePath, stage) {
  if (!fs.existsSync(filePath)) return new Map();
  const map = new Map();
  for (const row of readJsonl(filePath)) {
    const evidenceRefs = Array.isArray(row.evidence_refs) ? row.evidence_refs : [];
    map.set(row.candidate_id, {
      decision: normalizeDecisionShape({
        status: row.status,
        decision_action: row.decision_action ?? null,
        target_person_id: row.target_person_id ?? null,
        canonical_chinese: row.canonical_chinese ?? null,
        reviewer: row.reviewer ?? null,
        decision_note: row.decision_note ?? '',
        reviewed_at: row.reviewed_at ?? null
      }, stage),
      evidence_refs: evidenceRefs
    });
  }
  return map;
}

function loadDecisionInputs(primaryPath, overridePath, stage) {
  const base = loadDecisions(primaryPath, stage);
  if (!fs.existsSync(overridePath)) return base;
  const override = loadDecisions(overridePath, stage);
  for (const [candidateId, data] of override.entries()) {
    base.set(candidateId, data);
  }
  return base;
}

function loadBoardroomDecisions(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const map = new Map();
  for (const row of readJsonl(filePath)) {
    map.set(row.candidate_id, normalizeBoardroomDecision(row));
  }
  return map;
}

function loadBoardroomInputs(primaryPath, overridePath) {
  const base = loadBoardroomDecisions(primaryPath);
  if (!fs.existsSync(overridePath)) return base;
  const override = loadBoardroomDecisions(overridePath);
  for (const [candidateId, data] of override.entries()) {
    base.set(candidateId, data);
  }
  return base;
}

function loadPeople(filePath) {
  const people = new Map();
  for (const row of readJsonl(filePath)) {
    if (row?.person_id) people.set(row.person_id, row);
  }
  return people;
}

function mergeEvidenceRefs(...sources) {
  return uniqueArray(sources.flatMap((source) => (Array.isArray(source) ? source : [])));
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest?.created_at || Number.isNaN(Date.parse(manifest.created_at))) {
    throw new Error(`Invalid data/manifest.json created_at: ${manifest?.created_at}`);
  }
  return manifest;
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

function computeHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJsonl(filePath, rows) {
  const data = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${data}${rows.length > 0 ? '\n' : ''}`, 'utf8');
}

function writeReport(filePath, report) {
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function buildRows(candidates, identityOptions, round1Inputs, round2Inputs, boardroomInputs, peopleIndex, timestamp) {
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

  const selected = candidates
    .filter((row) => (row.nt_ref_count || 0) > 0 && row.candidate_status === 'pending')
    .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));

  const rows = [];
  const unmatched = [];

  for (const candidate of selected) {
    const normalizedCandidateKey = normalizeIdentityKey(candidate.step_identity_key);
    const matches = optionIndex.get(normalizedCandidateKey) || [];
    if (matches.length === 0) unmatched.push(candidate.candidate_id);

    const r1Entry = round1Inputs.get(candidate.candidate_id) || null;
    const r2Entry = round2Inputs.get(candidate.candidate_id) || null;
    const r1 = normalizeDecisionShape(r1Entry?.decision || null, 'round1');
    const r2 = normalizeDecisionShape(r2Entry?.decision || null, 'round2');
    const boardroom = boardroomInputs.get(candidate.candidate_id) || { status: 'pending', candidate_id: candidate.candidate_id, evidence_refs: [] };
    const refsUnion = mergeEvidenceRefs(
      r1Entry?.evidence_refs,
      r2Entry?.evidence_refs,
      boardroom.evidence_refs
    );
    const hasRepoRef = refsUnion.some((ref) => hasRepositoryRef(ref));
    const hasBibleRefValue = refsUnion.some((ref) => hasBibleRef(ref));
    const hasCandidateRef = refsUnion.some((ref) => String(ref || '').includes(`old-testament-person-candidates.jsonl#candidate_id=${candidate.candidate_id}`));

    const exactAcceptance = r1.status === 'accepted' &&
      r2.status === 'accepted' &&
      boardroom.status === 'accepted' &&
      r1.decision_action === r2.decision_action &&
      r1.decision_action === boardroom.decision_action &&
      r1.target_person_id === r2.target_person_id &&
      r1.target_person_id === boardroom.target_person_id &&
      r1.canonical_chinese === r2.canonical_chinese &&
      r1.canonical_chinese === boardroom.canonical_chinese;

    const exactRejection = r1.status === 'rejected' &&
      r2.status === 'rejected' &&
      boardroom.status === 'rejected' &&
      r1.decision_action === null &&
      r2.decision_action === null &&
      boardroom.decision_action === null &&
      r1.target_person_id === null &&
      r2.target_person_id === null &&
      boardroom.target_person_id === null &&
      r1.canonical_chinese === null &&
      r2.canonical_chinese === null &&
      boardroom.canonical_chinese === null;

    const finalDecision = createPendingDecision();
    let evidenceAudit = createPendingEvidenceAudit();
    const agreedTargetPersonId = exactAcceptance ? r1.target_person_id : null;
    const candidateMatchExists = !!agreedTargetPersonId && matches.some((match) => match?.person_id === agreedTargetPersonId);
    const targetPerson = peopleIndex.get(agreedTargetPersonId);

    const mergeAcceptanceChecksOk = exactAcceptance &&
      r1.decision_action === 'merge_existing' &&
      candidateMatchExists &&
      !!targetPerson &&
      targetPerson.status === 'accepted' &&
      targetPerson.canonical_chinese === r1.canonical_chinese &&
      hasRepoRef &&
      hasBibleRefValue &&
      hasCandidateRef;

    const createNewAcceptanceChecksOk = exactAcceptance &&
      r1.decision_action === 'create_new' &&
      !agreedTargetPersonId &&
      matches.length === 0 &&
      typeof r1.canonical_chinese === 'string' &&
      r1.canonical_chinese.trim() &&
      hasRepoRef &&
      hasBibleRefValue &&
      hasCandidateRef;

    if (mergeAcceptanceChecksOk || createNewAcceptanceChecksOk) {
      finalDecision.status = 'accepted';
      finalDecision.decision_action = r1.decision_action;
      finalDecision.target_person_id = r1.target_person_id;
      finalDecision.canonical_chinese = r1.canonical_chinese;
      finalDecision.reviewer = boardroom.reviewer || REVIEW_ROLES.final_decision.roleId;
      finalDecision.decision_note = boardroom.decision_note || '';
      finalDecision.reviewed_at = boardroom.reviewed_at || null;
      finalDecision.reviewer_role_id = REVIEW_ROLES.final_decision.roleId;
      finalDecision.reviewer_model_id = REVIEW_ROLES.final_decision.modelId;
      finalDecision.reviewer_prompt_version = REVIEW_ROLES.final_decision.promptVersion;

      const evidenceRefs = mergeAcceptanceChecksOk && r1.target_person_id
        ? mergeEvidenceRefs(refsUnion, [`data/identity-options.jsonl#person_id=${r1.target_person_id}`])
        : refsUnion;

      evidenceAudit = {
        ...createPendingEvidenceAudit(),
        status: 'passed',
        reviewer_role_id: EVIDENCE_AUDITOR_ROLE.roleId,
        reviewer_model_id: EVIDENCE_AUDITOR_ROLE.modelId,
        prompt_version: EVIDENCE_AUDITOR_ROLE.promptVersion,
        checked_at: boardroom.reviewed_at || timestamp,
        notes: 'Deterministic evidence audit passed on boardroom/finalized decisions and evidence constraints.',
        evidence_refs: uniqueArray(mergeEvidenceRefs(
          evidenceRefs,
          hasCandidateRef ? [`editorial/old-testament-person-candidates.jsonl#candidate_id=${candidate.candidate_id}`] : []
        ))
      };
    }

    if (exactRejection) {
      const rejectionEvidenceOk = hasRepoRef && hasBibleRefValue && hasCandidateRef;
      finalDecision.status = 'rejected';
      finalDecision.reviewer = boardroom.reviewer || REVIEW_ROLES.final_decision.roleId;
      finalDecision.decision_note = boardroom.decision_note || '';
      finalDecision.reviewed_at = boardroom.reviewed_at || null;
      finalDecision.reviewer_role_id = REVIEW_ROLES.final_decision.roleId;
      finalDecision.reviewer_model_id = REVIEW_ROLES.final_decision.modelId;
      finalDecision.reviewer_prompt_version = REVIEW_ROLES.final_decision.promptVersion;

      if (rejectionEvidenceOk) {
        evidenceAudit = {
          ...createPendingEvidenceAudit(),
          status: 'passed',
          reviewer_role_id: EVIDENCE_AUDITOR_ROLE.roleId,
          reviewer_model_id: EVIDENCE_AUDITOR_ROLE.modelId,
          prompt_version: EVIDENCE_AUDITOR_ROLE.promptVersion,
          checked_at: boardroom.reviewed_at || timestamp,
          notes: 'Deterministic evidence audit passed on exact rejected consensus and evidence constraints.',
          evidence_refs: uniqueArray(mergeEvidenceRefs(
            refsUnion,
            [`editorial/old-testament-person-candidates.jsonl#candidate_id=${candidate.candidate_id}`]
          ))
        };
      }
    }

    rows.push({
      review_id: boardroom.review_id || '',
      candidate_id: candidate.candidate_id,
      step_identity_key: candidate.step_identity_key,
      candidate_canonical_name: candidate.canonical_name,
      nt_ref_count: candidate.nt_ref_count,
      review_method: REVIEW_METHOD,
      protocol_version: PROTOCOL_VERSION,
      review_roles: createReviewRoles(),
      step_identity_matches: matches.map((match) => ({ ...match })),
      round1: r1,
      round2: r2,
      final_decision: finalDecision,
      evidence_audit: evidenceAudit,
      source_id: SOURCE_ID,
      created_at: timestamp,
      updated_at: timestamp,
      notes: matches.length > 0
        ? `Exact STEP identity-key match(es): ${matches.map((match) => match.person_id).join(', ')}`
        : 'No exact STEP identity-key matches in identity-options'
    });
  }

  return { rows, unmatchedCount: unmatched.length };
}

function validateEvidenceAudit(audit, rowId) {
  if (!audit || typeof audit !== 'object') throw new Error(`Missing evidence_audit object ${rowId}`);
  if (!['pending', 'passed', 'failed'].includes(audit.status)) {
    throw new Error(`Invalid evidence_audit.status for ${rowId}`);
  }
  if (audit.status === 'passed') {
    if (!audit.checked_at || Number.isNaN(Date.parse(audit.checked_at))) {
      throw new Error(`Passed evidence_audit requires checked_at: ${rowId}`);
    }
    if (!Array.isArray(audit.evidence_refs) || audit.evidence_refs.length === 0) {
      throw new Error(`Passed evidence_audit requires evidence_refs: ${rowId}`);
    }
    if (
      audit.reviewer_role_id !== 'evidence_auditor' ||
      !audit.reviewer_model_id ||
      !audit.prompt_version
    ) {
      throw new Error(`Passed evidence_audit requires evidence auditor metadata: ${rowId}`);
    }
  }
  if (audit.status === 'pending' && (audit.reviewer_role_id || audit.reviewer_model_id || audit.prompt_version)) {
    if (audit.reviewer_role_id !== 'evidence_auditor') {
      throw new Error(`Invalid evidence_audit role: ${rowId}`);
    }
  }
  if (audit.notes === undefined) throw new Error(`evidence_audit.notes required: ${rowId}`);
}

function validateDecision(decision, label, rowId) {
  if (!decision || typeof decision !== 'object') throw new Error(`Missing ${label} decision object ${rowId}`);
  if (!['pending', 'accepted', 'rejected'].includes(decision.status)) {
    throw new Error(`Invalid ${label}.status for ${rowId}: ${decision.status}`);
  }

  if (decision.status === 'pending') {
    if (decision.decision_action !== null || decision.target_person_id !== null || decision.canonical_chinese !== null) {
      throw new Error(`Pending ${label} fields must remain null: ${rowId}`);
    }
    if (decision.decision_note === undefined) throw new Error(`Pending ${label} requires decision_note: ${rowId}`);
  }

  if (decision.status === 'rejected') {
    if (decision.decision_action !== null || decision.target_person_id !== null || decision.canonical_chinese !== null) {
      throw new Error(`Rejected ${label} should not specify action/target/canonical: ${rowId}`);
    }
    if (!decision.reviewer?.trim() || !decision.decision_note?.trim() || !decision.reviewed_at || Number.isNaN(Date.parse(decision.reviewed_at))) {
      throw new Error(`Rejected ${label} requires reviewer/decision_note/reviewed_at: ${rowId}`);
    }
    const expected = REVIEW_ROLES[label];
    if (!expected) return;
    if (decision.reviewer_role_id !== expected.roleId || !decision.reviewer_model_id || !decision.reviewer_prompt_version) {
      throw new Error(`Rejected ${label} missing required reviewer metadata: ${rowId}`);
    }
    if (decision.reviewer_model_id !== expected.modelId || decision.reviewer_prompt_version !== expected.promptVersion) {
      throw new Error(`Rejected ${label} wrong reviewer metadata: ${rowId}`);
    }
  }

  if (decision.status === 'accepted') {
    const expected = REVIEW_ROLES[label];
    if (!expected) throw new Error(`Unknown decision label: ${label}`);
    if (!decision.decision_action || !decision.canonical_chinese?.trim() || !decision.reviewer?.trim() || !decision.reviewed_at || !decision.decision_note?.trim()) {
      throw new Error(`Accepted ${label} requires action/canonical_chinese/reviewer/decision_note/reviewed_at: ${rowId}`);
    }
    if (decision.reviewed_at && Number.isNaN(Date.parse(decision.reviewed_at))) {
      throw new Error(`Accepted ${label} requires valid reviewed_at: ${rowId}`);
    }
    if (decision.reviewer_role_id !== expected.roleId || decision.reviewer_model_id !== expected.modelId || decision.reviewer_prompt_version !== expected.promptVersion) {
      throw new Error(`Accepted ${label} requires reviewer metadata ${expected.roleId}/${expected.modelId}/${expected.promptVersion}: ${rowId}`);
    }
    if (decision.decision_action === 'merge_existing' && !decision.target_person_id) {
      throw new Error(`Accepted merge_existing ${label} must include target_person_id: ${rowId}`);
    }
    if (decision.decision_action === 'create_new' && decision.target_person_id !== null) {
      throw new Error(`Accepted create_new ${label} must not include target_person_id: ${rowId}`);
    }
  }
}

function validateSemantics(rows) {
  for (const row of rows) {
    validateReviewMetadata(row);
    for (const [name, decision] of [['round1', row.round1], ['round2', row.round2], ['final_decision', row.final_decision]]) {
      validateDecision(decision, name, row.candidate_id);
    }
    validateEvidenceAudit(row.evidence_audit, row.candidate_id);

    if (row.final_decision.status === 'accepted') {
      if (row.round1.status !== 'accepted' || row.round2.status !== 'accepted') {
        throw new Error(`Final accepted requires round1/round2 accepted: ${row.candidate_id}`);
      }
      if (row.evidence_audit.status !== 'passed') {
        throw new Error(`Final accepted requires evidence_audit.status=passed: ${row.candidate_id}`);
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
    }
  }
}

function buildReport(rows, manifest, candidateCount, unmatchedCount) {
  const accepted = rows.filter((row) => row.final_decision.status === 'accepted').length;
  const pending = rows.filter((row) => row.final_decision.status === 'pending').length;
  const rejected = rows.filter((row) => row.final_decision.status === 'rejected').length;
  const withMatches = rows.filter((row) => row.step_identity_matches.length > 0).length;

  return {
    generated_at: new Date(manifest.created_at).toISOString(),
    source_id: SOURCE_ID,
    manifest_created_at: manifest.created_at,
    input_candidate_count: candidateCount,
    snapshot_count: rows.length,
    unmatched_count: unmatchedCount,
    exact_match_count: withMatches,
    with_matches: withMatches,
    without_matches: rows.filter((row) => row.step_identity_matches.length === 0).length,
    final_accepted_count: accepted,
    final_pending_count: pending,
    final_rejected_count: rejected,
    output_path: path.relative(ROOT, OUTPUT_PATH),
    report_path: path.relative(ROOT, REPORT_PATH),
    note: 'Cross-testament identity snapshot uses multi-role AI review; unresolved or conflicting items remain pending.'
  };
}

function rowSignature(row) {
  return JSON.stringify({
    candidate_id: row.candidate_id,
    review_id: row.review_id,
    step_identity_key: row.step_identity_key,
    candidate_canonical_name: row.candidate_canonical_name,
    nt_ref_count: row.nt_ref_count,
    source_id: row.source_id,
    final_decision: row.final_decision,
    evidence_audit: {
      status: row.evidence_audit.status,
      notes: row.evidence_audit.notes
    },
    step_identity_matches: row.step_identity_matches.map((match) => match.person_id).sort()
  });
}

function compareRows(expectedRows, actualRows) {
  if (expectedRows.length !== actualRows.length) {
    throw new Error(`Snapshot row count mismatch: expected ${expectedRows.length}, actual ${actualRows.length}`);
  }
  const expected = new Map();
  for (const row of expectedRows) expected.set(row.candidate_id, rowSignature(row));

  for (const row of actualRows) {
    const sig = expected.get(row.candidate_id);
    if (!sig) throw new Error(`Unexpected candidate_id in current snapshot: ${row.candidate_id}`);
    if (sig !== rowSignature(row)) throw new Error(`Snapshot signature mismatch for ${row.candidate_id}`);
  }
}

function validateReport(expected, actual) {
  if (actual.source_id !== expected.source_id) throw new Error('Report source_id mismatch');
  if (actual.manifest_created_at !== expected.manifest_created_at) throw new Error('Report manifest_created_at mismatch');
  if (actual.snapshot_count !== expected.snapshot_count) throw new Error(`Report snapshot_count mismatch: ${actual.snapshot_count}/${expected.snapshot_count}`);
  if (actual.unmatched_count !== expected.unmatched_count) throw new Error(`Report unmatched_count mismatch: ${actual.unmatched_count}/${expected.unmatched_count}`);
  if (actual.with_matches !== expected.with_matches || actual.without_matches !== expected.without_matches) {
    throw new Error('Report match metric mismatch');
  }
  if (actual.final_accepted_count !== expected.final_accepted_count ||
      actual.final_pending_count !== expected.final_pending_count ||
      actual.final_rejected_count !== expected.final_rejected_count) {
    throw new Error('Report final decision count mismatch');
  }
}

function main() {
  const validateOnly = process.argv.includes('--validate-only');
  const force = process.argv.includes('--force');
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const candidates = readJsonl(CANDIDATES_PATH);
  const identityOptions = readJsonl(IDENTITY_OPTIONS_PATH);
  const manifest = readManifest();

  const round1Inputs = loadDecisionInputs(AI_ROUND1_PATH, AI_ROUND1_V2_PATH, 'round1');
  const round2Inputs = loadDecisionInputs(AI_ROUND2_PATH, AI_ROUND2_V2_PATH, 'round2');
  const boardroomInputs = loadBoardroomInputs(AI_BOARDROOM_PATH, AI_BOARDROOM_V2_PATH);
  const peopleIndex = loadPeople(PEOPLE_PATH);

  if (validateOnly) {
    if (!fs.existsSync(OUTPUT_PATH)) throw new Error(`Missing ${OUTPUT_PATH}`);
    const existing = readJsonl(OUTPUT_PATH).map((row) => normalizeExistingRow(row, round1Inputs, round2Inputs));
    validateRows(existing, schema);
    validateSemantics(existing);

    const { rows: expectedRows, unmatchedCount } = buildRows(
      candidates,
      identityOptions,
      round1Inputs,
      round2Inputs,
      boardroomInputs,
      peopleIndex,
      manifest.created_at
    );
    compareRows(expectedRows, existing);

    const generatedReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    const report = buildReport(expectedRows, manifest, candidates.length, unmatchedCount);
    validateReport(report, generatedReport);
    console.log(`validated cross-testament identity snapshot: ${existing.length} rows`);
    return;
  }

  const existing = fs.existsSync(OUTPUT_PATH) ? readJsonl(OUTPUT_PATH) : [];
  if (existing.length && !force) {
    throw new Error(`${OUTPUT_PATH} already exists. Use --force to regenerate.`);
  }

  const { rows, unmatchedCount } = buildRows(
    candidates,
    identityOptions,
    round1Inputs,
    round2Inputs,
    boardroomInputs,
    peopleIndex,
    manifest.created_at
  );
  validateRows(rows, schema);
  validateSemantics(rows);

  writeJsonl(OUTPUT_PATH, rows);
  const report = buildReport(rows, manifest, candidates.length, unmatchedCount);
  report.output_checksum = computeHash(OUTPUT_PATH);
  writeReport(REPORT_PATH, report);
  const written = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  validateReport(report, written);
  console.log(`generated cross-testament identity snapshot: ${rows.length} rows`);
}

main();
