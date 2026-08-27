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
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

const PEOPLE_PATH = path.join(DATA_DIR, 'people.jsonl');
const ASSERTIONS_PATH = path.join(DATA_DIR, 'assertions.jsonl');
const NAMES_PATH = path.join(DATA_DIR, 'names.jsonl');
const MENTIONS_PATH = path.join(DATA_DIR, 'mentions.jsonl');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.jsonl');
const REVIEW_PATH = path.join(EDITORIAL_DIR, 'relationship-review.jsonl');
const SCHEMA_PATH = path.join(SCHEMAS_DIR, 'relationship-review.schema.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const NT_BOOKS = new Set([
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT',
  'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
  '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM',
  'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN',
  'JUD', 'REV'
]);

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force'),
    validateOnly: args.includes('--validate-only')
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at ${filePath}:${idx + 1}`);
    }
  });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseLocator(passage) {
  if (typeof passage !== 'string') return null;
  const clean = passage.trim();
  if (!clean) return null;
  const body = clean.replace(/^STEP:\s*/i, '');
  const match = body.match(/^([1-3]?[A-Z]{2,4})\s+(\d+:\d+(?:-\d+)?)$/);
  if (!match) return null;
  const book = match[1];
  if (!NT_BOOKS.has(book)) return null;
  return `${book} ${match[2]}`;
}

function validateNtLocatorExact(passage) {
  if (typeof passage !== 'string') return false;
  if (/^\s*STEP:/i.test(passage)) return false;
  const match = passage.trim().match(/^([1-3]?[A-Z]{2,4})\s+(\d+:\d+(?:-\d+)?)$/);
  if (!match) return false;
  if (!NT_BOOKS.has(match[1])) return false;
  return `${match[1]} ${match[2]}`;
}

function buildPersonNameMap(people) {
  const map = new Map();
  for (const person of people) {
    const preferred = person?.canonical_chinese ? person.canonical_chinese : person?.latinized;
    map.set(person.person_id, preferred || person.person_id);
  }
  return map;
}

function buildPassageMap(mentions) {
  const map = new Map();
  for (const mention of mentions) {
    const rows = map.get(mention.person_id) ?? new Set();
    if (mention.passage) rows.add(mention.passage);
    map.set(mention.person_id, rows);
  }
  return map;
}

function classifyAlignment(evidences, subjectPersonId, objectPersonId, mentionsByPerson) {
  let hasNt = false;
  let hasBoth = false;
  let hasOne = false;
  let hasNonNt = false;
  const subjPassages = mentionsByPerson.get(subjectPersonId) ?? new Set();
  const objPassages = mentionsByPerson.get(objectPersonId) ?? new Set();

  for (const ev of evidences) {
    const p = parseLocator(ev?.passage);
    if (!p) {
      hasNonNt = true;
      continue;
    }
    hasNt = true;
    const s = subjPassages.has(p);
    const o = objPassages.has(p);
    if (s && o) hasBoth = true;
    else if (s || o) hasOne = true;
  }

  if (!hasNt) return 'non_nt_locator';
  if (hasBoth) return 'both_endpoints_mentioned';
  if (hasOne) return 'one_endpoint_mentioned';
  return 'neither_endpoint_mentioned';
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function validateDate(value, message) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(message);
  }
}

function evidenceMatches(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function buildAssertionsMap(assertions) {
  const map = new Map();
  for (const assertion of assertions) {
    map.set(assertion.assertion_id, assertion);
  }
  return map;
}

function cleanEvidenceRefs(rawRefs, sourceSet) {
  const refs = Array.isArray(rawRefs) ? rawRefs : [];
  return refs.map((r, idx) => {
    if (!r || typeof r !== 'object') throw new Error(`Evidence ref #${idx + 1} must be object`);
    const ref = {
      source_id: r.source_id,
      passage: String(r.passage ?? ''),
      evidence_level: r.evidence_level,
      note: String(r.note ?? ''),
      certainty: Number(r.certainty)
    };
    if (!sourceSet.has(ref.source_id)) {
      throw new Error(`Evidence ref source_id invalid: ${ref.source_id}`);
    }
    if (!ref.passage) throw new Error(`Evidence ref missing passage`);
    if (!['nt_text', 'ancient_text', 'reference', 'modern_reference', 'editorial'].includes(ref.evidence_level)) {
      throw new Error(`Invalid evidence level ${ref.evidence_level}`);
    }
    if (Number.isNaN(ref.certainty) || ref.certainty < 0 || ref.certainty > 1) {
      throw new Error(`Invalid evidence certainty: ${ref.certainty}`);
    }
    return ref;
  });
}

