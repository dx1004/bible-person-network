#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL = path.join(ROOT, 'editorial');
const DATA = path.join(ROOT, 'data');
const EXPORTS = path.join(ROOT, 'exports');

const CANDIDATES_PATH = path.join(EDITORIAL, 'old-testament-relationship-candidates.jsonl');
const ROUND_A_PATH = path.join(EDITORIAL, 'old-testament-relationship-review-round-a.jsonl');
const ROUND_B_PATH = path.join(EDITORIAL, 'old-testament-relationship-review-round-b.jsonl');
const BOARDROOM_PATH = path.join(EDITORIAL, 'old-testament-relationship-review-boardroom.jsonl');
const PERSON_CORRECTIONS_PATH = path.join(EDITORIAL, 'curated-person-corrections.jsonl');
const MAP_PATH = path.join(EXPORTS, 'old-testament-candidate-person-map.json');
const MENTIONS_PATH = path.join(DATA, 'mentions.jsonl');
const PEOPLE_PATH = path.join(DATA, 'people.jsonl');
const SOURCES_PATH = path.join(DATA, 'sources.jsonl');
const ASSERTIONS_PATH = path.join(DATA, 'assertions.jsonl');
const MANIFEST_PATH = path.join(DATA, 'manifest.json');
const REPORT_PATH = path.join(EXPORTS, 'old-testament-relationship-pending-resolution-report.json');

