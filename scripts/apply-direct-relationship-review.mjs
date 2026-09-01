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

const ASSERTIONS_PATH = path.join(DATA_DIR, 'assertions.jsonl');
const REVIEW_PATH = path.join(EDITORIAL_DIR, 'direct-relationship-review.jsonl');
const DISCOVERY_PATH = path.join(EDITORIAL_DIR, 'direct-relationship-discovery.jsonl');
const PEOPLE_PATH = path.join(DATA_DIR, 'people.jsonl');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.jsonl');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'direct-relationship-review.schema.json');
const ASSERTION_SCHEMA_PATH = path.join(ROOT, 'schemas', 'assertions.schema.json');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'direct-relationship-application-report.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');

const BIBLE_BOOKS = new Set([
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT',
  'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
  '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM',
  'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN',
  'JUD', 'REV',
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
  '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG',
  'ISA', 'JER', 'LAM', 'EZK',
  'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM',
  'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'
]);

const ACCEPTED_STATUSES_PREFIX = 'textually_explicit_';
const UNCERTAIN_HOSTILE_STATUS = 'reviewed_uncertain_hostile';
const DEFAULT_CERTAINTY = 0.78;
const CONSERVATIVE_LIMIT = 0.9;

function parseBooleanArg(flag) {
  return process.argv.includes(flag);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line, index) => {
    if (!line.trim()) return null;
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at ${filePath}:${index + 1}`);
    }
  }).filter(Boolean);
}

function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const temp = path.join(dir, `.tmp-${path.basename(filePath)}.${process.pid}`);
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, filePath);
}

function normalizeRow(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => normalizeRow(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${normalizeRow(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function idToNumber(assertionId) {
  const m = /^(?:asrt|nt-people-asrt|drt)-?(\d+)$/i.exec(String(assertionId || ''));
  return m ? Number(m[1]) : 0;
}

function makeSignature(row) {
  return `${row.subject_person_id}|${row.object_person_id}|${row.relation_type}|${row.relation_subtype || ''}|${row.direction}`;
}

function validLocator(passage) {
  const match = String(passage || '').trim().match(/^([1-3]?[A-Z]{2,4})\s+(\d{1,3}:\d{1,3}(?:-\d{1,3})?)$/);
  if (!match) return false;
  return BIBLE_BOOKS.has(match[1]);
}

function normalizeEvidence(rawEvidence, fallbackNote, context) {
  const rowId = context?.candidate_relation_id ? ` ${context.candidate_relation_id}` : '';
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    throw new Error(`no evidence refs for review row${rowId}`);
  }

  const out = [];
  for (const ref of rawEvidence) {
    if (!ref || typeof ref !== 'object') {
      throw new Error(`invalid evidence item for review row${rowId}`);
    }

    const source_id = String(ref.source_id || '').trim();
    const passage = String(ref.passage || '').trim();
    const evidence_level = String(ref.evidence_level || '').trim();
    const note = String((ref.note ?? '').trim() || fallbackNote).trim();
    const certaintyRaw = Number(ref.certainty);
    const certainty = Number.isFinite(certaintyRaw) ? certaintyRaw : DEFAULT_CERTAINTY;

    if (!source_id || !passage) {
      throw new Error(`missing source_id or passage for review row${rowId}`);
    }
    if (!['nt_text', 'ot_text', 'ancient_text', 'reference', 'modern_reference', 'editorial', 'inference'].includes(evidence_level)) {
      throw new Error(`invalid evidence_level ${evidence_level} for review row${rowId}`);
    }
    if (!validLocator(passage)) {
      throw new Error(`invalid passage locator ${passage} for review row${rowId}`);
    }
    if (!(certainty >= 0 && certainty <= 1)) {
      throw new Error(`invalid certainty ${ref.certainty} for review row${rowId}`);
    }

    out.push({
      source_id,
      passage,
      evidence_level,
      note,
      certainty
    });
  }

  const dedup = [];
  const seen = new Set();
  for (const item of out) {
    const key = `${item.source_id}|${item.passage}|${item.evidence_level}|${item.note}|${item.certainty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
  }

  return dedup;
}

