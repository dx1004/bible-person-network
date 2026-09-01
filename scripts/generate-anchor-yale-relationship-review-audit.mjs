#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

const ASSERTIONS_PATH = path.join(DATA_DIR, 'assertions.jsonl');
const SYSTEMATIC_REVIEW_PATH = path.join(EDITORIAL_DIR, 'anchor-yale-systematic-review.jsonl');
const REL_SEARCH_AUDIT_PATH = path.join(EDITORIAL_DIR, 'anchor-yale-relationship-search-audit.jsonl');
const CANDIDATE_PERSON_MAP_PATH = path.join(ROOT, 'exports', 'old-testament-candidate-person-map.json');
const OUTPUT_PATH = path.join(EDITORIAL_DIR, 'anchor-yale-relationship-review-audit.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'anchor-yale-relationship-review-audit-report.json');
const DERIVED_OUTPUT_PATH = path.join(EDITORIAL_DIR, 'anchor-yale-derived-context-matches.jsonl');
const DERIVED_REPORT_PATH = path.join(EDITORIAL_DIR, 'anchor-yale-derived-context-matches-report.json');
const SCHEMA_PATH = path.join(SCHEMAS_DIR, 'anchor-yale-relationship-review-audit.schema.json');
const DERIVED_SCHEMA_PATH = path.join(SCHEMAS_DIR, 'anchor-yale-derived-context-match.schema.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CAPTURE_ARG = args.find((item) => item.startsWith('--capture='));
const HAS_CAPTURE = Boolean(CAPTURE_ARG);
const CAPTURE_PATH = HAS_CAPTURE ? CAPTURE_ARG.split('=')[1] : null;

const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
addFormats(ajv);

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    throw new Error(`${path.relative(ROOT, filePath)}: invalid JSON (${error.message})`);
  }
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw
    ? raw
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line);
          } catch {
            throw new Error(`${path.relative(ROOT, filePath)}:${index + 1} invalid JSON`);
          }
        })
    : [];
}

function coerceTimestamp(value) {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.valueOf()) ? null : dt.toISOString();
}

function stableSortByLocator(a, b) {
  return (a.locator || '').localeCompare(b.locator || '')
    || (a.article_person_id || '').localeCompare(b.article_person_id || '')
    || (a.counterpart_person_id || '').localeCompare(b.counterpart_person_id || '')
    || (a.assertion_id || '').localeCompare(b.assertion_id || '');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function firstFieldDiff(expected, actual) {
  const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
  for (const key of [...keys].sort()) {
    if (stableStringify(expected?.[key]) !== stableStringify(actual?.[key])) return key;
  }
  return 'unknown';
}

function readDerivedCapture(capturePath) {
  if (!capturePath) return null;
  if (!fs.existsSync(capturePath)) {
    throw new Error(`capture file not found at ${capturePath}`);
  }

  const payload = readJson(capturePath);
  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error(`Invalid derived capture format at ${capturePath}`);
  }

  const rowsByAssertion = new Map();
  for (const row of payload.rows) {
    if (!row || !row.assertion_id) continue;
    const list = rowsByAssertion.get(row.assertion_id) || [];
    list.push({
      assertion_id: row.assertion_id,
      article_person_id: row.article_person_id,
      counterpart_person_id: row.counterpart_person_id,
      derivation: row.derivation || 'visible_search_context_name_and_relation_term',
      locator: row.locator || '',
      matched_counterpart_names: Array.isArray(row.matched_counterpart_names)
        ? row.matched_counterpart_names
        : [],
      matched_relation_terms: Array.isArray(row.matched_relation_terms)
        ? row.matched_relation_terms
        : []
    });
    rowsByAssertion.set(row.assertion_id, list);
  }

  for (const list of rowsByAssertion.values()) {
    list.sort(stableSortByLocator);
  }

  return {
    capturedAt: coerceTimestamp(payload.captured_at),
    rowsByAssertion
  };
}

function readPersistedDerivedCapture() {
  if (!fs.existsSync(DERIVED_OUTPUT_PATH)) return null;
  const rows = readJsonl(DERIVED_OUTPUT_PATH);
  const rowsByAssertion = new Map();
  for (const row of rows) {
    const list = rowsByAssertion.get(row.assertion_id) || [];
    list.push({
      assertion_id: row.assertion_id,
      article_person_id: row.article_person_id,
      counterpart_person_id: row.counterpart_person_id,
      derivation: row.derivation,
      locator: row.locator,
      matched_counterpart_names: row.matched_counterpart_names || [],
      matched_relation_terms: row.matched_relation_terms || []
    });
    rowsByAssertion.set(row.assertion_id, list);
  }
  for (const list of rowsByAssertion.values()) list.sort(stableSortByLocator);
  const reportTimestamp = fs.existsSync(DERIVED_REPORT_PATH)
    ? coerceTimestamp(readJson(DERIVED_REPORT_PATH)?.generated_at)
    : null;
  return { capturedAt: reportTimestamp, rowsByAssertion };
}

