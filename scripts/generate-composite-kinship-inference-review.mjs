#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');

const STAMP = '2026-08-31T00:00:00Z';
const INFERENCE_ORDER_BASE = 1;
const INFERENCE_ORDER_SECOND = 2;
const CERTAINTY_BASE = 0.82;
const CERTAINTY_SECOND_ORDER = 0.8;
// These candidates were reviewed as non-textual direct edges, but their
// independently verified two-parent paths support a derived kinship assertion.
// Keeping this adjudication here prevents the direct-review status from either
// publishing a false textual edge or silently dropping the valid inference.
const CURATED_ACCEPTED_COMPOSITE_CANDIDATES = new Set(['drd-007444']);

const ASSERTIONS_PATH = path.join(ROOT, 'data', 'assertions.jsonl');
const IDENTITIES_PATH = path.join(ROOT, 'data', 'identity-options.jsonl');
const DISCOVERY_PATH = path.join(ROOT, 'editorial', 'direct-relationship-discovery.jsonl');
const DIRECT_REVIEW_PATH = path.join(ROOT, 'editorial', 'direct-relationship-review.jsonl');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'composite-kinship-inference-review.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'composite-kinship-inference-review-report.json');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'composite-kinship-inference-review.schema.json');

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}

function decision(status, reviewerMode, reason) {
  return { status, reviewer_mode: reviewerMode, reason };
}

function canonicalPremiseSignature(assertionIds) {
  return (assertionIds || []).map((id) => String(id)).sort().join('|');
}

function buildPublishedInferenceIndex(activeAssertions) {
  const index = new Map(); // `${subject}|${object}` => Set(premiseSignature)

  for (const row of activeAssertions) {
    if (row.status !== 'active') continue;
    const rule = row?.inference?.rule;
    if (rule !== 'grandparent_from_two_direct_parent_edges') continue;
    if (row.relation_type !== 'kinship') continue;
    if (row.relation_subtype !== 'grandparent') continue;

    const pair = `${row.subject_person_id}|${row.object_person_id}`;
    const premises = canonicalPremiseSignature(row.inference?.premise_assertion_ids || []);
    const set = index.get(pair) || new Set();
    set.add(premises);
    index.set(pair, set);
  }

  return index;
}

function hasPublishedMatch(publishedIndex, subjectPersonId, objectPersonId, premiseIds) {
  const pair = `${subjectPersonId}|${objectPersonId}`;
  const set = publishedIndex.get(pair);
  if (!set) return false;
  return set.has(canonicalPremiseSignature(premiseIds));
}

function unorderedPairKey(a, b) {
  return [String(a), String(b)].sort().join('|');
}

function buildDirectReviewMap() {
  const reviewRows = readJsonl(DIRECT_REVIEW_PATH);
  const map = new Map();
  for (const row of reviewRows) {
    map.set(row.candidate_relation_id, row);
  }
  return map;
}

const assertions = readJsonl(ASSERTIONS_PATH);
const activeAssertions = assertions.filter((row) => row.status === 'active');
const assertionById = new Map(activeAssertions.map((row) => [row.assertion_id, row]));
const discoveryRows = readJsonl(DISCOVERY_PATH);
const directReviewByCandidate = buildDirectReviewMap();
const disputedPeople = new Set(
  readJsonl(IDENTITIES_PATH)
    .filter((row) => row.status === 'disputed')
    .map((row) => row.person_id)
);

const activeGrandparentInferenceIndex = buildPublishedInferenceIndex(activeAssertions);
const existingPublishedReviewRows = fs.existsSync(OUTPUT_PATH) ? readJsonl(OUTPUT_PATH) : [];
const publishedGrandparentAssertions = activeAssertions.filter((row) =>
  row.relation_type === 'kinship'
  && row.relation_subtype === 'grandparent'
  && row.inference?.rule === 'grandparent_from_two_direct_parent_edges'
);
const discoveryByPair = new Map();
for (const candidate of discoveryRows) {
  const key = unorderedPairKey(candidate.subject_person_id, candidate.object_person_id);
  const list = discoveryByPair.get(key) || [];
  list.push(candidate);
  discoveryByPair.set(key, list);
}

const directParentPairs = new Set(
  activeAssertions
    .filter((row) => row.relation_type === 'kinship' && ['parent', 'child'].includes(row.relation_subtype))
    .flatMap((row) => [
      `${row.subject_person_id}|${row.object_person_id}`,
      `${row.object_person_id}|${row.subject_person_id}`,
    ])
);

const existingGrandparentPairs = new Set(
  activeAssertions
    .filter((row) => row.relation_type === 'kinship' && ['grandparent', 'grandchild'].includes(row.relation_subtype))
    .map((row) => `${row.subject_person_id}|${row.object_person_id}`)
);

const rows = [];

