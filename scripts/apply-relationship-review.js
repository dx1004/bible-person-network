#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'relationship-review.schema.json');

const ASSERTIONS_PATH = path.join(DATA_DIR, 'assertions.jsonl');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.jsonl');
const REVIEW_PATH = path.join(EDITORIAL_DIR, 'relationship-review.jsonl');
const OUTPUT_PATH = ASSERTIONS_PATH;

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
    dryRun: args.includes('--dry-run'),
    check: args.includes('--check')
  };
}

function validateReviewSnapshot() {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'init-relationship-review.js'), '--validate-only'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(`review snapshot validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function evidenceMatches(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function parseArgsDecisionRefs(rawRefs, sourceSet) {
  const refs = Array.isArray(rawRefs) ? rawRefs : [];
  return refs.map((r) => {
    if (!r || typeof r !== 'object') {
      throw new Error('Decision evidence reference must be object');
    }
    const ref = {
      source_id: r.source_id,
      passage: String(r.passage ?? ''),
      evidence_level: r.evidence_level,
      note: String(r.note ?? ''),
      certainty: Number(r.certainty)
    };
    if (!sourceSet.has(ref.source_id)) {
      throw new Error(`Evidence ref source_id not found: ${ref.source_id}`);
    }
    if (!ref.passage) throw new Error('Decision evidence reference missing passage');
    if (!['nt_text', 'ancient_text', 'reference', 'modern_reference', 'editorial'].includes(ref.evidence_level)) {
      throw new Error(`Invalid evidence_level ${ref.evidence_level}`);
    }
    if (Number.isNaN(ref.certainty) || ref.certainty < 0 || ref.certainty > 1) {
      throw new Error(`Invalid evidence certainty ${ref.certainty}`);
    }
    if (ref.evidence_level === 'nt_text') {
      if (ref.source_id !== 'source:0001') {
        throw new Error('nt_text evidence must use source:0001');
      }
      const normalized = normalizeNtLocator(ref.passage);
      if (!normalized) throw new Error(`Invalid nt_text locator: ${ref.passage}`);
      ref.passage = normalized;
    }
    return ref;
  });
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

function normalizeNtLocator(passage) {
  if (typeof passage !== 'string') return false;
  if (/^\s*STEP:/i.test(passage)) return false;
  const match = passage.trim().match(/^([1-3]?[A-Z]{2,4})\s+(\d+:\d+(?:-\d+)?)$/);
  if (!match) return false;
  if (!NT_BOOKS.has(match[1])) return false;
  return `${match[1]} ${match[2]}`;
}

function validateDecision(name, decision, sourceSet) {
  const d = normalizeDecision(decision);
  if (!['pending', 'accepted', 'rejected'].includes(d.status)) {
    throw new Error(`${name}: invalid status ${d.status}`);
  }
  const refs = parseArgsDecisionRefs(d.decision_evidence_refs, sourceSet);

  if (d.status === 'pending') {
    if (d.reviewed_at !== null) throw new Error(`${name}: pending reviewed_at must be null`);
    if (d.reviewer !== null) throw new Error(`${name}: pending reviewer must be null`);
    if (d.decision_note !== '') throw new Error(`${name}: pending decision_note must be empty`);
    if (d.decision_relation_type !== null || d.decision_relation_subtype !== null || d.decision_direction !== null || refs.length !== 0) {
      throw new Error(`${name}: pending decision must not include relation or evidence`);
    }
    return { ...d, decision_evidence_refs: refs };
  }

  if (d.status === 'rejected') {
    if (!d.reviewer?.trim()) throw new Error(`${name}: rejected decision requires reviewer`);
    if (!d.reviewed_at || Number.isNaN(Date.parse(d.reviewed_at))) throw new Error(`${name}: rejected decision requires reviewed_at`);
    if (typeof d.decision_note !== 'string' || !d.decision_note.trim()) throw new Error(`${name}: rejected decision requires decision_note`);
    if (d.decision_relation_type !== null || d.decision_relation_subtype !== null || d.decision_direction !== null || refs.length !== 0) {
      throw new Error(`${name}: rejected decision must not include replacement relation or refs`);
    }
    return { ...d, decision_evidence_refs: refs };
  }

  if (!d.decision_relation_type || !['kinship', 'teacher_student', 'collegial', 'commission', 'host', 'political', 'legal', 'hostile'].includes(d.decision_relation_type)) {
    throw new Error(`${name}: accepted decision_relation_type invalid`);
  }
  if (!d.decision_direction || !['directed', 'undirected'].includes(d.decision_direction)) {
    throw new Error(`${name}: accepted decision_direction invalid`);
  }
  if (!d.reviewer?.trim()) throw new Error(`${name}: accepted decision requires reviewer`);
  if (!d.reviewed_at || Number.isNaN(Date.parse(d.reviewed_at))) throw new Error(`${name}: accepted decision requires reviewed_at`);
  if (typeof d.decision_note !== 'string' || !d.decision_note.trim()) throw new Error(`${name}: accepted decision requires decision_note`);
  if (refs.length < 1) throw new Error(`${name}: accepted decision requires at least one evidence ref`);
  return { ...d, decision_evidence_refs: refs };
}

function buildMap(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.assertion_id, row);
  return map;
}

function minimumConfidence(evidenceRefs) {
  let min = 1;
  for (const ref of evidenceRefs) {
    if (typeof ref.certainty === 'number' && !Number.isNaN(ref.certainty)) {
      if (ref.certainty < min) min = ref.certainty;
    }
  }
  return min;
}

function applyRelationshipReviews({ check, dryRun }) {
  if (!fs.existsSync(SCHEMA_PATH)) throw new Error(`Missing schema: ${SCHEMA_PATH}`);

  const assertions = readJsonl(ASSERTIONS_PATH);
  const sources = readJsonl(SOURCES_PATH);
  const reviews = readJsonl(REVIEW_PATH);
  const sourceSet = new Set(sources.map((s) => s.source_id));

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (reviews.length !== assertions.length) {
    throw new Error(`review row count ${reviews.length} does not match assertions count ${assertions.length}`);
  }

  const reviewMap = buildMap(reviews);
  const assertionMap = buildMap(assertions);
  const seenReviewIds = new Set();
  const seenAssertionIds = new Set();

  const counts = {
    unchanged: 0,
    activated: 0,
    pending: 0,
    rejected: 0,
    skipped: 0
  };

  for (const [index, row] of reviews.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at relationship-review:${index + 1}: ${details}`);
    }

    const reviewId = row.review_id;
    if (seenReviewIds.has(reviewId)) throw new Error(`Duplicate review id ${reviewId}`);
    seenReviewIds.add(reviewId);
    if (seenAssertionIds.has(row.assertion_id)) throw new Error(`Duplicate assertion_id ${row.assertion_id}`);
    seenAssertionIds.add(row.assertion_id);
    const assertion = assertionMap.get(row.assertion_id);
    if (!assertion) throw new Error(`Unknown assertion_id ${row.assertion_id}`);

    const round1 = validateDecision(`round1 (${row.assertion_id})`, row.round1, sourceSet);
    const round2 = validateDecision(`round2 (${row.assertion_id})`, row.round2, sourceSet);
    const finalDecision = validateDecision(`final (${row.assertion_id})`, row.final_decision, sourceSet);
    if (finalDecision.status === 'accepted') {
      if (round1.status !== 'accepted' || round2.status !== 'accepted') {
        throw new Error(`final accepted requires round1 and round2 accepted: ${row.assertion_id}`);
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

    if (finalDecision.status === 'pending') {
      counts.pending += 1;
      continue;
    }
    if (finalDecision.status === 'rejected') {
      counts.rejected += 1;
      assertionMap.set(row.assertion_id, {
        ...assertion,
        status: 'superseded',
        updated_at: finalDecision.reviewed_at
      });
      continue;
    }

    const current = assertion;
    const updatedEvidence = finalDecision.decision_evidence_refs.map((ref) => ({ ...ref }));
    const { relation_subtype: _previousSubtype, ...currentWithoutSubtype } = current;
    const next = {
      ...currentWithoutSubtype,
      relation_type: finalDecision.decision_relation_type,
      ...(finalDecision.decision_relation_subtype === null
        ? {}
        : { relation_subtype: finalDecision.decision_relation_subtype }),
      direction: finalDecision.decision_direction,
      evidence: updatedEvidence,
      status: 'active',
      editorial_status: 'conservative',
      confidence: minimumConfidence(updatedEvidence),
      updated_at: finalDecision.reviewed_at
    };

    if (!evidenceMatches(current, next)) {
      assertionMap.set(row.assertion_id, next);
      counts.activated += 1;
    } else {
      counts.unchanged += 1;
    }
  }

  if (seenAssertionIds.size !== assertions.length) {
    const missingAssertionIds = assertions
      .map((assertion) => assertion.assertion_id)
      .filter((id) => !seenAssertionIds.has(id));
    throw new Error(`Missing review rows for assertions: ${missingAssertionIds.join(',')}`);
  }

  if (check) {
    console.log(`OK apply:relationship-review check passed. activated=${counts.activated}, unchanged=${counts.unchanged}, pending=${counts.pending}, rejected=${counts.rejected}`);
    return;
  }

  if (dryRun) {
    const output = assertions.map((a) => assertionMap.get(a.assertion_id) ?? a);
    const changed = output.filter((row, idx) => evidenceMatches(row, assertions[idx]) === false);
    console.log(`DRY RUN summary: activated=${counts.activated}, unchanged=${counts.unchanged}, pending=${counts.pending}, rejected=${counts.rejected}, wouldChange=${changed.length}`);
    return;
  }

  const next = assertions.map((a) => assertionMap.get(a.assertion_id) ?? a);
  const currentOutput = assertions.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const nextOutput = next.map((row) => JSON.stringify(row)).join('\n') + '\n';
  if (currentOutput === nextOutput) {
    console.log('OK apply:relationship-review (no-op, deterministic snapshot preserved)');
    return;
  }
  fs.writeFileSync(OUTPUT_PATH, nextOutput, 'utf8');
  console.log(`OK apply:relationship-review applied: activated=${counts.activated}, unchanged=${counts.unchanged}, pending=${counts.pending}, rejected=${counts.rejected}`);
}

function main() {
  const args = parseArgs();
  validateReviewSnapshot();
  applyRelationshipReviews({ check: args.check, dryRun: args.dryRun });
}

main();