function makeDecisionObject() {
  return {
    status: 'pending',
    decision_relation_type: null,
    decision_relation_subtype: null,
    decision_direction: null,
    decision_evidence_refs: [],
    reviewer: null,
    decision_note: '',
    reviewed_at: null
  };
}

function normalizeDecision(decision) {
  return {
    status: decision?.status ?? 'pending',
    decision_relation_type: decision?.decision_relation_type ?? null,
    decision_relation_subtype: decision?.decision_relation_subtype ?? null,
    decision_direction: decision?.decision_direction ?? null,
    decision_evidence_refs: decision?.decision_evidence_refs ?? [],
    reviewer: decision?.reviewer ?? null,
    decision_note: decision?.decision_note ?? '',
    reviewed_at: decision?.reviewed_at ?? null
  };
}

function buildReviewRows(assertions, peopleById, namesByPerson, mentionsByPerson, timestamp, sources) {
  const sourceSet = new Set(sources.map((s) => s.source_id));
  const rows = [];
  const assertionsSorted = assertions.slice().sort((a, b) => a.assertion_id.localeCompare(b.assertion_id));
  for (const assertion of assertionsSorted) {
    const evidenceSnapshot = (assertion.evidence || []).map((ev) => ({
      source_id: ev.source_id,
      passage: ev.passage,
      evidence_level: ev.evidence_level,
      note: ev.note || '',
      certainty: ev.certainty ?? 0
    }));
    const row = {
      review_id: '',
      assertion_id: assertion.assertion_id,
      subject_person_id: assertion.subject_person_id,
      object_person_id: assertion.object_person_id,
      relation_type: assertion.relation_type,
      relation_subtype: assertion.relation_subtype,
      direction: assertion.direction,
      nt_passage_alignment: classifyAlignment(assertion.evidence || [], assertion.subject_person_id, assertion.object_person_id, mentionsByPerson),
      evidence_snapshot: evidenceSnapshot,
      assertion_snapshot: {
        subject_person_id: assertion.subject_person_id,
        object_person_id: assertion.object_person_id,
        relation_type: assertion.relation_type,
        relation_subtype: assertion.relation_subtype ?? null,
        direction: assertion.direction,
        evidence: evidenceSnapshot,
        status: assertion.status,
        editorial_status: assertion.editorial_status,
        confidence: assertion.confidence,
        created_at: assertion.created_at,
        updated_at: assertion.updated_at
      },
      assertion_signature: hashSha256(stableStringify({
        assertion_id: assertion.assertion_id,
        subject_person_id: assertion.subject_person_id,
        object_person_id: assertion.object_person_id,
        relation_type: assertion.relation_type,
        relation_subtype: assertion.relation_subtype ?? null,
        direction: assertion.direction,
        evidence: evidenceSnapshot,
        editorial_status: assertion.editorial_status,
        status: assertion.status,
        confidence: assertion.confidence
      })),
      round1: makeDecisionObject(),
      round2: makeDecisionObject(),
      final_decision: makeDecisionObject(),
      source_id: assertion.evidence?.[0]?.source_id ?? 'source:0002',
      created_at: timestamp,
      updated_at: timestamp,
      subject_person_name: peopleById.get(assertion.subject_person_id) || assertion.subject_person_id,
      object_person_name: peopleById.get(assertion.object_person_id) || assertion.object_person_id,
      editorial_notes: namesByPerson.get(assertion.subject_person_id)?.top_count
        ? `top names: ${namesByPerson.get(assertion.subject_person_id).top_count}`
        : ''
    };

    assert(sourceSet.has(row.source_id), `Source id missing in data file: ${row.source_id}`);
    for (const [index, r] of evidenceSnapshot.entries()) {
      if (!row.assertion_signature) {
        throw new Error(`Missing signature for ${row.assertion_id}`);
      }
      if (index + 1 > 9999) break;
      assert(typeof r.passage === 'string' && r.passage.length > 0, `Invalid passage in ${row.assertion_id}`);
      assert(typeof r.note === 'string', `Invalid note in ${row.assertion_id}`);
      if (!sourceSet.has(r.source_id)) {
        throw new Error(`Evidence source_id not found in ${row.assertion_id}: ${r.source_id}`);
      }
    }
    rows.push(row);
  }
  return rows;
}