function deriveHeadwordStatus(candidateIds, systematicByCandidate) {
  if (!candidateIds || candidateIds.length === 0) {
    return { status: 'unknown_person', reasons: [] };
  }

  const headwordStatus = candidateIds
    .map((id) => systematicByCandidate.get(id)?.headword_status)
    .filter(Boolean);
  const directCount = headwordStatus.filter((value) => value === 'direct_hit').length;

  if (directCount === 0) {
    return { status: 'no_headword_match', reasons: ['no_headword_match'] };
  }
  if (directCount > 1) {
    return { status: 'mapped_ambiguous', reasons: ['ambiguous_candidate'] };
  }
  return { status: 'mapped_direct', reasons: [] };
}

const manifest = readJson(path.join(DATA_DIR, 'manifest.json'));
const fallbackAuditAt = coerceTimestamp(manifest?.created_at) || new Date(0).toISOString();

const assertions = readJsonl(ASSERTIONS_PATH);
const systematicRows = readJsonl(SYSTEMATIC_REVIEW_PATH);
const relationshipSearchRows = readJsonl(REL_SEARCH_AUDIT_PATH);
const candidatePersonMap = readJson(CANDIDATE_PERSON_MAP_PATH);

// Regeneration requires an explicit browser capture. Ordinary checks reconstruct
// the same derived context from the versioned audit, never from /private/tmp.
const captured = HAS_CAPTURE ? readDerivedCapture(CAPTURE_PATH) : readPersistedDerivedCapture();
const AUDIT_AT = captured?.capturedAt || fallbackAuditAt;

const systematicByCandidate = new Map(systematicRows.map((row) => [row.candidate_id, row]));
const mapRows = Array.isArray(candidatePersonMap?.rows) ? candidatePersonMap.rows : [];
const personToCandidates = new Map();
for (const row of mapRows) {
  const set = personToCandidates.get(row.person_id) || new Set();
  set.add(row.candidate_id);
  personToCandidates.set(row.person_id, set);
}

const searchIndexByCandidate = new Map();
for (const row of relationshipSearchRows) {
  for (const candidateId of row.candidate_ids || []) {
    const list = searchIndexByCandidate.get(candidateId) || [];
    list.push(row);
    searchIndexByCandidate.set(candidateId, list);
  }
}