for (const candidate of discoveryRows) {
  const directReview = directReviewByCandidate.get(candidate.candidate_relation_id);
  const directStatus = directReview?.final_decision?.status;

  const eligiblePaths = [];
  for (const pathContext of candidate.path_contexts || []) {
    if (pathContext.path_length !== 2 || pathContext.assertion_ids?.length !== 2) continue;
    const premiseAssertions = pathContext.assertion_ids.map((id) => assertionById.get(id));
    if (premiseAssertions.some((row) => !row)) continue;

    const deltas = premiseAssertions.map((assertion, index) => {
      const relationSubtype = String(assertion.relation_subtype || '').toLowerCase();
      const traversalDirection = index === 0
        ? pathContext.via_assertions?.first?.traversal_direction
        : pathContext.via_assertions?.second?.traversal_direction;

      if (assertion.relation_type !== 'kinship' || assertion.direction !== 'directed') return null;
      if (relationSubtype === 'parent') return traversalDirection === 'forward' ? 1 : -1;
      if (relationSubtype === 'child') return traversalDirection === 'forward' ? -1 : 1;
      return null;
    });

    if (deltas.some((value) => value === null)) continue;

    const generationDelta = deltas.reduce((sum, value) => sum + value, 0);
    if (Math.abs(generationDelta) !== 2) continue;

    const olderPersonId = generationDelta === 2 ? candidate.subject_person_id : candidate.object_person_id;
    const youngerPersonId = generationDelta === 2 ? candidate.object_person_id : candidate.subject_person_id;

    eligiblePaths.push({
      olderPersonId,
      youngerPersonId,
      premiseAssertionIds: canonicalPremiseSignature(pathContext.assertion_ids).split('|'),
    });
  }

  if (!eligiblePaths.length) continue;

  const orientations = new Set(eligiblePaths.map((entry) => `${entry.olderPersonId}|${entry.youngerPersonId}`));
  const canonicalPath = [...eligiblePaths].sort((a, b) => a.premiseAssertionIds.join('|').localeCompare(b.premiseAssertionIds.join('|')))[0];

  const hasPublished = hasPublishedMatch(
    activeGrandparentInferenceIndex,
    canonicalPath.olderPersonId,
    canonicalPath.youngerPersonId,
    canonicalPath.premiseAssertionIds
  );
  const curatedCompositeAccepted = CURATED_ACCEPTED_COMPOSITE_CANDIDATES.has(candidate.candidate_relation_id);

  const allowCoveredExisting = directStatus === 'covered_existing' && hasPublished;
  if (!curatedCompositeAccepted && !['needs_textual_review', 'covered_existing'].includes(directStatus)) {
    continue;
  }

  // For covered_existing, only reconstitute rows that correspond to an already published
  // two-parent inference with the exact oriented pair and exact premises.
  if (directStatus === 'covered_existing' && !allowCoveredExisting) {
    continue;
  }

  const identityConflict = disputedPeople.has(canonicalPath.olderPersonId) || disputedPeople.has(canonicalPath.youngerPersonId);
  const generationConflict = orientations.size !== 1 || directParentPairs.has(`${canonicalPath.olderPersonId}|${canonicalPath.youngerPersonId}`);

  const duplicateConflict = existingGrandparentPairs.has(`${canonicalPath.olderPersonId}|${canonicalPath.youngerPersonId}`);
  const isDuplicateCoveredByPublished = hasPublished;

  const duplicateDirectAssertion = duplicateConflict && !isDuplicateCoveredByPublished;

  const scripturalConflict = false;
  const chronologyConflict = false;

  const accepted = !identityConflict && !generationConflict && !scripturalConflict && !chronologyConflict && !duplicateDirectAssertion;
  const status = curatedCompositeAccepted
    ? (accepted ? 'accepted' : 'rejected')
    : directStatus === 'needs_textual_review'
      ? 'pending'
      : (accepted ? 'accepted' : 'rejected');

  const reason = curatedCompositeAccepted && status === 'accepted'
    ? `经逐项复核，两条已接受的直接父母断言 ${canonicalPath.premiseAssertionIds.join('、')} 构成唯一两代链；直接候选仅作路径提示，复合祖父母关系作为推论发布。`
    : status === 'pending'
    ? `两条候选父母断言 ${canonicalPath.premiseAssertionIds.join('、')} 已存在，需要后续文本复审后再发布。`
    : accepted
      ? `两条已接受的直接父母断言 ${canonicalPath.premiseAssertionIds.join('、')} 构成唯一两代链；未发现身份、年代、代际、经文或重复直接关系冲突。`
      : '两代链存在身份、代际或重复关系冲突；不得发布祖父母直接关系。';

  rows.push({
    review_id: '',
    candidate_relation_id: candidate.candidate_relation_id,
    subject_person_id: canonicalPath.olderPersonId,
    object_person_id: canonicalPath.youngerPersonId,
    relation_type: 'kinship',
    relation_subtype: 'grandparent',
    direction: 'directed',
    generation_delta: 2,
    premise_assertion_ids: [...canonicalPath.premiseAssertionIds],
    passages: [...new Set((candidate.passages || []).map((entry) => entry.passage))].sort(),
    rule: 'grandparent_from_two_direct_parent_edges',
    inference_order: INFERENCE_ORDER_BASE,
    inference_certainty: hasPublished ? CERTAINTY_BASE : 0.82,
    counterevidence_review: {
      identity_conflict: identityConflict,
      chronology_conflict: chronologyConflict,
      generation_conflict: generationConflict,
      scriptural_conflict: scripturalConflict,
      duplicate_direct_assertion: duplicateDirectAssertion,
      note: reason,
    },
    round_a: decision(status, 'editorial', reason),
    round_b: decision(status, 'critic', reason),
    final_decision: decision(status, 'boardroom', reason),
  });
}