function validateDecision(name, decision, sourceSet) {
  const d = normalizeDecision(decision);
  if (!['pending', 'accepted', 'rejected'].includes(d.status)) {
    throw new Error(`${name}: invalid status ${d.status}`);
  }
  const { decision_relation_type, decision_relation_subtype, decision_direction } = d;
  const accepted = d.status === 'accepted';
  const refs = cleanEvidenceRefs(d.decision_evidence_refs, sourceSet);
  if (!accepted && d.status === 'rejected') {
    if (!d.reviewer?.trim()) {
      throw new Error(`${name}: rejected decision requires reviewer`);
    }
    if (!d.reviewed_at || Number.isNaN(Date.parse(d.reviewed_at))) {
      throw new Error(`${name}: rejected decision requires reviewed_at`);
    }
    if (typeof d.decision_note !== 'string' || !d.decision_note.trim()) {
      throw new Error(`${name}: rejected decision requires decision_note`);
    }
    if (refs.length !== 0) {
      throw new Error(`${name}: rejected decision must not include decision_evidence_refs`);
    }
    assert(decision_relation_type === null, `${name}: rejected decision_relation_type must be null`);
    assert(decision_relation_subtype === null, `${name}: rejected decision_relation_subtype must be null`);
    assert(decision_direction === null, `${name}: rejected decision_direction must be null`);
    return { ...d, decision_evidence_refs: refs };
  }
  if (!accepted) {
    if (d.reviewed_at !== null) throw new Error(`${name}: pending decision must have reviewed_at null`);
    if (d.reviewer !== null) throw new Error(`${name}: pending decision must have reviewer null`);
    assert(d.decision_note === '', `${name}: pending decision_note must be empty`);
    assert(decision_relation_type === null, `${name}: pending decision_relation_type must be null`);
    assert(decision_relation_subtype === null, `${name}: pending decision_relation_subtype must be null`);
    assert(decision_direction === null, `${name}: pending decision_direction must be null`);
    assert(refs.length === 0, `${name}: pending decision_evidence_refs must be empty`);
    return d;
  }

  if (!decision_relation_type || !['kinship', 'teacher_student', 'collegial', 'commission', 'host', 'political', 'legal', 'hostile'].includes(decision_relation_type)) {
    throw new Error(`${name}: accepted decision_relation_type invalid`);
  }
  if (!decision_direction || !['directed', 'undirected'].includes(decision_direction)) {
    throw new Error(`${name}: accepted decision_direction invalid`);
  }
  if (!d.reviewer?.trim()) {
    throw new Error(`${name}: accepted decision requires reviewer`);
  }
  if (!d.reviewed_at || Number.isNaN(Date.parse(d.reviewed_at))) {
    throw new Error(`${name}: accepted decision requires reviewed_at`);
  }
  if (typeof d.decision_note !== 'string' || !d.decision_note.trim()) {
    throw new Error(`${name}: accepted decision requires decision_note`);
  }
  if (refs.length < 1) {
    throw new Error(`${name}: accepted decision requires at least one evidence ref`);
  }
  for (const ref of refs) {
    if (ref.evidence_level === 'nt_text') {
      if (ref.source_id !== 'source:0001') {
        throw new Error(`${name}: nt_text evidence must use source:0001`);
      }
      const normalizedNtPassage = validateNtLocatorExact(ref.passage);
      if (!normalizedNtPassage) {
        throw new Error(`${name}: invalid nt_text passage locator (${ref.passage})`);
      }
      ref.passage = normalizedNtPassage;
    }
    if (ref.evidence_level === 'nt_text' && (typeof ref.certainty !== 'number' || Number.isNaN(ref.certainty))) {
      throw new Error(`${name}: nt_text evidence requires certainty`);
    }
  }
  return { ...d, decision_evidence_refs: refs };
}