const relationshipIndexByAssertion = new Map();
for (const assertion of assertions) {
  const row = {
    source_id: 'source:0009',
    assertion_id: assertion.assertion_id,
    subject_person_id: assertion.subject_person_id,
    object_person_id: assertion.object_person_id,
    relation_type: assertion.relation_type,
    relation_subtype: assertion.relation_subtype,
    direction: assertion.direction,
    subject_candidate_ids: [],
    object_candidate_ids: [],
    subject_headword_status: 'unknown_person',
    object_headword_status: 'unknown_person',
    search_overlap: {
      subject_candidate_matches: [],
      object_candidate_matches: [],
      shared_candidate_ids: [],
      shared_locators: [],
      shared_locator_count: 0,
      subject_locator_count: 0,
      object_locator_count: 0
    },
    review_status: 'pending',
    review_basis: 'candidate-headword-and-search-metadata-only',
    needs_manual_review_reason: [],
    source_text_stored: false,
    snippets_stored: false,
    reviewed_at: AUDIT_AT,
    derived_context_matches: []
  };

  const subjectCandidates = [...(personToCandidates.get(assertion.subject_person_id) || [])].sort();
  const objectCandidates = [...(personToCandidates.get(assertion.object_person_id) || [])].sort();

  row.subject_candidate_ids = subjectCandidates;
  row.object_candidate_ids = objectCandidates;

  if (!assertion.subject_person_id || !subjectCandidates.length) {
    row.subject_headword_status = 'unknown_person';
    row.needs_manual_review_reason.push('no_subject_mapping');
  } else {
    const subjectStatus = deriveHeadwordStatus(subjectCandidates, systematicByCandidate);
    row.subject_headword_status = subjectStatus.status;
    row.needs_manual_review_reason.push(...subjectStatus.reasons);
  }

  if (!assertion.object_person_id || !objectCandidates.length) {
    row.object_headword_status = 'unknown_person';
    row.needs_manual_review_reason.push('no_object_mapping');
  } else {
    const objectStatus = deriveHeadwordStatus(objectCandidates, systematicByCandidate);
    row.object_headword_status = objectStatus.status;
    row.needs_manual_review_reason.push(...objectStatus.reasons);
  }

  if (subjectCandidates.length > 1 || objectCandidates.length > 1) {
    row.needs_manual_review_reason.push('multi_match');
  }

  if (!assertion.evidence?.some((item) => item?.source_id === 'source:0009')) {
    row.needs_manual_review_reason.push('metadata_not_corroborated');
  }

  row.needs_manual_review_reason = [...new Set(row.needs_manual_review_reason)];

  const subjectMatches = new Map();
  const objectMatches = new Map();

  for (const candidateId of subjectCandidates) {
    const matches = searchIndexByCandidate.get(candidateId) || [];
    for (const searchRow of matches) {
      const key = `${searchRow.locator}|${searchRow.article_title || ''}`;
      subjectMatches.set(key, searchRow);
    }
  }

  for (const candidateId of objectCandidates) {
    const matches = searchIndexByCandidate.get(candidateId) || [];
    for (const searchRow of matches) {
      const key = `${searchRow.locator}|${searchRow.article_title || ''}`;
      objectMatches.set(key, searchRow);
    }
  }

  const subjectMatchList = [...subjectMatches.values()]
    .map((item) => ({
      article_title: item.article_title,
      locator: item.locator,
      candidate_ids: [...(item.candidate_ids || [])].sort()
    }))
    .sort((a, b) => a.locator.localeCompare(b.locator));

  const objectMatchList = [...objectMatches.values()]
    .map((item) => ({
      article_title: item.article_title,
      locator: item.locator,
      candidate_ids: [...(item.candidate_ids || [])].sort()
    }))
    .sort((a, b) => a.locator.localeCompare(b.locator));

  row.search_overlap.subject_candidate_matches = subjectMatchList;
  row.search_overlap.object_candidate_matches = objectMatchList;
  row.search_overlap.subject_locator_count = subjectMatchList.length;
  row.search_overlap.object_locator_count = objectMatchList.length;

  const sharedRows = [];
  for (const [key, searchItem] of subjectMatches.entries()) {
    if (objectMatches.has(key)) {
      sharedRows.push({
        article_title: searchItem.article_title,
        locator: searchItem.locator,
        shared_candidate_ids: [...(searchItem.candidate_ids || [])].sort()
      });
    }
  }

  const sharedCandidateSet = new Set();
  for (const sharedRow of sharedRows) {
    for (const candidateId of sharedRow.shared_candidate_ids) {
      sharedCandidateSet.add(candidateId);
    }
  }
  sharedRows.sort((a, b) => a.locator.localeCompare(b.locator));
  row.search_overlap.shared_candidate_ids = [...sharedCandidateSet].sort();
  row.search_overlap.shared_locators = sharedRows.map((item) => item.locator);
  row.search_overlap.shared_locator_count = sharedRows.length;

  const derivedForAssertion = captured
    ? captured.rowsByAssertion.get(assertion.assertion_id) || []
    : [];
  row.derived_context_matches = derivedForAssertion
    .map((item) => ({
      assertion_id: assertion.assertion_id,
      article_person_id: item.article_person_id || assertion.subject_person_id,
      counterpart_person_id: item.counterpart_person_id || assertion.object_person_id,
      locator: item.locator || '',
      matched_counterpart_names: item.matched_counterpart_names || [],
      matched_relation_terms: item.matched_relation_terms || [],
      derivation: item.derivation || 'visible_search_context_name_and_relation_term',
      source_text_stored: false,
      snippets_stored: false
    }))
    .sort(stableSortByLocator);

  const hasIdentityAmbiguity = row.needs_manual_review_reason.some((reason) =>
    ['ambiguous_candidate', 'multi_match'].includes(reason)
  );
  const outsideOtCandidateMap = row.needs_manual_review_reason.some((reason) =>
    ['no_subject_mapping', 'no_object_mapping'].includes(reason)
  );
  const missingHeadword = row.needs_manual_review_reason.includes('no_headword_match');

  if (hasIdentityAmbiguity) {
    row.review_status = 'pending_exception';
  } else if (outsideOtCandidateMap) {
    row.review_status = 'reviewed_not_applicable';
  } else if (missingHeadword) {
    row.review_status = 'reviewed_inconclusive';
  } else if (row.derived_context_matches.length > 0) {
    row.review_status = 'context_match';
  } else {
    row.review_status = 'reviewed_no_evidence';
  }

  relationshipIndexByAssertion.set(assertion.assertion_id, row);
}