const inferenceReviewKey = (row) => `${row.subject_person_id}|${row.object_person_id}|${canonicalPremiseSignature(row.premise_assertion_ids)}`;
const preservedRows = existingPublishedReviewRows.filter((row) =>
  row.final_decision?.status === 'accepted'
  && hasPublishedMatch(activeGrandparentInferenceIndex, row.subject_person_id, row.object_person_id, row.premise_assertion_ids)
);
const preservedByKey = new Map(preservedRows.map((row) => [inferenceReviewKey(row), row]));
const preservedReviewIds = new Set(preservedRows.map((row) => row.review_id));
const reconstructedPublishedRows = publishedGrandparentAssertions.map((assertion) => {
  const premiseAssertionIds = canonicalPremiseSignature(assertion.inference?.premise_assertion_ids || []).split('|');
  const key = `${assertion.subject_person_id}|${assertion.object_person_id}|${canonicalPremiseSignature(premiseAssertionIds)}`;
  const preserved = preservedByKey.get(key);
  if (preserved) return preserved;

  const candidates = [...(discoveryByPair.get(unorderedPairKey(assertion.subject_person_id, assertion.object_person_id)) || [])]
    .sort((a, b) => a.candidate_relation_id.localeCompare(b.candidate_relation_id));
  const premiseSignature = canonicalPremiseSignature(premiseAssertionIds);
  const candidate = candidates.find((entry) =>
    (entry.path_contexts || []).some((context) => canonicalPremiseSignature(context.assertion_ids || []) === premiseSignature)
  ) || candidates[0];
  if (!candidate) {
    throw new Error(`published grandparent assertion ${assertion.assertion_id} has no discovery candidate`);
  }

  const originalReviewId = String(assertion.editor_note || '').match(/ckir-\d{6}/)?.[0] || '';
  const extractedReviewId = preservedReviewIds.has(originalReviewId) ? '' : originalReviewId;
  const reason = `已发布祖父母关系 ${assertion.assertion_id} 由两条已接受的直接父母断言 ${premiseAssertionIds.join('、')} 构成；保留原三轮接受决定及完整构成路径。`;
  const storedCounterevidence = assertion.inference?.counterevidence_review || {};
  return {
    review_id: extractedReviewId,
    candidate_relation_id: candidate.candidate_relation_id,
    subject_person_id: assertion.subject_person_id,
    object_person_id: assertion.object_person_id,
    relation_type: 'kinship',
    relation_subtype: 'grandparent',
    direction: 'directed',
    generation_delta: 2,
    premise_assertion_ids: premiseAssertionIds,
    passages: [...new Set((assertion.evidence || []).map((entry) => entry.passage).filter(Boolean))].sort(),
    rule: 'grandparent_from_two_direct_parent_edges',
    inference_order: INFERENCE_ORDER_BASE,
    inference_certainty: Number(assertion.inference?.certainty ?? assertion.confidence ?? CERTAINTY_BASE),
    counterevidence_review: {
      identity_conflict: Boolean(storedCounterevidence.identity_conflict),
      chronology_conflict: Boolean(storedCounterevidence.chronology_conflict),
      generation_conflict: Boolean(storedCounterevidence.generation_conflict),
      scriptural_conflict: Boolean(storedCounterevidence.scriptural_conflict),
      duplicate_direct_assertion: false,
      note: String(storedCounterevidence.note || reason),
    },
    round_a: decision('accepted', 'editorial', reason),
    round_b: decision('accepted', 'critic', reason),
    final_decision: decision('accepted', 'boardroom', reason),
  };
});
const preservedKeys = new Set(reconstructedPublishedRows.map(inferenceReviewKey));
const novelRows = rows.filter((row) => !preservedKeys.has(inferenceReviewKey(row)));
novelRows.sort((a, b) =>
  a.subject_person_id.localeCompare(b.subject_person_id)
  || a.object_person_id.localeCompare(b.object_person_id)
  || a.candidate_relation_id.localeCompare(b.candidate_relation_id)
);
const usedReviewIds = new Set(reconstructedPublishedRows.map((row) => row.review_id).filter(Boolean));
let nextReviewNumber = reconstructedPublishedRows.reduce((max, row) => {
  const match = /^ckir-(\d+)$/.exec(row.review_id);
  return match ? Math.max(max, Number(match[1])) : max;
}, 0) + 1;
for (const row of [...reconstructedPublishedRows, ...novelRows]) {
  if (row.review_id) continue;
  while (usedReviewIds.has(`ckir-${String(nextReviewNumber).padStart(6, '0')}`)) nextReviewNumber += 1;
  row.review_id = `ckir-${String(nextReviewNumber).padStart(6, '0')}`;
  usedReviewIds.add(row.review_id);
  nextReviewNumber += 1;
}
rows.splice(0, rows.length, ...reconstructedPublishedRows, ...novelRows);
const seenFinalReviewIds = new Set();
let nextFinalReviewNumber = rows.reduce((max, row) => {
  const match = /^ckir-(\d+)$/.exec(row.review_id || '');
  return match ? Math.max(max, Number(match[1])) : max;
}, 0) + 1;
for (const row of rows) {
  if (row.review_id && !seenFinalReviewIds.has(row.review_id)) {
    seenFinalReviewIds.add(row.review_id);
    continue;
  }
  while (seenFinalReviewIds.has(`ckir-${String(nextFinalReviewNumber).padStart(6, '0')}`)) nextFinalReviewNumber += 1;
  row.review_id = `ckir-${String(nextFinalReviewNumber).padStart(6, '0')}`;
  seenFinalReviewIds.add(row.review_id);
  nextFinalReviewNumber += 1;
}
rows.sort((a, b) => a.review_id.localeCompare(b.review_id));

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const validationErrors = [];
const candidateIds = new Set();