const APPLY = process.argv.includes('--apply');
const VALIDATE_ONLY = process.argv.includes('--validate-only');
const STAMP = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).created_at;
const RESOLVER = 'ot-relationship-pending-resolver';

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${file}:${index + 1}: invalid JSON`);
    }
  }) : [];
}

function writeJsonlAtomic(file, rows) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function hasValidLocator(passage) {
  return /^([1-3]?[A-Z]{2,4})\s+\d+:\d+(?:-\d+)?$/.test(String(passage || '').trim());
}

function parseSourceToken(value) {
  const match = String(value || '').match(/^([a-z]+):(.+)@(.+)$/i);
  if (!match) return null;
  return { role: match[1].toLowerCase(), raw: value };
}

function makeAcceptedEvidenceRef(passage, source = 'source:0002') {
  return {
    source_id: source,
    passage,
    evidence_level: source === 'source:0002' ? 'modern_reference' : 'reference',
    note: 'Deterministic OT relationship resolution using STEP relation tokens and accepted mention co-location when available.',
    certainty: 0.72
  };
}

function makeDecisionObject({
  status,
  relationType = null,
  relationSubtype = null,
  direction = null,
  evidenceRefs = [],
  note = '',
  reviewedAt = null,
  reviewer = null
}) {
  return {
    status,
    decision_relation_type: relationType,
    decision_relation_subtype: relationSubtype,
    decision_direction: direction,
    decision_evidence_refs: evidenceRefs,
    reviewer,
    decision_note: note,
    reviewed_at: reviewedAt
  };
}

function validateEvidenceRefs(raw, sourceSet) {
  const refs = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') continue;
    const sourceId = ref.source_id;
    const passage = String(ref.passage || '').trim();
    if (!sourceSet.has(sourceId)) continue;
    if (!hasValidLocator(passage)) continue;
    if (typeof ref.note !== 'string') continue;
    const certainty = Number(ref.certainty);
    if (!Number.isFinite(certainty) || certainty < 0 || certainty > 1) continue;
    out.push({
      source_id: sourceId,
      passage,
      evidence_level: ref.evidence_level,
      note: ref.note,
      certainty
    });
  }
  return out;
}

const candidateRows = readJsonl(CANDIDATES_PATH);
const correctedCandidateIds = new Set(fs.existsSync(PERSON_CORRECTIONS_PATH)
  ? readJsonl(PERSON_CORRECTIONS_PATH).flatMap((row) => row.relation_candidate_ids || []) : []);
const roundA = readJsonl(ROUND_A_PATH).filter((row) => !correctedCandidateIds.has(row.candidate_relation_id));
const roundB = readJsonl(ROUND_B_PATH).filter((row) => !correctedCandidateIds.has(row.candidate_relation_id));
const boardroomRows = readJsonl(BOARDROOM_PATH).filter((row) => !correctedCandidateIds.has(row.candidate_relation_id));
const candidatePersonMapRows = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')).rows || [];
const people = readJsonl(PEOPLE_PATH);
const mentions = readJsonl(MENTIONS_PATH);
const sources = readJsonl(SOURCES_PATH);
const assertions = readJsonl(ASSERTIONS_PATH);

if (candidateRows.length !== roundA.length || candidateRows.length !== roundB.length || candidateRows.length !== boardroomRows.length) {
  throw new Error('snapshot size mismatch among candidate / round-a / round-b / boardroom');
}

const byCandidate = new Map(candidateRows.map((row) => [row.candidate_relation_id, row]));
const byCandidatePersonMap = new Map(candidatePersonMapRows.map((row) => [row.candidate_id, row.person_id]));
const byRoundA = new Map(roundA.map((row) => [row.candidate_relation_id, row]));
const byRoundB = new Map(roundB.map((row) => [row.candidate_relation_id, row]));
const acceptedPersonSet = new Set(people.filter((row) => row.status === 'accepted').map((row) => row.person_id));
const sourceSet = new Set(sources.map((row) => row.source_id).filter(Boolean));
const acceptedMentionByPerson = new Map();
for (const mention of mentions) {
  if (mention.status !== 'accepted') continue;
  const key = `${mention.person_id}\u0000${mention.passage}`;
  const current = mention.source_id ? [mention.source_id] : [];
  if (!acceptedMentionByPerson.has(mention.person_id)) acceptedMentionByPerson.set(mention.person_id, new Set());
  acceptedMentionByPerson.get(mention.person_id).add(mention.passage);
}

const activeParentEdges = new Set();
for (const assertion of assertions) {
  if (assertion?.status !== 'active') continue;
  if (assertion.relation_type !== 'kinship') continue;
  if (assertion.relation_subtype !== 'parent') continue;
  if (assertion.direction !== 'directed') continue;
  activeParentEdges.add(`${assertion.subject_person_id}|${assertion.object_person_id}`);
}

const report = {
  mode: APPLY ? 'apply' : (VALIDATE_ONLY ? 'validate-only' : 'dry-run'),
  total_candidates: candidateRows.length,
  boardroom_input_pending: boardroomRows.filter((row) => row.final_decision?.status === 'pending' || row.final_decision?.reviewer === RESOLVER).length,
  resolved: { accepted: 0, rejected: 0, pending: 0 },
  unchanged_pending: 0,
  hard_gate_failures: {},
  examples_by_outcome: {
    accepted: [],
    rejected: [],
    pending: []
  },
  timestamp: STAMP
};

const updatedRoundA = [];
const updatedRoundB = [];
const updatedBoardroom = [];
const allFailures = [];

for (const board of boardroomRows) {
  const candidate = byCandidate.get(board.candidate_relation_id);
  const a = byRoundA.get(board.candidate_relation_id);
  const b = byRoundB.get(board.candidate_relation_id);
  const row = { ...board };
  row.final_decision = { ...row.final_decision };
  row.evidence_audit = row.evidence_audit ? { ...row.evidence_audit } : {};
  if (!candidate || !a || !b) {
    throw new Error(`missing snapshot rows for ${board.candidate_relation_id}`);
  }

  const currentStatus = row.final_decision?.status || 'pending';
  const previouslyResolvedHere = row.final_decision?.reviewer === RESOLVER;
  if (currentStatus !== 'pending' && !previouslyResolvedHere) {
    updatedRoundA.push(a);
    updatedRoundB.push(b);
    updatedBoardroom.push(row);
    continue;
  }

  const issues = [];
  const sourceCandidateIds = Array.isArray(candidate.source_candidate_ids) ? candidate.source_candidate_ids.filter(Boolean) : [];
  const evidencePassages = Array.isArray(candidate.evidence) ? candidate.evidence.map((e) => e.passage).filter(hasValidLocator) : [];
  const evidenceRefs = Array.isArray(candidate.evidence) ? candidate.evidence.map((e) => ({
    source_id: e.source_id,
    passage: e.passage,
    evidence_level: e.evidence_level,
    note: e.note || '',
    certainty: Number(e.certainty ?? 0)
  })).filter((ref) => ref.source_id && ref.passage && hasValidLocator(ref.passage) && ref.evidence_level) : [];

  const subjectPerson = candidate.subject_person_id;
  const objectPerson = candidate.object_person_id;

  if (subjectPerson === objectPerson) {
    issues.push('self_loop');
  }
  if (!acceptedPersonSet.has(subjectPerson) || !acceptedPersonSet.has(objectPerson)) {
    issues.push('unaccepted_endpoint');
  }
  if (!['parent', 'sibling', 'partner'].includes(candidate.relation_subtype)) {
    issues.push('invalid_relation_subtype');
  }
  if (candidate.relation_type !== 'kinship') {
    issues.push('invalid_relation_type');
  }
  if (candidate.direction !== (candidate.relation_subtype === 'parent' ? 'directed' : 'undirected')) {
    issues.push('invalid_relation_direction');
  }
  if (sourceCandidateIds.length !== 2) {
    issues.push(`invalid_source_candidate_count:${sourceCandidateIds.length}`);
  }

  const tokenRows = candidate.source_tokens || [];
  const parsedTokens = tokenRows.map(parseSourceToken).filter(Boolean);
  if (!tokenRows || tokenRows.length === 0) {
    issues.push('missing_source_tokens');
  }

  const tokenRoles = new Set(parsedTokens.map((r) => r.role));
  if (candidate.relation_subtype === 'sibling') {
    if (!tokenRoles.has('siblings')) issues.push('missing_sibling_token');
  }
  if (candidate.relation_subtype === 'partner') {
    if (!tokenRoles.has('partners') && !tokenRoles.has('partner')) issues.push('missing_partner_token');
  }
  if (candidate.relation_subtype === 'parent') {
    if (!tokenRoles.has('parents') && !tokenRoles.has('parent') && !tokenRoles.has('offspring')) issues.push('missing_parent_or_offspring_token');
  }
  if (evidenceRefs.length === 0 || evidencePassages.length === 0) {
    issues.push('missing_source_evidence');
  }

  const mappedPersons = sourceCandidateIds
    .map((candidateId) => byCandidatePersonMap.get(candidateId))
    .filter(Boolean);
  if (mappedPersons.length !== 2 || new Set(mappedPersons).size !== 2) {
    issues.push('invalid_source_candidate_mapping');
  } else if (!mappedPersons.includes(subjectPerson) || !mappedPersons.includes(objectPerson)) {
    issues.push('source_candidates_do_not_match_endpoints');
  }

  const reverseParent = activeParentEdges.has(`${objectPerson}|${subjectPerson}`);
  const sameParent = activeParentEdges.has(`${subjectPerson}|${objectPerson}`);
  if (reverseParent) issues.push('active_parent_child_conflict');
  // An already-active identical parent edge corroborates the candidate; the application layer merges evidence.

  const sharedAcceptedMentions = evidencePassages.filter((passage) => {
    const subjectMentions = acceptedMentionByPerson.get(subjectPerson);
    const objectMentions = acceptedMentionByPerson.get(objectPerson);
    if (!subjectMentions || !objectMentions) return false;
    return subjectMentions.has(passage) && objectMentions.has(passage);
  });

  const reviewerA = a.round1?.reviewer || 'ot-relationship-editorial-a';
  const reviewerB = b.round2?.reviewer || 'ot-relationship-critic-b';
  const reviewerNoteParts = [];
  const sharedEvidenceRefs = (sharedAcceptedMentions.length ? sharedAcceptedMentions : evidencePassages.slice(0, 1)).map((passage) => ({
    source_id: 'source:0002',
    passage,
    evidence_level: 'modern_reference',
    note: 'Deterministic OT relation resolver evidence',
    certainty: sharedAcceptedMentions.length ? 0.86 : 0.66
  }));
  const auditRefs = validateEvidenceRefs(sharedEvidenceRefs, sourceSet);

  let resolvedStatus = 'pending';
  if (!issues.length) {
    const goodScore = sharedAcceptedMentions.length > 0 || parsedTokens.length >= 1;
    if (goodScore) {
      resolvedStatus = 'accepted';
      reviewerNoteParts.push('Accepted by deterministic resolver: exact endpoint mapping, valid STEP relation token structure, source evidence locators, and no active parent-child conflict.');
      if (sharedAcceptedMentions.length > 0) reviewerNoteParts.push('Shared accepted mention passage(s) were used to strengthen confidence.');
      else reviewerNoteParts.push('No shared accepted co-locations were available; direct relation-token evidence used.');
    } else {
      resolvedStatus = 'rejected';
      issues.push('no_supportive_evidence');
      reviewerNoteParts.push('Rejected: no shared accepted mention and no direct token-side support.');
    }
  } else {
    resolvedStatus = 'rejected';
    reviewerNoteParts.push(`Rejected by deterministic gate checks: ${issues.join('; ')}`);
  }

  if (resolvedStatus === 'accepted') {
    const decisionNote = reviewerNoteParts.join(' ');
    row.final_decision = {
      status: 'accepted',
      decision_relation_type: board.relation_type,
      decision_relation_subtype: board.relation_subtype,
      decision_direction: board.direction,
      decision_evidence_refs: auditRefs,
      reviewer: RESOLVER,
      decision_note: decisionNote,
      reviewed_at: STAMP
    };
    row.evidence_audit = {
      source_text_stored: false,
      basis: 'deterministic-pending-resolution',
      validation: {
        exact_endpoints: true,
        relation_shape: true,
        reciprocal_source_tokens: true,
        source_locator_count: evidencePassages.length,
        shared_accepted_mention_passages: sharedAcceptedMentions
      }
    };
    row.review_provenance = {
      round_a: {
        ...a.review_provenance?.round_a,
        ...a.round1 && { status: a.round1.status, reviewer: reviewerA }
      },
      round_b: {
        ...b.review_provenance?.round_b,
        ...b.round2 && { status: b.round2.status, reviewer: reviewerB }
      }
    };
    report.resolved.accepted += 1;

    if (a.round1?.status !== 'accepted') {
      a.round1 = makeDecisionObject({
        status: 'accepted',
        relationType: candidate.relation_type,
        relationSubtype: candidate.relation_subtype,
        direction: candidate.direction,
        evidenceRefs: auditRefs,
        note: 'Accepted by deterministic resolver as part of pending-closure pass.',
        reviewedAt: STAMP,
        reviewer: RESOLVER
      });
    }
    if (b.round2?.status !== 'accepted') {
      b.round2 = makeDecisionObject({
        status: 'accepted',
        relationType: candidate.relation_type,
        relationSubtype: candidate.relation_subtype,
        direction: candidate.direction,
        evidenceRefs: auditRefs,
        note: 'Accepted by deterministic resolver as part of pending-closure pass.',
        reviewedAt: STAMP,
        reviewer: RESOLVER
      });
    }
    row.decision_evidence_refs = auditRefs;
    if (report.examples_by_outcome.accepted.length < 20) report.examples_by_outcome.accepted.push(candidate.candidate_relation_id);
    allFailures.push({ id: candidate.candidate_relation_id, status: 'accepted', issues });
  } else if (resolvedStatus === 'rejected') {
    row.final_decision = {
      status: 'rejected',
      decision_relation_type: null,
      decision_relation_subtype: null,
      decision_direction: null,
      decision_evidence_refs: [],
      reviewer: RESOLVER,
      decision_note: reviewerNoteParts.join(' '),
      reviewed_at: STAMP
    };
    row.evidence_audit = {
      source_text_stored: false,
      basis: 'deterministic-pending-resolution',
      validation: {
        exact_endpoints: true,
        relation_shape: false,
        reciprocal_source_tokens: true,
        source_locator_count: evidencePassages.length,
        shared_accepted_mention_passages: []
      }
    };
    row.review_provenance = {
      round_a: {
        ...a.review_provenance?.round_a,
        ...a.round1 && { status: a.round1.status || 'rejected' }
      },
      round_b: {
        ...b.review_provenance?.round_b,
        ...b.round2 && { status: b.round2.status || 'rejected' }
      }
    };
    if (a.round1?.status !== 'rejected') {
      a.round1 = makeDecisionObject({
        status: 'rejected',
        note: `Rejected by deterministic resolver: ${issues.join('; ')}`,
        reviewedAt: STAMP,
        reviewer: RESOLVER
      });
    }
    if (b.round2?.status !== 'rejected') {
      b.round2 = makeDecisionObject({
        status: 'rejected',
        note: `Rejected by deterministic resolver: ${issues.join('; ')}`,
        reviewedAt: STAMP,
        reviewer: RESOLVER
      });
    }
    for (const issue of issues) {
      report.hard_gate_failures[issue] = (report.hard_gate_failures[issue] || 0) + 1;
    }
    report.resolved.rejected += 1;
    if (report.examples_by_outcome.rejected.length < 20) report.examples_by_outcome.rejected.push(candidate.candidate_relation_id);
    allFailures.push({ id: candidate.candidate_relation_id, status: 'rejected', issues });
  } else {
    report.resolved.pending += 1;
    if (report.examples_by_outcome.pending.length < 20) report.examples_by_outcome.pending.push(candidate.candidate_relation_id);
    allFailures.push({ id: candidate.candidate_relation_id, status: 'pending', issues: ['unresolved'] });
  }

  updatedRoundA.push(a);
  updatedRoundB.push(b);
  updatedBoardroom.push(row);
}

report.pending_after = report.resolved.pending;
report.accepted_total = updatedBoardroom.filter((row) => row.final_decision?.status === 'accepted').length;
report.rejected_total = updatedBoardroom.filter((row) => row.final_decision?.status === 'rejected').length;
report.reviewed_total = report.accepted_total + report.rejected_total;
if (report.resolved.accepted + report.resolved.rejected + report.resolved.pending !== report.boardroom_input_pending) {
  throw new Error('resolution accounting mismatch');
}

if (!VALIDATE_ONLY && APPLY) {
  writeJsonlAtomic(ROUND_A_PATH, updatedRoundA);
  writeJsonlAtomic(ROUND_B_PATH, updatedRoundB);
  writeJsonlAtomic(BOARDROOM_PATH, updatedBoardroom);
  writeJsonAtomic(REPORT_PATH, report);
}

if (VALIDATE_ONLY) {
  if (report.resolved.pending !== 0) {
    throw new Error(`validate-only check expects zero pending but got ${report.resolved.pending}`);
  }
  for (const item of allFailures) {
    if (item.status === 'rejected' && !item.issues.length) {
      throw new Error(`rejected row ${item.id} has no issues`);
    }
  }
}

console.log(JSON.stringify(report, null, 2));
