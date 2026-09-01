#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSERTIONS_PATH = path.join(ROOT, 'data', 'assertions.jsonl');
const IDENTITIES_PATH = path.join(ROOT, 'data', 'identity-options.jsonl');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'extended-kinship-candidates.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'extended-kinship-candidates-report.json');
const CHECK = process.argv.includes('--check');
const APPLY = process.argv.includes('--apply');
const STAMP = '2026-08-31T00:00:00Z';

if (CHECK && APPLY) throw new Error('do not pass both --check and --apply');

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

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}

function normalizedParentEdge(assertion) {
  if (assertion.relation_type !== 'kinship' || assertion.direction !== 'directed') return null;
  if (assertion.relation_subtype === 'parent') {
    return { parent: assertion.subject_person_id, child: assertion.object_person_id, assertion };
  }
  if (assertion.relation_subtype === 'child') {
    return { parent: assertion.object_person_id, child: assertion.subject_person_id, assertion };
  }
  return null;
}

function isAcceptedInference(assertion) {
  return Boolean(assertion.inference)
    && assertion.inference.review_status === 'three_round_accepted';
}

function premisePassages(assertions) {
  return [...new Set(assertions.flatMap((assertion) =>
    (assertion.evidence || []).map((item) => String(item?.passage || '').trim()).filter(Boolean)
  ))].sort();
}

function canonicalPremiseSignature(assertionIds) {
  return [...(assertionIds || [])].map(String).sort().join('|');
}

function candidateRank(candidate) {
  return [candidate.inferred_premise_count, candidate.premise_assertion_ids.join('|')];
}