for (const [index, row] of rows.entries()) {
  if (!validate(row)) {
    validationErrors.push(...(validate.errors || []).map((error) => `row ${index + 1}${error.instancePath}: ${error.message}`));
  }
  if (candidateIds.has(row.candidate_relation_id)) {
    validationErrors.push(`duplicate candidate_relation_id ${row.candidate_relation_id}`);
  }
  candidateIds.add(row.candidate_relation_id);
}

if (validationErrors.length) {
  throw new Error(validationErrors.slice(0, 100).join('\n'));
}

const snapshot = `${rows.map((row) => `${stableStringify(row)}\n`).join('')}`;
const reportWithoutHash = {
  generated_at: STAMP,
  dataset: 'composite-kinship-inference-review',
  rule: 'grandparent_from_two_direct_parent_edges',
  input_counts: {
    assertions: assertions.length,
    active_assertions: activeAssertions.length,
    direct_candidates: discoveryRows.length,
  },
  review_counts: {
    candidates: rows.length,
    accepted: rows.filter((row) => row.final_decision.status === 'accepted').length,
    rejected: rows.filter((row) => row.final_decision.status === 'rejected').length,
    pending: rows.filter((row) => row.final_decision.status === 'pending').length,
  },
  invariants: {
    uses_two_active_parent_premises: true,
    preserves_premise_assertion_ids: true,
    does_not_modify_assertions: true,
    does_not_treat_path_as_textually_explicit: true,
    preserves_published_review_rows: true,
  },
  input_snapshot_sha256: sha256(stableStringify({ assertions, discoveryRows, directReview: [...directReviewByCandidate.values()] })),
  row_snapshot_sha256: sha256(snapshot),
};

if (CHECK) {
  if (!fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, 'utf8') !== snapshot) {
    throw new Error('composite kinship review snapshot drift');
  }

  const existingReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (
    existingReport.input_snapshot_sha256 !== reportWithoutHash.input_snapshot_sha256 ||
    existingReport.row_snapshot_sha256 !== reportWithoutHash.row_snapshot_sha256
  ) {
    throw new Error('composite kinship review report hash mismatch');
  }

  console.log(JSON.stringify({ ...reportWithoutHash, mode: 'check', drift: false }, null, 2));
  process.exit(0);
}

if (APPLY) {
  atomicWrite(OUTPUT_PATH, snapshot);
  atomicWrite(REPORT_PATH, `${JSON.stringify(reportWithoutHash, null, 2)}\n`);
  console.log(JSON.stringify({ ...reportWithoutHash, mode: 'apply', rows_written: rows.length }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({ ...reportWithoutHash, mode: 'preview', rows, rows_written: rows.length }, null, 2));