function validateOnly() {
  if (!fs.existsSync(REVIEW_PATH)) throw new Error(`Missing review file: ${REVIEW_PATH}`);

  const people = readJsonl(PEOPLE_PATH);
  const names = readJsonl(NAMES_PATH);
  const assertions = readJsonl(ASSERTIONS_PATH);
  const mentions = readJsonl(MENTIONS_PATH);
  const sources = readJsonl(SOURCES_PATH);
  const reviews = readJsonl(REVIEW_PATH);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const sourceSet = new Set(sources.map((s) => s.source_id));
  const peopleMap = new Map(people.map((p) => [p.person_id, p]));
  const mentionsByPerson = buildPassageMap(mentions);
  const namesByPerson = new Map(names.map((n) => [n.person_id, n]));
  const byAssertion = buildAssertionsMap(assertions);

  if (reviews.length !== assertions.length) {
    throw new Error(`Review row count ${reviews.length} does not match assertions count ${assertions.length}`);
  }

  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const reviewIds = new Set();
  const assertIds = new Set();
  const alignmentCounts = {
    both_endpoints_mentioned: 0,
    one_endpoint_mentioned: 0,
    neither_endpoint_mentioned: 0,
    non_nt_locator: 0
  };

  for (const [idx, row] of reviews.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at relationship-review:${idx + 1}: ${details}`);
    }

    if (reviewIds.has(row.review_id)) {
      throw new Error(`Duplicate review_id ${row.review_id}`);
    }
    reviewIds.add(row.review_id);

    if (assertIds.has(row.assertion_id)) {
      throw new Error(`Duplicate assertion_id in review file: ${row.assertion_id}`);
    }
    assertIds.add(row.assertion_id);

    const assertion = byAssertion.get(row.assertion_id);
    if (!assertion) {
      throw new Error(`Unknown assertion_id ${row.assertion_id} in relationship-review`);
    }
    if (row.subject_person_id !== assertion.subject_person_id || row.object_person_id !== assertion.object_person_id) {
      throw new Error(`Subject/object mismatch for ${row.assertion_id}`);
    }
    if (!peopleMap.has(row.subject_person_id) || !peopleMap.has(row.object_person_id)) {
      throw new Error(`Unknown person reference in ${row.assertion_id}`);
    }

    const expectedAlignment = classifyAlignment(assertion.evidence || [], row.subject_person_id, row.object_person_id, mentionsByPerson);
    if (expectedAlignment !== row.nt_passage_alignment) {
      throw new Error(`nt_passage_alignment drift for ${row.assertion_id}: ${row.nt_passage_alignment} != ${expectedAlignment}`);
    }
    alignmentCounts[row.nt_passage_alignment] += 1;

    for (const evidence of row.evidence_snapshot) {
      if (!sourceSet.has(evidence.source_id)) {
        throw new Error(`Unknown source_id ${evidence.source_id} in evidence_snapshot ${row.assertion_id}`);
      }
    }
    const expectedEvidence = (assertion.evidence || []).map((ev) => ({
      source_id: ev.source_id,
      passage: ev.passage,
      evidence_level: ev.evidence_level,
      note: ev.note || '',
      certainty: ev.certainty ?? 0
    }));
    if (!evidenceMatches(expectedEvidence, row.evidence_snapshot)) {
      throw new Error(`evidence_snapshot drift for ${row.assertion_id}`);
    }

    const expectedSnapshot = {
      subject_person_id: assertion.subject_person_id,
      object_person_id: assertion.object_person_id,
      relation_type: assertion.relation_type,
      relation_subtype: assertion.relation_subtype ?? null,
      direction: assertion.direction,
      evidence: expectedEvidence,
      status: assertion.status,
      editorial_status: assertion.editorial_status,
      confidence: assertion.confidence,
      created_at: assertion.created_at,
      updated_at: assertion.updated_at
    };
    if (!evidenceMatches(expectedSnapshot, row.assertion_snapshot)) {
      throw new Error(`assertion_snapshot drift for ${row.assertion_id}`);
    }
    const expectedSig = hashSha256(stableStringify({
      assertion_id: assertion.assertion_id,
      subject_person_id: assertion.subject_person_id,
      object_person_id: assertion.object_person_id,
      relation_type: assertion.relation_type,
      relation_subtype: assertion.relation_subtype ?? null,
      direction: assertion.direction,
      evidence: expectedEvidence,
      editorial_status: assertion.editorial_status,
      status: assertion.status,
      confidence: assertion.confidence
    }));
    if (row.assertion_signature !== expectedSig) {
      throw new Error(`assertion_signature drift for ${row.assertion_id}`);
    }

    validateDate(row.created_at, `Invalid created_at in ${row.assertion_id}`);
    validateDate(row.updated_at, `Invalid updated_at in ${row.assertion_id}`);
    const round1 = validateDecision(`round1 (${row.assertion_id})`, row.round1, sourceSet);
    const round2 = validateDecision(`round2 (${row.assertion_id})`, row.round2, sourceSet);
    const finalDecision = validateDecision(`final (${row.assertion_id})`, row.final_decision, sourceSet);

    if (finalDecision.status === 'accepted') {
      if (row.round1.status !== 'accepted') {
        throw new Error(`final accepted requires round1 accepted: ${row.assertion_id}`);
      }
      if (row.round2.status !== 'accepted') {
        throw new Error(`final accepted requires round2 accepted: ${row.assertion_id}`);
      }
      if (
        round2.decision_relation_type !== finalDecision.decision_relation_type
        || round2.decision_relation_subtype !== finalDecision.decision_relation_subtype
        || round2.decision_direction !== finalDecision.decision_direction
        || !evidenceMatches(round2.decision_evidence_refs, finalDecision.decision_evidence_refs)
      ) {
        throw new Error(`final accepted must match round2 exactly: ${row.assertion_id}`);
      }
    }
    row.final_decision = finalDecision;

    const expectedName = peopleMap.get(row.subject_person_id);
    const expectedObj = peopleMap.get(row.object_person_id);
    const expectedSubjectName = expectedName?.canonical_chinese || expectedName?.latinized || row.subject_person_id;
    const expectedObjectName = expectedObj?.canonical_chinese || expectedObj?.latinized || row.object_person_id;
    if (!row.subject_person_name || !row.object_person_name) {
      throw new Error(`Missing person names for ${row.assertion_id}`);
    }
    if (row.subject_person_name !== expectedSubjectName || row.object_person_name !== expectedObjectName) {
      throw new Error(`Person name drift for ${row.assertion_id}`);
    }

    if (!namesByPerson.has(row.subject_person_id) && row.subject_person_id) {
      throw new Error(`Missing names for person ${row.subject_person_id}`);
    }
  }

  console.log('OK validate:relationship-review');
  console.log(`alignment counts: ${JSON.stringify(alignmentCounts)}`);
}

function main() {
  const { force, validateOnly: validateOnlyMode } = parseArgs();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const timestamp = manifest.created_at;
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error('data/manifest.json must provide a valid created_at timestamp');
  }

  const people = readJsonl(PEOPLE_PATH);
  const peopleById = buildPersonNameMap(people);
  const names = readJsonl(NAMES_PATH);
  const assertions = readJsonl(ASSERTIONS_PATH);
  const mentions = readJsonl(MENTIONS_PATH);
  const sources = readJsonl(SOURCES_PATH);
  const mentionsByPerson = buildPassageMap(mentions);
  const namesByPerson = new Map();
  for (const name of names) {
    const existing = namesByPerson.get(name.person_id);
    if (!existing) {
      namesByPerson.set(name.person_id, {
        top_count: 0,
        top: [name]
      });
    }
  }

  if (validateOnlyMode) {
    validateOnly();
    return;
  }

  if (fs.existsSync(REVIEW_PATH) && !force) {
    throw new Error(
      `Review file already exists: ${REVIEW_PATH}. Use --force to overwrite a manual file intentionally.`
    );
  }

  const rows = buildReviewRows(assertions, peopleById, namesByPerson, mentionsByPerson, timestamp, sources);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [index, row] of rows.entries()) {
    row.review_id = `rrr-${String(index + 1).padStart(4, '0')}`;
    const errors = validate(row) ? [] : (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`);
    if (errors.length) {
      throw new Error(`Schema validation failed in generated row ${row.review_id}: ${errors.join('; ')}`);
    }
  }

  fs.mkdirSync(EDITORIAL_DIR, { recursive: true });
  fs.writeFileSync(REVIEW_PATH, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  const alignment = rows.reduce(
    (acc, row) => {
      acc[row.nt_passage_alignment] += 1;
      return acc;
    },
    { both_endpoints_mentioned: 0, one_endpoint_mentioned: 0, neither_endpoint_mentioned: 0, non_nt_locator: 0 }
  );
  console.log(`generated ${rows.length} rows in ${REVIEW_PATH}`);
  console.log(`alignment counts: ${JSON.stringify(alignment)}`);
}

main();