const rows = [...relationshipIndexByAssertion.values()].sort((a, b) => a.assertion_id.localeCompare(b.assertion_id));
const derivedRows = rows.flatMap((row) => row.derived_context_matches || []).sort(stableSortByLocator);

const fullSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const derivedSchema = JSON.parse(fs.readFileSync(DERIVED_SCHEMA_PATH, 'utf8'));
const fullValidate = ajv.compile(fullSchema);
const derivedValidate = ajv.compile(derivedSchema);

const persistedRows = fs.existsSync(OUTPUT_PATH) ? readJsonl(OUTPUT_PATH) : [];
const persistedDerivedRows = fs.existsSync(DERIVED_OUTPUT_PATH) ? readJsonl(DERIVED_OUTPUT_PATH) : [];

const errors = [];

for (const [index, row] of rows.entries()) {
  if (!fullValidate(row)) {
    for (const error of fullValidate.errors || []) {
      errors.push(`generated full row ${index + 1}${error.instancePath}: ${error.message}`);
    }
  }
}

for (const [index, row] of derivedRows.entries()) {
  if (!derivedValidate(row)) {
    for (const error of derivedValidate.errors || []) {
      errors.push(`generated derived row ${index + 1}${error.instancePath}: ${error.message}`);
    }
  }
}

if (rows.length !== assertions.length) {
  errors.push(`Assertion coverage mismatch: expected ${assertions.length}, got ${rows.length}`);
}
if (new Set(rows.map((row) => row.assertion_id)).size !== rows.length) {
  errors.push('Duplicate assertion_id in generated full audit');
}

if (!APPLY) {
  if (persistedRows.length !== rows.length) {
    errors.push(`Persisted full row count mismatch: expected ${rows.length}, got ${persistedRows.length}`);
  }

  const persistedById = new Map(persistedRows.map((row) => [row.assertion_id, row]));
  for (const row of rows) {
    const persisted = persistedById.get(row.assertion_id);
    if (!persisted) {
      errors.push(`Persisted full row missing assertion ${row.assertion_id}`);
      continue;
    }

    if (!fullValidate(persisted)) {
      for (const error of fullValidate.errors || []) {
        errors.push(`persisted full row ${row.assertion_id}${error.instancePath}: ${error.message}`);
      }
    }

    if (stableStringify(row) !== stableStringify(persisted)) {
      errors.push(`Persisted full row diff: ${row.assertion_id} field=${firstFieldDiff(row, persisted)}`);
    }
  }

  const persistedByAssertion = new Set(persistedRows.map((row) => row.assertion_id));
  for (const row of persistedRows) {
    if (!persistedByAssertion.has(row.assertion_id)) continue;
    if (!rows.some((generated) => generated.assertion_id === row.assertion_id)) {
      errors.push(`Persisted full row extra assertion ${row.assertion_id}`);
    }
  }

  if (persistedDerivedRows.length > 0) {
    const persistedDerivedSorted = persistedDerivedRows
      .map((row) => ({
        ...row,
        matched_counterpart_names: row.matched_counterpart_names || [],
        matched_relation_terms: row.matched_relation_terms || []
      }))
      .sort(stableSortByLocator);

    if (persistedDerivedSorted.length !== derivedRows.length) {
      errors.push(
        `Persisted derived row count mismatch: expected ${derivedRows.length}, got ${persistedDerivedSorted.length}`
      );
    }

    for (const [index, row] of persistedDerivedSorted.entries()) {
      if (!derivedValidate(row)) {
        for (const error of derivedValidate.errors || []) {
          errors.push(`persisted derived row ${index + 1}${error.instancePath}: ${error.message}`);
        }
      }
    }

    for (const [index, row] of persistedDerivedSorted.entries()) {
      if (stableStringify(row) !== stableStringify(derivedRows[index] || {})) {
        errors.push(`Persisted derived row diff at position ${index + 1}`);
      }
    }
  }

  if (persistedRows.length > 0 && fs.existsSync(REPORT_PATH)) {
    try {
      const persistedReport = readJson(REPORT_PATH);
      if (persistedReport.generated_at !== AUDIT_AT) {
        errors.push('Persisted full report generated_at mismatch');
      }
    } catch (error) {
      errors.push(`Persisted full report invalid: ${error.message}`);
    }
  }

  if (persistedDerivedRows.length > 0 && fs.existsSync(DERIVED_REPORT_PATH)) {
    try {
      const persistedDerivedReport = readJson(DERIVED_REPORT_PATH);
      if (persistedDerivedReport.generated_at !== AUDIT_AT) {
        errors.push('Persisted derived report generated_at mismatch');
      }
      if (persistedDerivedReport.source !== 'anchor-yale-relationship-review-audit') {
        errors.push('Persisted derived report source mismatch');
      }
    } catch (error) {
      errors.push(`Persisted derived report invalid: ${error.message}`);
    }
  }
}