function evidenceSetKey(item) {
  return `${item.source_id}|${item.passage}|${item.evidence_level}|${String(item.note || '').trim()}|${Number(item.certainty) || 0}`;
}

function evidenceSetEquals(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map(evidenceSetKey));
  for (const item of a) {
    if (!setB.has(evidenceSetKey(item))) return false;
  }
  return true;
}

function mergeEvidence(existing, incoming) {
  const seen = new Set(existing.map(evidenceSetKey));
  let added = 0;
  for (const item of incoming) {
    const key = evidenceSetKey(item);
    if (seen.has(key)) continue;
    existing.push(item);
    seen.add(key);
    added += 1;
  }
  return added > 0;
}

function isAcceptedStatus(status) {
  return (typeof status === 'string')
    && (status.startsWith(ACCEPTED_STATUSES_PREFIX) || status === UNCERTAIN_HOSTILE_STATUS);
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { created_at: new Date(0).toISOString() };
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return manifest;
}

function buildAcceptedCount(rows) {
  return rows.filter((row) => isAcceptedStatus(row.final_decision?.status)).length;
}

function validateSnapshotIntegrity(rows, discoveries) {
  const errors = [];
  for (const row of rows) {
    const candidate = discoveries.get(row.candidate_relation_id);
    if (!candidate) {
      errors.push(`missing candidate for review ${row.review_id}`);
      continue;
    }
    const actual = sha256(normalizeRow(candidate));
    if (row.candidate_snapshot_sha256 !== actual) {
      errors.push(`snapshot hash mismatch ${row.review_id}(${row.candidate_relation_id})`);
    }
  }
  return errors;
}

