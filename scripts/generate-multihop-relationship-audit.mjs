#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'multihop-relationship-audit.schema.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const ASSERTIONS_PATH = path.join(DATA_DIR, 'assertions.jsonl');
const PEOPLE_PATH = path.join(DATA_DIR, 'people.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'multihop-relationship-audit-report.json');
const INDEX_PATH = path.join(EDITORIAL_DIR, 'multihop-relationship-audit.jsonl');
// Keep the index write gate aligned with the current bounded 2/3/4-hop full-audit row count.
const MAX_INDEX_ROWS = 200000;

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const TARGET_PATH_LENGTHS = [2, 3, 4];
const BASIC_KINSHIP_SUBTYPES = new Set(['parent', 'child', 'sibling', 'spouse', 'partner', 'concubine_partner']);
const EXPLAINABLE_KINSHIP_SUBTYPES = new Set([
  'grandparent', 'grandchild', 'uncle_aunt', 'nephew_niece', 'cousin',
  'parent_in_law', 'child_in_law', 'sibling_in_law'
]);

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL ${path.relative(ROOT, filePath)}:${i + 1}`);
      }
    });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function edgeReviewState(row) {
  return {
    assertion_status: String(row.status || ''),
    editorial_status: String(row.editorial_status || ''),
    inference_review_status: row.inference?.review_status || null,
    inferred: Boolean(row.inference)
  };
}

function pathSignature(pathSteps) {
  return pathSteps.map((step) => `${step.assertion_id}:${step.from_person_id}->${step.to_person_id}`).join('|');
}

function comparePaths(aSteps, bSteps, sourcePersonId) {
  if (!bSteps) return -1;
  if (aSteps.length !== bSteps.length) {
    return aSteps.length < bSteps.length ? -1 : 1;
  }

  const aCanonical = [sourcePersonId, ...aSteps.map((step) => `${step.to_person_id}`)];
  const bCanonical = [sourcePersonId, ...bSteps.map((step) => `${step.to_person_id}`)];
  for (let i = 0; i < aCanonical.length; i += 1) {
    const cmp = aCanonical[i].localeCompare(bCanonical[i]);
    if (cmp !== 0) return cmp;
  }

  const aSignature = pathSignature(aSteps);
  const bSignature = pathSignature(bSteps);
  if (aSignature !== bSignature) return aSignature < bSignature ? -1 : 1;

  const aMeta = aSteps
    .map((step) => `${step.assertion_direction || ''}|${step.traversal_direction || ''}|${step.relation_type || ''}|${step.relation_subtype || ''}`)
    .join('>');
  const bMeta = bSteps
    .map((step) => `${step.assertion_direction || ''}|${step.traversal_direction || ''}|${step.relation_type || ''}|${step.relation_subtype || ''}`)
    .join('>');
  if (aMeta !== bMeta) return aMeta < bMeta ? -1 : 1;
  return 0;
}

function isPathBetter(aSteps, bSteps, sourcePersonId) {
  return comparePaths(aSteps, bSteps, sourcePersonId) < 0;
}

function canonicalPathFromSteps(sourcePersonId, pathSteps) {
  const canonicalPersonIds = [sourcePersonId];
  for (const step of pathSteps) {
    canonicalPersonIds.push(step.to_person_id);
  }
  return canonicalPersonIds;
}

function deriveKinshipLevel(pathSteps) {
  if (pathSteps.length === 0) return null;
  if (!pathSteps.every((step) => String(step.relation_type || '') === 'kinship')) return null;

  const deltas = [];
  for (const step of pathSteps) {
    const subtype = String(step.relation_subtype || '').toLowerCase();
    const direction = String(step.assertion_direction || '').toLowerCase();
    const traversal = String(step.traversal_direction || '').toLowerCase();

    if (subtype === 'parent') {
      if (direction === 'directed' && traversal === 'forward') deltas.push(1);
      else if (direction === 'directed' && traversal === 'reverse') deltas.push(-1);
      else return null;
    } else if (subtype === 'child') {
      if (direction === 'directed' && traversal === 'forward') deltas.push(-1);
      else if (direction === 'directed' && traversal === 'reverse') deltas.push(1);
      else return null;
    } else {
      return null;
    }
  }

  const generationDelta = deltas.reduce((sum, value) => sum + value, 0);
  if (generationDelta === 0) return null;
  return generationDelta;
}

function aggregateReviewState(pathSteps) {
  const assertion_status_counts = new Map();
  const editorial_status_counts = new Map();
  const inference_review_status_counts = new Map();

  let inferred_count = 0;

  for (const step of pathSteps) {
    const assertionStatus = String(step.review_state.assertion_status || '');
    const editorialStatus = String(step.review_state.editorial_status || '');
    const inferenceReviewStatus = String(step.review_state.inference_review_status || 'pending');

    assertion_status_counts.set(assertionStatus, (assertion_status_counts.get(assertionStatus) || 0) + 1);
    editorial_status_counts.set(editorialStatus, (editorial_status_counts.get(editorialStatus) || 0) + 1);
    inference_review_status_counts.set(inferenceReviewStatus, (inference_review_status_counts.get(inferenceReviewStatus) || 0) + 1);
    if (step.review_state.inferred) inferred_count += 1;
  }

  return {
    assertion_count: pathSteps.length,
    assertion_status_counts: Object.fromEntries(assertion_status_counts),
    editorial_status_counts: Object.fromEntries(editorial_status_counts),
    inference_review_status_counts: Object.fromEntries(inference_review_status_counts),
    inferred_count,
    all_assertions_inferred: inferred_count === pathSteps.length
  };
}

function buildAdjacency(activeAssertions) {
  const adjacency = new Map();
  const edgeByIdByEndpoints = new Set();

  for (const row of activeAssertions) {
    if (!row.subject_person_id || !row.object_person_id) continue;
    const add = (from, to, traversal) => {
      const assertionId = String(row.assertion_id || '');
      const pairKey = `${from}|${to}|${assertionId}`;
      if (edgeByIdByEndpoints.has(pairKey)) return;
      edgeByIdByEndpoints.add(pairKey);

      const edges = adjacency.get(from) || [];
      edges.push({
        to,
        assertion_id: assertionId,
        relation_type: row.relation_type || null,
        relation_subtype: row.relation_subtype || null,
        assertion_direction: row.direction || '',
        traversal_direction: traversal,
        from_person_id: row.subject_person_id,
        object_person_id: row.object_person_id,
        review_state: edgeReviewState(row),
        passages: (row.evidence || [])
          .map((item) => String(item?.passage || '').trim())
          .filter(Boolean)
          .slice(0, 3)
      });
      adjacency.set(from, edges);
    };

    add(row.subject_person_id, row.object_person_id, 'forward');
    add(row.object_person_id, row.subject_person_id, 'reverse');
  }

  for (const edges of adjacency.values()) {
    edges.sort((a, b) => {
      return a.to.localeCompare(b.to)
        || a.assertion_id.localeCompare(b.assertion_id)
        || String(a.relation_type || '').localeCompare(String(a.relation_type || ''))
        || String(a.relation_subtype || '').localeCompare(String(a.relation_subtype || ''));
    });
  }
  return adjacency;
}

function hasNodeInPath(pathSteps, nextPersonId) {
  for (const step of pathSteps) {
    if (step.to_person_id === nextPersonId) return true;
  }
  return false;
}

function makePathRow(sourcePersonId, targetPersonId, pathSteps, pathPurpose = 'connection', explainsAssertionId = null) {
  const canonicalPersonIds = canonicalPathFromSteps(sourcePersonId, pathSteps);
  const premiseAssertions = pathSteps.map((step) => ({
    assertion_id: step.assertion_id,
    relation_type: step.relation_type || null,
    relation_subtype: step.relation_subtype || null,
    direction: step.assertion_direction || null,
    traversal_direction: step.traversal_direction || null
  }));
  const identity = `${pathPurpose}|${explainsAssertionId || ''}|${sourcePersonId}|${targetPersonId}|${pathSteps.map((step) => `${step.assertion_id}|${step.to_person_id}`).join('>')}`;
  return {
    derived_record_id: `mh-${sha256(identity).slice(0, 16)}`,
    path_purpose: pathPurpose,
    explains_assertion_id: explainsAssertionId,
    source_person_id: sourcePersonId,
    target_person_id: targetPersonId,
    canonical_person_path_ids: canonicalPersonIds,
    path_length: pathSteps.length,
    premise_assertion_ids: premiseAssertions.map((entry) => entry.assertion_id),
    premise_assertion_types: premiseAssertions,
    aggregate_review_state: aggregateReviewState(pathSteps),
    kinship_level: deriveKinshipLevel(pathSteps),
    path: pathSteps.map((step) => ({
      from_person_id: step.from_person_id,
      to_person_id: step.to_person_id,
      assertion_id: step.assertion_id,
      relation_type: step.relation_type,
      relation_subtype: step.relation_subtype,
      assertion_direction: step.assertion_direction,
      traversal_direction: step.traversal_direction
    }))
  };
}

function findKinshipExplanationPath(sourcePersonId, targetPersonId, adjacency) {
  const queue = [{ personId: sourcePersonId, path: [] }];
  const bestDepth = new Map([[sourcePersonId, 0]]);
  for (let i = 0; i < queue.length; i += 1) {
    const { personId, path: currentPath } = queue[i];
    if (currentPath.length >= 4) continue;
    for (const edge of adjacency.get(personId) || []) {
      const nextDepth = currentPath.length + 1;
      if (edge.to === sourcePersonId || hasNodeInPath(currentPath, edge.to)) continue;
      if (edge.to === targetPersonId && nextDepth === 1) continue;
      const nextPath = currentPath.concat([{
        from_person_id: personId,
        to_person_id: edge.to,
        assertion_id: edge.assertion_id,
        relation_type: edge.relation_type,
        relation_subtype: edge.relation_subtype,
        assertion_direction: edge.assertion_direction,
        traversal_direction: edge.traversal_direction,
        review_state: edge.review_state,
        passages: edge.passages
      }]);
      if (edge.to === targetPersonId && TARGET_PATH_LENGTHS.includes(nextDepth)) return nextPath;
      const previousDepth = bestDepth.get(edge.to);
      if (previousDepth !== undefined && previousDepth <= nextDepth) continue;
      bestDepth.set(edge.to, nextDepth);
      queue.push({ personId: edge.to, path: nextPath });
    }
  }
  return null;
}

function buildRowsFromSource(sourcePersonId, adjacency) {
  const queue = [{ personId: sourcePersonId, path: [] }];
  const shortestDepth = new Map([[sourcePersonId, 0]]);
  const shortestPaths = new Map([[sourcePersonId, []]]);

  for (let i = 0; i < queue.length; i += 1) {
    const { personId, path: currentPath } = queue[i];
    const depth = currentPath.length;
    if (depth >= 4) continue;
    const bestPathForPerson = shortestPaths.get(personId);
    if (personId !== sourcePersonId) {
      if (!bestPathForPerson) continue;
      if (comparePaths(currentPath, bestPathForPerson, sourcePersonId) !== 0) continue;
    }

    const outgoing = adjacency.get(personId) || [];
    for (const edge of outgoing) {
      const nextPersonId = edge.to;
      const nextDepth = depth + 1;
      if (nextDepth > 4) continue;

      if (nextPersonId === sourcePersonId) continue;
      if (hasNodeInPath(currentPath, nextPersonId)) continue;

      const nextPath = currentPath.concat([{
        from_person_id: personId,
        to_person_id: nextPersonId,
        assertion_id: edge.assertion_id,
        relation_type: edge.relation_type,
        relation_subtype: edge.relation_subtype,
        assertion_direction: edge.assertion_direction,
        traversal_direction: edge.traversal_direction,
        review_state: edge.review_state,
        passages: edge.passages
      }]);

      const existingDepth = shortestDepth.get(nextPersonId);
      const existingPath = shortestPaths.get(nextPersonId);
      if (existingDepth === undefined || nextDepth < existingDepth || (nextDepth === existingDepth && isPathBetter(nextPath, existingPath, sourcePersonId))) {
        shortestDepth.set(nextPersonId, nextDepth);
        shortestPaths.set(nextPersonId, nextPath);
        queue.push({ personId: nextPersonId, path: nextPath });
      }
    }
  }

  const rows = [];
  for (const [targetPersonId, pathSteps] of shortestPaths.entries()) {
    if (targetPersonId === sourcePersonId) continue;
    const pathLength = pathSteps.length;
    if (!TARGET_PATH_LENGTHS.includes(pathLength)) continue;
    rows.push(makePathRow(sourcePersonId, targetPersonId, pathSteps));
  }
  return rows;
}

function compareRows(a, b) {
  return a.source_person_id.localeCompare(b.source_person_id)
    || a.target_person_id.localeCompare(b.target_person_id)
    || a.path_purpose.localeCompare(b.path_purpose)
    || String(a.explains_assertion_id || '').localeCompare(String(b.explains_assertion_id || ''))
    || a.path_length - b.path_length
    || a.derived_record_id.localeCompare(b.derived_record_id);
}

function validateRows(rows, activeAssertionById, directPairKeys) {
  const errors = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row.derived_record_id || typeof row.derived_record_id !== 'string') {
      errors.push(`missing stable id ${row.source_person_id}->${row.target_person_id}`);
    }
    if (row.source_person_id === row.target_person_id) {
      errors.push(`self-pair produced: ${row.source_person_id}`);
    }
    if (row.path_length < 2 || row.path_length > 4) {
      errors.push(`invalid path length: ${row.source_person_id}->${row.target_person_id}`);
    }
    if (!Number.isInteger(row.path_length)) {
      errors.push(`non-integer path length for ${row.source_person_id}->${row.target_person_id}`);
    }
    if (!Array.isArray(row.path) || row.path.length !== row.path_length) {
      errors.push(`path length mismatch for ${row.source_person_id}->${row.target_person_id}`);
    }
    if (!Array.isArray(row.premise_assertion_ids) || row.premise_assertion_ids.length !== row.path_length) {
      errors.push(`premise assertion count mismatch for ${row.source_person_id}->${row.target_person_id}`);
    }
    if (!Array.isArray(row.canonical_person_path_ids) || row.canonical_person_path_ids.length !== row.path_length + 1) {
      errors.push(`person path mismatch for ${row.source_person_id}->${row.target_person_id}`);
    }
    if (row.premise_assertion_ids.some((value, i, list) => list.indexOf(value) !== i)) {
      errors.push(`duplicate premise assertion for ${row.source_person_id}->${row.target_person_id}`);
    }

    if (!['connection', 'kinship_explanation'].includes(row.path_purpose)) {
      errors.push(`invalid path purpose for ${row.derived_record_id}`);
    }
    const directPairKey = `${row.source_person_id}|${row.target_person_id}`;
    if (row.path_purpose === 'connection' && directPairKeys.has(directPairKey)) {
      errors.push(`connection path duplicates direct pair: ${directPairKey}`);
    }
    if (row.path_purpose === 'kinship_explanation') {
      const explained = activeAssertionById.get(row.explains_assertion_id);
      if (!explained || explained.relation_type !== 'kinship' || !EXPLAINABLE_KINSHIP_SUBTYPES.has(explained.relation_subtype)) {
        errors.push(`invalid explained assertion for ${row.derived_record_id}`);
      }
      if (row.premise_assertion_ids.includes(row.explains_assertion_id)) {
        errors.push(`explanation uses the assertion it explains: ${row.derived_record_id}`);
      }
      if (!row.path.every((step) => step.relation_type === 'kinship' && BASIC_KINSHIP_SUBTYPES.has(step.relation_subtype))) {
        errors.push(`explanation contains non-basic kinship step: ${row.derived_record_id}`);
      }
    } else if (row.explains_assertion_id !== null) {
      errors.push(`connection path has explains_assertion_id: ${row.derived_record_id}`);
    }

    const key = `${row.path_purpose}|${row.explains_assertion_id || ''}|${row.source_person_id}|${row.target_person_id}`;
    if (seen.has(key)) {
      errors.push(`duplicate row: ${key}`);
    }
    seen.add(key);
  }

  return errors;
}

function countReviewInconsistencies(rows) {
  let directPairs = 0;
  let selfPairs = 0;
  for (const row of rows) {
    if (row.path_length === 1) directPairs += 1;
    if (row.source_person_id === row.target_person_id) selfPairs += 1;
  }
  return { direct_pairs: directPairs, self_pairs: selfPairs };
}

function buildSnapshotLines(rows) {
  return rows.map(stableStringify).join('\n') + (rows.length ? '\n' : '');
}

const manifest = readJson(MANIFEST_PATH);
const allPeopleRows = readJsonl(PEOPLE_PATH);
const allAssertions = readJsonl(ASSERTIONS_PATH);
const activeAssertions = allAssertions.filter((row) => String(row.status || '').toLowerCase() === 'active');
const activeAssertionById = new Map(activeAssertions.map((row) => [row.assertion_id, row]));
const directPairKeys = new Set();
for (const row of activeAssertions) {
  directPairKeys.add(`${row.subject_person_id}|${row.object_person_id}`);
  directPairKeys.add(`${row.object_person_id}|${row.subject_person_id}`);
}
const activePersonIds = new Set();
for (const row of activeAssertions) {
  if (row.subject_person_id) activePersonIds.add(row.subject_person_id);
  if (row.object_person_id) activePersonIds.add(row.object_person_id);
}

const peopleSnapshotText = allPeopleRows
  .slice()
  .sort((a, b) => (a.person_id || '').localeCompare(b.person_id || ''))
  .map((row) => stableStringify({
    person_id: row.person_id,
    person_name: row.person_name,
    aliases: row.aliases || [],
    era: row.era || null
  }))
  .join('\n') + '\n';

const assertionSnapshotText = allAssertions
  .slice()
  .sort((a, b) => (a.assertion_id || '').localeCompare(b.assertion_id || ''))
  .map((row) => stableStringify({
    assertion_id: row.assertion_id,
    subject_person_id: row.subject_person_id,
    object_person_id: row.object_person_id,
    relation_type: row.relation_type,
    relation_subtype: row.relation_subtype || null,
    direction: row.direction || '',
    status: row.status,
    editorial_status: row.editorial_status,
    evidence: row.evidence || [],
    inference_rule: row.inference?.rule || null,
    inference: row.inference ? {
      premise_assertion_ids: (row.inference.premise_assertion_ids || []).slice().sort(),
      review_status: row.inference.review_status || null
    } : null
  }))
  .join('\n') + '\n';

const activeAssertionSnapshotText = activeAssertions
  .slice()
  .sort((a, b) => (a.assertion_id || '').localeCompare(b.assertion_id || ''))
  .map((row) => stableStringify({
    assertion_id: row.assertion_id,
    subject_person_id: row.subject_person_id,
    object_person_id: row.object_person_id,
    relation_type: row.relation_type,
    relation_subtype: row.relation_subtype || null,
    direction: row.direction || '',
    status: row.status,
    editorial_status: row.editorial_status,
    evidence: row.evidence || [],
    inference_rule: row.inference?.rule || null
  }))
  .join('\n') + '\n';

const ordinaryPathAssertions = activeAssertions.filter((row) => !(
  row.inference
  && row.relation_type === 'kinship'
  && EXPLAINABLE_KINSHIP_SUBTYPES.has(row.relation_subtype)
));
const adjacency = buildAdjacency(ordinaryPathAssertions);
const sourceIds = [...activePersonIds].sort();
const rows = [];
for (const sourcePersonId of sourceIds) {
  for (const row of buildRowsFromSource(sourcePersonId, adjacency)) {
    if (directPairKeys.has(`${row.source_person_id}|${row.target_person_id}`)) continue;
    rows.push(row);
  }
}

const basicKinshipAssertions = activeAssertions.filter((row) =>
  row.relation_type === 'kinship' && BASIC_KINSHIP_SUBTYPES.has(row.relation_subtype)
);
const basicKinshipAdjacency = buildAdjacency(basicKinshipAssertions);
for (const assertion of activeAssertions) {
  if (assertion.relation_type !== 'kinship' || !EXPLAINABLE_KINSHIP_SUBTYPES.has(assertion.relation_subtype)) continue;
  const explanationPath = findKinshipExplanationPath(
    assertion.subject_person_id,
    assertion.object_person_id,
    basicKinshipAdjacency
  );
  if (!explanationPath) continue;
  rows.push(makePathRow(
    assertion.subject_person_id,
    assertion.object_person_id,
    explanationPath,
    'kinship_explanation',
    assertion.assertion_id
  ));
}

const deterministicRows = rows
  .sort(compareRows)
  .map((row) => ({ ...row, aggregate_review_state: row.aggregate_review_state }));

const validationErrors = validateRows(deterministicRows, activeAssertionById, directPairKeys);
if (validationErrors.length) {
  throw new Error(`multihop audit row validation failed: ${validationErrors.slice(0, 50).join('; ')}`);
}

const countChecks = countReviewInconsistencies(deterministicRows);
if (countChecks.direct_pairs > 0 || countChecks.self_pairs > 0) {
  throw new Error(`multihop audit invariants failed: direct_pairs=${countChecks.direct_pairs}, self_pairs=${countChecks.self_pairs}`);
}

const rowSnapshot = buildSnapshotLines(deterministicRows);
const counts = deterministicRows.reduce((acc, row) => {
  const bucket = `distance_${row.path_length}`;
  acc[bucket] = (acc[bucket] || 0) + 1;
  return acc;
}, {});
const kinshipLabeledCount = deterministicRows.filter((row) => Number.isInteger(row.kinship_level)).length;
const uniqueTargetPairs = new Set();
const uniqueRouteKeys = new Set();
for (const row of deterministicRows) {
  uniqueTargetPairs.add(`${row.source_person_id}|${row.target_person_id}`);
  uniqueRouteKeys.add(`${row.path_purpose}|${row.explains_assertion_id || ''}|${row.source_person_id}|${row.target_person_id}`);
}
if (deterministicRows.length !== uniqueRouteKeys.size) {
  throw new Error(`multihop audit invariants failed: total_paths=${deterministicRows.length} != unique_route_count=${uniqueRouteKeys.size}`);
}
const connectionPathCount = deterministicRows.filter((row) => row.path_purpose === 'connection').length;
const kinshipExplanationCount = deterministicRows.filter((row) => row.path_purpose === 'kinship_explanation').length;

const reportWithoutHash = {
  generated_at: manifest.created_at,
  audit_version: 'v3',
  manifest_created_at: manifest.created_at,
  input_snapshot: {
    manifest_created_at: manifest.created_at,
    people_total: allPeopleRows.length,
    assertions_total: allAssertions.length,
    assertions_active: activeAssertions.length,
    people_snapshot_sha256: sha256(peopleSnapshotText),
    assertions_snapshot_sha256: sha256(assertionSnapshotText),
    assertions_active_snapshot_sha256: sha256(activeAssertionSnapshotText),
    generated_from: path.relative(ROOT, ASSERTIONS_PATH)
  },
  graph_scope: {
    active_people_in_graph: sourceIds.length,
    active_assertions_in_graph: ordinaryPathAssertions.length
  },
  path_counts: {
    distance_2: counts.distance_2 || 0,
    distance_3: counts.distance_3 || 0,
    distance_4: counts.distance_4 || 0,
    connection_paths: connectionPathCount,
    kinship_explanation_paths: kinshipExplanationCount,
    total_pairs: deterministicRows.length,
    unique_pair_count: uniqueTargetPairs.size
  },
  kinship_labels: {
    labelled_pairs: kinshipLabeledCount,
    unlabelled_pairs: deterministicRows.length - kinshipLabeledCount
  },
  invariant: {
    uses_active_assertions_only: true,
    does_not_modify_assertions: true,
    does_not_add_direct_edges: true,
    excludes_inferred_composite_shortcuts: true
  },
  output: {
    index_written: deterministicRows.length <= MAX_INDEX_ROWS,
    index_rows_expected: deterministicRows.length,
    index_path: path.relative(ROOT, INDEX_PATH),
    max_index_rows: MAX_INDEX_ROWS,
    row_snapshot_sha256: sha256(rowSnapshot),
    report_snapshot_sha256: ''
  },
  validate: {
    mode: CHECK ? 'check' : 'apply',
    no_self_pairs: true,
    no_unapproved_direct_pair_paths: true,
    direct_pair_paths_limited_to_kinship_explanations: true,
    shortest_path_only: true,
    path_lengths: TARGET_PATH_LENGTHS,
    deterministic_sort: [
      'source_person_id',
      'target_person_id',
      'path_purpose',
      'explains_assertion_id',
      'path_length',
      'derived_record_id'
    ],
    input_file_hashes: ['people.jsonl', 'assertions.jsonl', 'manifest.json']
  }
};

const reportForHash = {
  ...reportWithoutHash,
  validate: {
    ...reportWithoutHash.validate,
    mode: 'snapshot'
  },
  output: {
    ...reportWithoutHash.output,
    report_snapshot_sha256: undefined
  },
  generated_at: undefined,
  manifest_created_at: manifest.created_at
};
reportWithoutHash.output.report_snapshot_sha256 = sha256(stableStringify(reportForHash));

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
addFormats(ajv);
if (!ajv.validate(schema, reportWithoutHash)) {
  const details = ajv.errors?.map((err) => `${err.instancePath}: ${err.message}`).join('; ');
  throw new Error(`Invalid report: ${details}`);
}

if (CHECK) {
  const existing = readJson(REPORT_PATH);
  if (!ajv.validate(schema, existing)) {
    const details = ajv.errors?.map((err) => `${err.instancePath}: ${err.message}`).join('; ');
    throw new Error(`Existing report invalid: ${details}`);
  }
  if (existing.output?.row_snapshot_sha256 !== reportWithoutHash.output.row_snapshot_sha256) {
    throw new Error('multihop audit check failed: row snapshot changed');
  }
if (existing.output?.report_snapshot_sha256 !== reportWithoutHash.output.report_snapshot_sha256) {
  throw new Error('multihop audit check failed: report snapshot changed');
}
  if (reportWithoutHash.output.index_written) {
    if (deterministicRows.length > MAX_INDEX_ROWS) {
      throw new Error('multihop audit check failed: generation skipped index but existing report expects index');
    }
    if (!fs.existsSync(INDEX_PATH)) {
      throw new Error('multihop audit check failed: index file missing');
    }
    const existingIndex = fs.readFileSync(INDEX_PATH, 'utf8');
    if (sha256(existingIndex) !== reportWithoutHash.output.row_snapshot_sha256) {
      throw new Error('multihop audit check failed: index snapshot changed');
    }
  } else if (deterministicRows.length <= MAX_INDEX_ROWS && fs.existsSync(INDEX_PATH)) {
    throw new Error('multihop audit check failed: existing index file should not exist for no-write mode');
  }
  console.log(JSON.stringify({ check: 'passed', rows: deterministicRows.length, ...reportWithoutHash }, null, 2));
  process.exit(0);
}

if (APPLY) {
  if (reportWithoutHash.output.index_written) {
    fs.writeFileSync(INDEX_PATH, `${deterministicRows.map((row) => `${stableStringify(row)}\n`).join('')}`);
  } else if (fs.existsSync(INDEX_PATH)) {
    fs.unlinkSync(INDEX_PATH);
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(reportWithoutHash, null, 2)}\n`);
}

console.log(JSON.stringify({ ...reportWithoutHash, rows: deterministicRows.length }, null, 2));