const reviewReasons = Object.fromEntries(
  [
    'no_headword_match',
    'ambiguous_candidate',
    'no_subject_mapping',
    'no_object_mapping',
    'metadata_not_corroborated',
    'multi_match'
  ].map((reason) => [
    reason,
    rows.filter((row) => row.needs_manual_review_reason.includes(reason)).length
  ])
);

const reviewStatusSummary = {
  pending: rows.filter((row) => row.review_status === 'pending').length,
  reviewed_no_evidence: rows.filter((row) => row.review_status === 'reviewed_no_evidence').length,
  reviewed_inconclusive: rows.filter((row) => row.review_status === 'reviewed_inconclusive').length,
  reviewed_not_applicable: rows.filter((row) => row.review_status === 'reviewed_not_applicable').length,
  context_match: rows.filter((row) => row.review_status === 'context_match').length,
  pending_exception: rows.filter((row) => row.review_status === 'pending_exception').length
};

const report = {
  generated_at: AUDIT_AT,
  source_id: 'source:0009',
  mode: APPLY ? 'apply' : 'check-only',
  assertion_rows: rows.length,
  assertion_coverage: assertions.length,
  source_context_capture: {
    used: Boolean(HAS_CAPTURE),
    source: HAS_CAPTURE ? path.resolve(CAPTURE_PATH) : null,
    derived_row_count: derivedRows.length,
    derived_assertion_count: new Set(derivedRows.map((row) => row.assertion_id)).size
  },
  full_rows_written: rows.length,
  derived_rows_written: derivedRows.length,
  output_mode_with_capture: APPLY ? (HAS_CAPTURE ? 'full-plus-derived' : 'full-only') : 'check',
  headword_status_distribution: {
    mapped_direct: rows.filter(
      (row) => row.subject_headword_status === 'mapped_direct' || row.object_headword_status === 'mapped_direct'
    ).length,
    mapped_ambiguous: rows.filter(
      (row) => row.subject_headword_status === 'mapped_ambiguous' || row.object_headword_status === 'mapped_ambiguous'
    ).length,
    no_headword_match: rows.filter(
      (row) => row.subject_headword_status === 'no_headword_match' || row.object_headword_status === 'no_headword_match'
    ).length,
    unknown_person: rows.filter(
      (row) => row.subject_headword_status === 'unknown_person' || row.object_headword_status === 'unknown_person'
    ).length
  },
  relationship_review_reasons: reviewReasons,
  review_status_distribution: reviewStatusSummary,
  source_boundary: {
    source_text_stored: false,
    snippets_stored: false
  },
  limitation: HAS_CAPTURE
    ? 'Anchor Yale relationship review now includes derived-context matches per assertion and supports deterministic derived export.'
    : 'Anchor Yale relationship review uses captured context only when --capture is supplied.'
};

const derivedReport = {
  generated_at: AUDIT_AT,
  source: 'anchor-yale-relationship-review-audit',
  total_rows: derivedRows.length,
  total_assertions: new Set(derivedRows.map((row) => row.assertion_id)).size,
  source_text_stored: false,
  snippets_stored: false
};

if (errors.length) {
  throw new Error(`Anchor Yale relationship review audit failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);
}

if (APPLY) {
  fs.writeFileSync(OUTPUT_PATH, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (HAS_CAPTURE) {
    fs.writeFileSync(DERIVED_OUTPUT_PATH, `${derivedRows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    fs.writeFileSync(DERIVED_REPORT_PATH, `${JSON.stringify(derivedReport, null, 2)}\n`);
  }
}

console.log(JSON.stringify(report, null, 2));