function main() {
  const argsMode = parseBooleanArg('--apply') ? 'apply' : CHECK ? 'check' : 'preview';

  if (APPLY && CHECK) {
    throw new Error('do not pass both --apply and --check');
  }

  if (!fs.existsSync(SCHEMA_PATH)) throw new Error(`Missing schema: ${SCHEMA_PATH}`);
  if (!fs.existsSync(ASSERTION_SCHEMA_PATH)) throw new Error(`Missing schema: ${ASSERTION_SCHEMA_PATH}`);

  const assertions = readJsonl(ASSERTIONS_PATH);
  const reviewRows = readJsonl(REVIEW_PATH);
  const candidates = readJsonl(DISCOVERY_PATH);
  const people = readJsonl(PEOPLE_PATH);
  const sources = readJsonl(SOURCES_PATH);
  const manifest = loadManifest();

  const sourceIds = new Set(sources.map((row) => row.source_id));

  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const assertionSchema = JSON.parse(fs.readFileSync(ASSERTION_SCHEMA_PATH, 'utf8'));
  const validateReviewRow = ajv.compile(schema);
  const validateAssertion = ajv.compile(assertionSchema);

  const peopleById = new Map(people.map((person) => [person.person_id, person]));
  const acceptedPeople = new Set(
    people.filter((person) => person.status === 'accepted').map((person) => person.person_id)
  );
  const discoveryById = new Map(candidates.map((row) => [row.candidate_relation_id, row]));

  const validationErrors = [];
  const seenReviewIds = new Set();
  const seenCandidateIds = new Set();

  const acceptedRows = [];

  if (!Array.isArray(assertions)) {
    validationErrors.push('assertions.jsonl must be array-like JSONL');
  } else {
    for (let i = 0; i < assertions.length; i += 1) {
      if (!validateAssertion(assertions[i])) {
        validationErrors.push(
          ...((validateAssertion.errors || []).map((error) => `assertions.jsonl row ${i + 1}: ${error.instancePath || ''} ${error.message}`))
        );
      }
    }
  }

  for (const [index, row] of reviewRows.entries()) {
    if (!validateReviewRow(row)) {
      validationErrors.push(
        ...((validateReviewRow.errors || []).map((error) => `row ${index + 1}: ${error.instancePath || ''} ${error.message}`))
      );
    }

    if (seenReviewIds.has(row.review_id)) {
      validationErrors.push(`duplicate review_id ${row.review_id}`);
    }
    seenReviewIds.add(row.review_id);

    if (seenCandidateIds.has(row.candidate_relation_id)) {
      validationErrors.push(`duplicate candidate_relation_id ${row.candidate_relation_id} in review ledger`);
    }
    seenCandidateIds.add(row.candidate_relation_id);

    const candidate = discoveryById.get(row.candidate_relation_id);
    if (!candidate) {
      validationErrors.push(`candidate not found for review row ${row.review_id}`);
    }

    const rejectedEndpointCorrection = row.final_decision?.reason_code === 'endpoint_not_named_person'
      && row.final_decision?.status === 'rejected_ambiguous_identity';
    if (!acceptedPeople.has(row.subject_person_id) && !rejectedEndpointCorrection) {
      validationErrors.push(`subject person not accepted/unknown: ${row.subject_person_id}`);
    }
    if (!acceptedPeople.has(row.object_person_id) && !rejectedEndpointCorrection) {
      validationErrors.push(`object person not accepted/unknown: ${row.object_person_id}`);
    }

    if (row.subject_person_id === row.object_person_id) {
      validationErrors.push(`self-loop detected: ${row.subject_person_id} in ${row.review_id}`);
    }

    if (!peopleById.has(row.subject_person_id)) {
      validationErrors.push(`subject person does not exist in people.jsonl: ${row.subject_person_id}`);
    }
    if (!peopleById.has(row.object_person_id)) {
      validationErrors.push(`object person does not exist in people.jsonl: ${row.object_person_id}`);
    }

    if (isAcceptedStatus(row.final_decision?.status)) {
      if (!row.proposed_assertion || typeof row.proposed_assertion !== 'object') {
        validationErrors.push(`accepted final decision but no proposed_assertion: ${row.review_id}`);
      } else {
        const proposal = row.proposed_assertion;
        const validPersonPattern = /^(?:person-\d{6}|nt-people-\d{4})$/;
        if (!validPersonPattern.test(String(proposal.subject_person_id || '')))
          validationErrors.push(`invalid proposed subject_person_id in ${row.review_id}`);
        if (!validPersonPattern.test(String(proposal.object_person_id || '')))
          validationErrors.push(`invalid proposed object_person_id in ${row.review_id}`);

        if (proposal.relation_subtype) {
          const allowedSubtypes = new Set([
            'parent', 'child', 'sibling', 'spouse', 'partner', 'concubine_partner',
            'grandparent', 'grandchild', 'uncle_aunt', 'nephew_niece',
            'cousin', 'parent_in_law', 'child_in_law', 'sibling_in_law',
            'step_parent', 'step_child', 'other_specified'
          ]);
          if (!allowedSubtypes.has(proposal.relation_subtype)) {
            validationErrors.push(`invalid relation_subtype in ${row.review_id}: ${proposal.relation_subtype}`);
          }
        }

        if (!proposal.relation_type || !['kinship', 'teacher_student', 'collegial', 'commission', 'host', 'political', 'legal', 'hostile', 'succession', 'alliance', 'military', 'prophetic_confrontation', 'covenant', 'friendship'].includes(proposal.relation_type)) {
          validationErrors.push(`invalid relation_type in ${row.review_id}: ${proposal.relation_type}`);
        }
        if (!proposal.direction || !['directed', 'undirected'].includes(proposal.direction)) {
          validationErrors.push(`invalid direction in ${row.review_id}: ${proposal.direction}`);
        }
        if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) {
          validationErrors.push(`missing evidence in proposed_assertion for ${row.review_id}`);
        }
      }
      acceptedRows.push(row);
    }
  }

  validationErrors.push(...validateSnapshotIntegrity(reviewRows, discoveryById));

  if (validationErrors.length) {
    throw new Error(`apply direct relationship review failed: ${validationErrors.slice(0, 120).join('; ')}`);
  }

  const existingActiveBySignature = new Map();
  const activeById = new Map();
  for (const assertion of assertions) {
    if (assertion.status !== 'active') continue;
    if (!assertion.assertion_id || typeof assertion.assertion_id !== 'string') {
      throw new Error('active assertion missing assertion_id');
    }
    if (activeById.has(assertion.assertion_id)) {
      throw new Error(`duplicate active assertion_id ${assertion.assertion_id}`);
    }
    activeById.set(assertion.assertion_id, assertion);
    const sig = `${assertion.subject_person_id}|${assertion.object_person_id}|${assertion.relation_type}|${assertion.relation_subtype || ''}|${assertion.direction}`;
    const list = existingActiveBySignature.get(sig);
    if (list) list.push(assertion);
    else existingActiveBySignature.set(sig, [assertion]);
  }

  const planned = [];
  const warnings = [];
  const pending = [];
  const exactHits = [];
  const modifiedAssertions = [];

  for (const row of acceptedRows) {
    const proposal = row.proposed_assertion;
    const evidenceFromProposal = normalizeEvidence(
      proposal.evidence,
      `Direct relationship review ${row.review_id}`,
      { candidate_relation_id: row.candidate_relation_id }
    );

    const evidenceFromDiscoveryFallback = Array.isArray(discoveryById.get(row.candidate_relation_id)?.passages)
      ? discoveryById.get(row.candidate_relation_id).passages.map((rowPassage) => {
          if (!validLocator(rowPassage.passage)) {
            throw new Error(`invalid candidate passage locator in ${row.candidate_relation_id}: ${rowPassage.passage}`);
          }
          if (!sourceIds.has(rowPassage.source_id)) {
            throw new Error(`unknown source_id ${rowPassage.source_id} in ${row.candidate_relation_id}`);
          }
          return {
            source_id: rowPassage.source_id,
            passage: rowPassage.passage,
            evidence_level: rowPassage.evidence_level,
            note: `Fallback evidence from direct relationship candidate ${row.candidate_relation_id}`,
            certainty: DEFAULT_CERTAINTY
          };
        })
      : [];

    const evidence = evidenceFromProposal.length > 0 ? evidenceFromProposal : evidenceFromDiscoveryFallback;

    const sourceMissing = evidence.filter((item) => !sourceIds.has(item.source_id));
    if (sourceMissing.length) {
      const missing = [...new Set(sourceMissing.map((item) => item.source_id))].join(',');
      throw new Error(`unknown source_id(s) for ${row.review_id}: ${missing}`);
    }

    const assertTemplate = {
      subject_person_id: proposal.subject_person_id,
      object_person_id: proposal.object_person_id,
      relation_type: proposal.relation_type,
      relation_subtype: proposal.relation_subtype || null,
      direction: proposal.direction,
      evidence
    };

    const signature = makeSignature(assertTemplate);
    const maxCertainty = evidence.reduce((max, item) => Math.max(max, Number(item.certainty || 0)), 0);
    const confidence = maxCertainty > 0 ? maxCertainty : DEFAULT_CERTAINTY;
    const editorialStatus = confidence >= CONSERVATIVE_LIMIT ? 'common_tradition' : 'conservative';

    const matches = existingActiveBySignature.get(signature) || [];
    const exactMatch = matches.find((assertion) => {
      const existingEvidence = Array.isArray(assertion.evidence) ? assertion.evidence : [];
      return evidenceSetEquals(existingEvidence, evidence);
    });

    if (matches.length > 1 && !exactMatch) {
      throw new Error(`ambiguous existing active assertions for ${row.review_id}; please resolve duplicates`);
    }

    if (matches.length > 1 && exactMatch && matches.filter((a) => {
      return evidenceSetEquals(a.evidence || [], evidence);
    }).length > 1) {
      throw new Error(`duplicate active equivalent relation already exists for ${row.review_id}`);
    }

    if (exactMatch) {
      exactHits.push(row);
      continue;
    }

    const targetForMerge = matches.find((assertion) => Array.isArray(assertion.evidence) && assertion.evidence.length > 0);
    if (targetForMerge) {
      const before = targetForMerge.evidence.length;
      const added = mergeEvidence(targetForMerge.evidence, evidence);
      if (added) {
        targetForMerge.editor_note = `${(targetForMerge.editor_note || '').replace(/\s*;\s*$/, '')}; direct relationship review ${row.review_id} pending merge`;
        targetForMerge.updated_at = manifest.created_at;
      }
      const merged = targetForMerge.evidence.length > before;
      if (merged) {
        warnings.push({ candidate_relation_id: row.candidate_relation_id, action: 'merged-evidence' });
        modifiedAssertions.push(targetForMerge);
      }
      continue;
    }

    const assertion = {
      assertion_id: null,
      subject_person_id: proposal.subject_person_id,
      object_person_id: proposal.object_person_id,
      relation_type: proposal.relation_type,
      direction: proposal.direction,
      evidence,
      status: 'active',
      confidence,
      editorial_status: editorialStatus,
      created_at: manifest.created_at,
      updated_at: manifest.created_at
    };
    if (proposal.relation_subtype) {
      assertion.relation_subtype = proposal.relation_subtype;
    }
    assertion.editor_note = `Direct relationship review ${row.review_id}.`;
    planned.push({ assertion, row, signature });
    pending.push(row);
  }

  const nextId = assertions.reduce((max, assertion) => Math.max(max, idToNumber(assertion.assertion_id)), 0) + 1;
  let next = nextId;
  const created = [];

  for (const item of planned) {
    item.assertion.assertion_id = `asrt-${String(next++).padStart(4, '0')}`;
    assertions.push(item.assertion);
    created.push(item.assertion);

    const list = existingActiveBySignature.get(item.signature) || [];
    list.push(item.assertion);
    existingActiveBySignature.set(item.signature, list);
  }

  assertions.sort((a, b) => idToNumber(a.assertion_id) - idToNumber(b.assertion_id));

  const report = {
    mode: argsMode,
    total_review_rows: reviewRows.length,
    accepted_review_rows: acceptedRows.length,
    skipped_due_to_exact_match: exactHits.length,
    would_merge_existing: warnings.length,
    would_create: created.length,
    pending_count: pending.length,
    final_active_assertions: assertions.filter((row) => row.status === 'active').length,
    total_assertions: assertions.length,
    accepted_statuses: {
      textually_explicit: acceptedRows.filter((row) => row.final_decision.status.startsWith('textually_explicit_')).length,
      reviewed_uncertain_hostile: acceptedRows.filter((row) => row.final_decision.status === UNCERTAIN_HOSTILE_STATUS).length
    }
  };

  if (APPLY || CHECK) {
    const changedRows = [...modifiedAssertions, ...created];
    const finalValidation = changedRows.every((assertion, index) => {
      if (!validateAssertion(assertion)) {
        validationErrors.push(...((validateAssertion.errors || []).map((error) => `changed final assertion #${index + 1}: ${error.instancePath || ''} ${error.message}`)));
        return false;
      }
      return true;
    });
    if (!finalValidation) {
      validationErrors.push('Changed final assertions failed assertion schema validation');
    }
  }

  if (validationErrors.length) {
    throw new Error(`apply direct relationship review failed: ${validationErrors.slice(0, 120).join('; ')}`);
  }

  if (CHECK) {
    if (created.length > 0 && !APPLY) {
      report.would_apply_needed = true;
    }
    report.summary = `accepted rows: ${acceptedRows.length}, already published: ${exactHits.length}, pending rows: ${pending.length}`;
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (APPLY) {
    writeAtomic(ASSERTIONS_PATH, `${assertions.map((row) => JSON.stringify(row)).join('\n')}\n`);
    writeAtomic(REPORT_PATH, `${JSON.stringify({ ...report, created_ids: created.map((row) => row.assertion_id) }, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, would_create: pending.length }, null, 2));
}

main();