function isBetterCandidate(candidate, existing) {
  const a = candidateRank(candidate);
  const b = candidateRank(existing);
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

const assertions = readJsonl(ASSERTIONS_PATH);
const activeAssertions = assertions.filter((row) => row.status === 'active');
const disputedPeople = new Set(
  readJsonl(IDENTITIES_PATH)
    .filter((row) => row.status === 'disputed')
    .map((row) => row.person_id)
);

const parentEdges = activeAssertions.map(normalizedParentEdge).filter(Boolean);
const childrenByParent = new Map();
for (const edge of parentEdges) {
  const list = childrenByParent.get(edge.parent) || [];
  list.push(edge);
  childrenByParent.set(edge.parent, list);
}

const siblingEdges = activeAssertions.filter((row) =>
  row.relation_type === 'kinship'
  && row.relation_subtype === 'sibling'
  && row.direction === 'undirected'
  && (!row.inference || isAcceptedInference(row))
);

const siblingAdjacency = new Map();
for (const assertion of siblingEdges) {
  const add = (person, sibling) => {
    const list = siblingAdjacency.get(person) || [];
    list.push({ sibling, assertion });
    siblingAdjacency.set(person, list);
  };
  add(assertion.subject_person_id, assertion.object_person_id);
  add(assertion.object_person_id, assertion.subject_person_id);
}

const activeBySubtypePair = new Map();
for (const row of activeAssertions) {
  const directed = row.direction === 'directed';
  const pair = directed
    ? `${row.subject_person_id}|${row.object_person_id}`
    : [row.subject_person_id, row.object_person_id].sort().join('|');
  const key = `${row.relation_type}|${row.relation_subtype || ''}|${row.direction}|${pair}`;
  const list = activeBySubtypePair.get(key) || [];
  list.push(row);
  activeBySubtypePair.set(key, list);
}
const basicKinshipPairs = new Set(
  activeAssertions
    .filter((row) => row.relation_type === 'kinship'
      && ['parent', 'child', 'sibling', 'spouse', 'partner'].includes(row.relation_subtype))
    .map((row) => [row.subject_person_id, row.object_person_id].sort().join('|'))
);
const partnerPairs = new Set(
  activeAssertions
    .filter((row) => row.relation_type === 'kinship'
      && ['spouse', 'partner'].includes(row.relation_subtype))
    .map((row) => [row.subject_person_id, row.object_person_id].sort().join('|'))
);

const candidateByKey = new Map();

function addCandidate(candidate) {
  if (candidate.subject_person_id === candidate.object_person_id) return;
  const identityConflict = disputedPeople.has(candidate.subject_person_id)
    || disputedPeople.has(candidate.object_person_id)
    || candidate.path_person_ids.some((personId) => disputedPeople.has(personId));
  const inferredPremises = candidate.premises.filter((assertion) => Boolean(assertion.inference));
  if (inferredPremises.some((assertion) => !isAcceptedInference(assertion))) return;
  if (inferredPremises.length > 1) return;

  const pair = candidate.direction === 'directed'
    ? `${candidate.subject_person_id}|${candidate.object_person_id}`
    : [candidate.subject_person_id, candidate.object_person_id].sort().join('|');
  const undirectedPair = [candidate.subject_person_id, candidate.object_person_id].sort().join('|');
  const key = `${candidate.relation_subtype}|${candidate.direction}|${pair}`;
  const existingKey = `kinship|${candidate.relation_subtype}|${candidate.direction}|${pair}`;
  const inferredCount = inferredPremises.length;
  const premiseIds = candidate.premises.map((row) => row.assertion_id);
  const existingRows = activeBySubtypePair.get(existingKey) || [];
  const exactPublished = existingRows.some((row) => row.inference?.rule === candidate.rule
    && canonicalPremiseSignature(row.inference?.premise_assertion_ids || []) === canonicalPremiseSignature(premiseIds));
  const existingSignatureConflict = existingRows.length > 0 && !exactPublished;
  const primaryRelationshipConflict = basicKinshipPairs.has(undirectedPair);
  const parentSiblingPairAlsoPartners = Boolean(candidate.parent_sibling_pair)
    && partnerPairs.has([...candidate.parent_sibling_pair].sort().join('|'));
  const generationConflict = primaryRelationshipConflict || parentSiblingPairAlsoPartners;
  const row = {
    candidate_id: '',
    subject_person_id: candidate.subject_person_id,
    object_person_id: candidate.object_person_id,
    relation_type: 'kinship',
    relation_subtype: candidate.relation_subtype,
    inverse_relation_subtype: candidate.inverse_relation_subtype || null,
    direction: candidate.direction,
    rule: candidate.rule,
    path_person_ids: candidate.path_person_ids,
    premise_assertion_ids: premiseIds,
    passages: premisePassages(candidate.premises),
    inference_order: inferredCount ? 2 : 1,
    inferred_premise_count: inferredCount,
    inference_certainty: candidate.certainty[inferredCount ? 1 : 0],
    review_status: exactPublished
      ? 'covered_existing'
      : identityConflict
        ? 'rejected_ambiguous_identity'
        : existingSignatureConflict
          ? 'rejected_existing_assertion_conflict'
        : generationConflict
          ? 'rejected_primary_relationship_conflict'
          : 'needs_three_round_review',
    counterevidence_review: {
      identity_conflict: identityConflict,
      chronology_conflict: false,
      generation_conflict: generationConflict,
      scriptural_conflict: false,
      note: identityConflict
        ? '路径包含 disputed 身份；不得自动发布。'
        : existingSignatureConflict
          ? '同一关系签名已有不同规则或不同前提的 active assertion；必须人工合并，不能自动覆盖。'
        : primaryRelationshipConflict
          ? '端点已有父子、手足或配偶等更基础关系；不得再自动发布扩展亲属关系。'
          : parentSiblingPairAlsoPartners
            ? '构成路径中的父母手足对同时也是配偶；子代关系不得按普通堂表亲或叔侄规则推导。'
        : '候选仅由 active 亲属前提构成；仍须完成 Editorial、Critic 与 Boardroom 三轮复核。',
    },
  };
  if (!row.passages.length) return;
  const existing = candidateByKey.get(key);
  if (!existing || isBetterCandidate(row, existing)) candidateByKey.set(key, row);
}

// sibling(parent, uncle/aunt) + parent(parent, child) => uncle/aunt -> nephew/niece
for (const parentEdge of parentEdges) {
  for (const siblingEdge of siblingAdjacency.get(parentEdge.parent) || []) {
    addCandidate({
      subject_person_id: siblingEdge.sibling,
      object_person_id: parentEdge.child,
      relation_subtype: 'uncle_aunt',
      inverse_relation_subtype: 'nephew_niece',
      direction: 'directed',
      rule: 'uncle_aunt_from_sibling_and_parent_edges',
      path_person_ids: [siblingEdge.sibling, parentEdge.parent, parentEdge.child],
      premises: [siblingEdge.assertion, parentEdge.assertion],
      parent_sibling_pair: [siblingEdge.sibling, parentEdge.parent],
      certainty: [0.78, 0.72],
    });
  }
}

// parent(parentA, personA) + sibling(parentA, parentB) + parent(parentB, personB) => cousins
const seenSiblingAssertions = new Set();
for (const siblingAssertion of siblingEdges) {
  if (seenSiblingAssertions.has(siblingAssertion.assertion_id)) continue;
  seenSiblingAssertions.add(siblingAssertion.assertion_id);
  const parentA = siblingAssertion.subject_person_id;
  const parentB = siblingAssertion.object_person_id;
  for (const childA of childrenByParent.get(parentA) || []) {
    for (const childB of childrenByParent.get(parentB) || []) {
      if (childA.child === childB.child) continue;
      const [subject, object] = [childA.child, childB.child].sort();
      const subjectEdge = subject === childA.child ? childA : childB;
      const objectEdge = object === childB.child ? childB : childA;
      addCandidate({
        subject_person_id: subject,
        object_person_id: object,
        relation_subtype: 'cousin',
        direction: 'undirected',
        rule: 'cousin_from_sibling_and_two_parent_edges',
        path_person_ids: [subject, subjectEdge.parent, objectEdge.parent, object],
        premises: [subjectEdge.assertion, siblingAssertion, objectEdge.assertion],
        parent_sibling_pair: [parentA, parentB],
        certainty: [0.74, 0.68],
      });
    }
  }
}

const rows = [...candidateByKey.values()].sort((a, b) =>
  a.relation_subtype.localeCompare(b.relation_subtype)
  || a.subject_person_id.localeCompare(b.subject_person_id)
  || a.object_person_id.localeCompare(b.object_person_id)
  || a.premise_assertion_ids.join('|').localeCompare(b.premise_assertion_ids.join('|'))
);
rows.forEach((row, index) => { row.candidate_id = `ekc-${String(index + 1).padStart(6, '0')}`; });

const errors = [];
const ids = new Set();
for (const row of rows) {
  if (ids.has(row.candidate_id)) errors.push(`duplicate candidate_id ${row.candidate_id}`);
  ids.add(row.candidate_id);
  if (new Set(row.path_person_ids).size !== row.path_person_ids.length) errors.push(`cyclic person path ${row.candidate_id}`);
  if (new Set(row.premise_assertion_ids).size !== row.premise_assertion_ids.length) errors.push(`duplicate premise ${row.candidate_id}`);
  if (row.path_person_ids[0] !== row.subject_person_id || row.path_person_ids.at(-1) !== row.object_person_id) {
    errors.push(`path endpoint mismatch ${row.candidate_id}`);
  }
  if (![2, 3].includes(row.premise_assertion_ids.length)) errors.push(`invalid path length ${row.candidate_id}`);
  if (row.inferred_premise_count > 1) errors.push(`too many inferred premises ${row.candidate_id}`);
}
if (errors.length) throw new Error(errors.slice(0, 100).join('\n'));

const snapshot = rows.map((row) => `${stableStringify(row)}\n`).join('');
const report = {
  generated_at: STAMP,
  dataset: 'extended-kinship-candidates',
  scope: ['uncle_aunt', 'cousin'],
  counts: {
    total: rows.length,
    uncle_aunt: rows.filter((row) => row.relation_subtype === 'uncle_aunt').length,
    cousin: rows.filter((row) => row.relation_subtype === 'cousin').length,
    needs_three_round_review: rows.filter((row) => row.review_status === 'needs_three_round_review').length,
    covered_existing: rows.filter((row) => row.review_status === 'covered_existing').length,
    rejected_ambiguous_identity: rows.filter((row) => row.review_status === 'rejected_ambiguous_identity').length,
    rejected_existing_assertion_conflict: rows.filter((row) => row.review_status === 'rejected_existing_assertion_conflict').length,
    rejected_primary_relationship_conflict: rows.filter((row) => row.review_status === 'rejected_primary_relationship_conflict').length,
    second_order: rows.filter((row) => row.inference_order === 2).length,
  },
  invariants: {
    uses_active_assertions_only: true,
    preserves_path_person_ids: true,
    preserves_premise_assertion_ids: true,
    maximum_one_accepted_inference_premise: true,
    does_not_modify_assertions: true,
    does_not_publish_candidates: true,
  },
  input_snapshot_sha256: sha256(stableStringify({ assertions: activeAssertions, disputedPeople: [...disputedPeople].sort() })),
  row_snapshot_sha256: sha256(snapshot),
};

if (CHECK) {
  if (!fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, 'utf8') !== snapshot) {
    throw new Error('extended kinship candidate snapshot drift');
  }
  const existingReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (existingReport.input_snapshot_sha256 !== report.input_snapshot_sha256
    || existingReport.row_snapshot_sha256 !== report.row_snapshot_sha256) {
    throw new Error('extended kinship candidate report drift');
  }
  console.log(JSON.stringify({ ...report, mode: 'check' }, null, 2));
  process.exit(0);
}

if (APPLY) {
  atomicWrite(OUTPUT_PATH, snapshot);
  atomicWrite(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, mode: 'apply' }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({ ...report, mode: 'preview' }, null, 2));
