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
const PEOPLE_PATH = path.join(DATA_DIR, 'people.jsonl');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.jsonl');
const REVIEW_PATH = path.join(EDITORIAL_DIR, 'composite-kinship-inference-review.jsonl');
const REVIEW_REPORT_PATH = path.join(EDITORIAL_DIR, 'composite-kinship-inference-review-report.json');
const ASSERTIONS_SCHEMA_PATH = path.join(ROOT, 'schemas', 'assertions.schema.json');
const REVIEW_SCHEMA_PATH = path.join(ROOT, 'schemas', 'composite-kinship-inference-review.schema.json');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'composite-kinship-inference-application-report.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const MODE = APPLY ? 'apply' : CHECK ? 'check' : 'preview';

if (APPLY && CHECK) {
  throw new Error('do not pass both --apply and --check');
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at ${filePath}:${index + 1}`);
    }
  });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function canonicalPremiseSignature(assertionIds) {
  return [...(assertionIds || [])].map(String).sort().join('|');
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
}

function evidenceKey(item) {
  return `${item.source_id}|${item.passage}|${item.evidence_level}|${item.note}|${item.certainty}`;
}

function evidenceEquals(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map(evidenceKey));
  return a.every((item) => setB.has(evidenceKey(item)));
}

function assertSignature(row) {
  return `${row.subject_person_id}|${row.object_person_id}|${row.relation_type}|${row.relation_subtype || ''}|${row.direction}`;
}

function toInferenceCertainty(raw, reviewId, errors) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    errors.push(`invalid inference_certainty in ${reviewId}`);
    return 0.82;
  }
  if (value < 0.65 || value > 0.84) {
    errors.push(`inference_certainty out of range in ${reviewId}: ${value}`);
  }
  return value;
}

function stableEvidence(row, premiseById, knownSources, reviewId, rowErrors, mode) {
  const out = [];
  const seen = new Set();
  const certainty = toInferenceCertainty(row.inference_certainty, reviewId, rowErrors);

  for (const premiseId of row.premise_assertion_ids || []) {
    const premise = premiseById.get(premiseId);
    const premiseLabel = `${reviewId}:${premiseId}`;
    if (!premise) {
      rowErrors.push(`missing premise assertion ${premiseId} in ${reviewId}`);
      continue;
    }
    if (!Array.isArray(premise.evidence) || premise.evidence.length === 0) {
      rowErrors.push(`premise ${premiseId} has no evidence in ${reviewId}`);
      continue;
    }

    for (const item of premise.evidence) {
      const sourceId = String(item?.source_id || '').trim();
      const passage = String(item?.passage || '').trim();

      if (!sourceId) {
        rowErrors.push(`missing source_id in premise evidence ${premiseLabel}`);
        if (mode !== 'check-and-apply') {
          continue;
        }
      }
      if (!passage) {
        rowErrors.push(`missing passage in premise evidence ${premiseLabel}`);
        if (mode !== 'check-and-apply') {
          continue;
        }
      }
      if (sourceId && !knownSources.has(sourceId)) {
        rowErrors.push(`unknown source_id ${sourceId} in premise evidence ${premiseLabel}`);
      }
      if (rowErrors.some((m) => m.startsWith('missing source_id') || m.startsWith('missing passage') || m.startsWith('unknown source_id'))) {
        if (mode === 'check-and-apply') {
          continue;
        }
      }

      const evidence = {
        source_id: sourceId,
        passage,
        evidence_level: 'inference',
        note: `复合亲属推论 ${row.rule}：${row.review_id}`,
        certainty,
      };
      const key = evidenceKey(evidence);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(evidence);
    }

    if (out.length === 0) {
      rowErrors.push(`no usable premise evidence for ${reviewId}`);
    }
  }

  return out;
}

function normalizeCounterEvidence(row, reviewId, rowErrors) {
  const input = row.counterevidence_review && typeof row.counterevidence_review === 'object'
    ? row.counterevidence_review
    : {};

  const output = {
    identity_conflict: Boolean(input.identity_conflict),
    chronology_conflict: Boolean(input.chronology_conflict),
    generation_conflict: Boolean(input.generation_conflict),
    scriptural_conflict: Boolean(input.scriptural_conflict),
    note: String(input.note || '').trim(),
  };

  if (!output.note) {
    rowErrors.push(`missing counterevidence_review.note in ${reviewId}`);
    output.note = `no counterevidence note for ${reviewId}`;
  }

  return output;
}

function nextAssertionNumber(assertions) {
  let next = 0;
  for (const row of assertions) {
    const match = /^asrt-(\d+)$/.exec(String(row.assertion_id || ''));
    if (match) next = Math.max(next, Number(match[1]));
  }
  return next;
}

function personStatusIsAccepted(peopleById, personId) {
  const person = peopleById.get(personId);
  return person && person.status === 'accepted';
}

function loadStamp() {
  const manifest = readJson(MANIFEST_PATH);
  return manifest?.created_at || new Date().toISOString();
}

function countRows(rows, predicate) {
  return rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
}

function computeReviewSnapshotHash(reviewRows) {
  const blob = reviewRows.map((row) => `${stableStringify(row)}\n`).join('');
  return sha256(blob);
}

function main() {
  const assertions = readJsonl(ASSERTIONS_PATH);
  const people = readJsonl(PEOPLE_PATH);
  const sources = readJsonl(SOURCES_PATH);
  const reviewRows = readJsonl(REVIEW_PATH);
  const reviewReport = readJson(REVIEW_REPORT_PATH);

  if (!reviewReport || typeof reviewReport !== 'object') {
    console.error(JSON.stringify({ mode: MODE, errors: ['composite review report not found or invalid'] }, null, 2));
    process.exit(1);
  }

  const requiredFields = ['input_snapshot_sha256', 'row_snapshot_sha256'];
  for (const field of requiredFields) {
    if (!reviewReport[field]) {
      console.error(JSON.stringify({ mode: MODE, errors: [`review report missing ${field}`] }, null, 2));
      process.exit(1);
    }
  }

  const peopleById = new Map(people.map((p) => [p.person_id, p]));
  const sourcesSet = new Set(sources.map((s) => String(s.source_id || '')));
  const assertionsById = new Map(assertions.map((row) => [row.assertion_id, row]));

  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const assertionsSchema = JSON.parse(fs.readFileSync(ASSERTIONS_SCHEMA_PATH, 'utf8'));
  const reviewSchema = JSON.parse(fs.readFileSync(REVIEW_SCHEMA_PATH, 'utf8'));
  const validateAssertion = ajv.compile(assertionsSchema);
  const validateReview = ajv.compile(reviewSchema);

  const computedRowSnapshot = computeReviewSnapshotHash(reviewRows);
  const errors = [];

  if (reviewReport.row_snapshot_sha256 !== computedRowSnapshot) {
    errors.push(`row_snapshot_sha256 mismatch: report=${reviewReport.row_snapshot_sha256} computed=${computedRowSnapshot}`);
  }

  for (let i = 0; i < assertions.length; i += 1) {
    if (!validateAssertion(assertions[i])) {
      errors.push(
        `assertions:${i + 1}:${(validateAssertion.errors || []).map((e) => `${e.instancePath || ''} ${e.message}`).join('; ')}`
      );
    }
  }

  const seenReview = new Set();
  const seenCandidate = new Set();

  for (let i = 0; i < reviewRows.length; i += 1) {
    const row = reviewRows[i];
    if (!validateReview(row)) {
      errors.push(
        `review:${i + 1}:${(validateReview.errors || []).map((e) => `${e.instancePath || ''} ${e.message}`).join('; ')}`
      );
    }

    if (seenReview.has(row.review_id)) {
      errors.push(`duplicate review_id ${row.review_id}`);
    }
    seenReview.add(row.review_id);

    if (seenCandidate.has(row.candidate_relation_id)) {
      errors.push(`duplicate candidate_relation_id ${row.candidate_relation_id}`);
    }
    seenCandidate.add(row.candidate_relation_id);

    if (!row.review_id) {
      errors.push(`missing review_id at review row ${i + 1}`);
    }

    if (!row.subject_person_id || !row.object_person_id) {
      errors.push(`missing subject/object person in review ${row.review_id || i + 1}`);
    }

    if (!peopleById.has(row.subject_person_id)) {
      errors.push(`missing subject person ${row.subject_person_id} (${row.review_id})`);
    }
    if (!peopleById.has(row.object_person_id)) {
      errors.push(`missing object person ${row.object_person_id} (${row.review_id})`);
    }
    if (!personStatusIsAccepted(peopleById, row.subject_person_id)) {
      errors.push(`subject person status not accepted ${row.subject_person_id} (${row.review_id})`);
    }
    if (!personStatusIsAccepted(peopleById, row.object_person_id)) {
      errors.push(`object person status not accepted ${row.object_person_id} (${row.review_id})`);
    }
    if (row.subject_person_id === row.object_person_id) {
      errors.push(`self-loop in ${row.review_id}`);
    }

    if (!Array.isArray(row.premise_assertion_ids) || row.premise_assertion_ids.length < 2) {
      errors.push(`premise_assertion_ids invalid in ${row.review_id}`);
      continue;
    }

    const seenPremise = new Set();
    for (const premiseId of row.premise_assertion_ids) {
      if (seenPremise.has(premiseId)) {
        errors.push(`duplicate premise id ${premiseId} in ${row.review_id}`);
      }
      seenPremise.add(premiseId);
      const premise = assertionsById.get(premiseId);
      if (!premise) {
        errors.push(`missing premise assertion ${premiseId} in ${row.review_id}`);
        continue;
      }
      if (premise.status !== 'active') {
        errors.push(`premise assertion ${premiseId} not active in ${row.review_id}`);
      }
      if (!Array.isArray(premise.evidence) || premise.evidence.length === 0) {
        errors.push(`premise ${premiseId} has no evidence in ${row.review_id}`);
      }
      if (Array.isArray(premise.evidence)) {
        for (const item of premise.evidence) {
          const sourceId = String(item?.source_id || '').trim();
          const passage = String(item?.passage || '').trim();
          if (!sourceId) {
            errors.push(`missing source_id in premise evidence ${row.review_id}:${premiseId}`);
          }
          if (!passage) {
            errors.push(`missing passage in premise evidence ${row.review_id}:${premiseId}`);
          }
          if (sourceId && !sourcesSet.has(sourceId)) {
            errors.push(`unknown source_id ${sourceId} in premise evidence ${row.review_id}:${premiseId}`);
          }
        }
      }
    }
  }

  const activeBySig = new Map();
  const acceptedPeople = new Set(people.filter((p) => p.status === 'accepted').map((p) => p.person_id));
  for (const row of assertions.filter((row) => row.status === 'active')) {
    if (!acceptedPeople.has(row.subject_person_id) || !acceptedPeople.has(row.object_person_id)) continue;
    const key = assertSignature(row);
    const list = activeBySig.get(key) || [];
    list.push(row);
    activeBySig.set(key, list);
  }

  const acceptedReviews = reviewRows
    .filter((row) => row.final_decision?.status === 'accepted')
    .sort((a, b) => String(a.review_id).localeCompare(String(b.review_id)));

  const created = [];
  const blocked = [];
  const wouldCreateIds = [];

  for (const row of acceptedReviews) {
    const rowErrors = [];
    const seenPremise = new Set();
    for (const premiseId of row.premise_assertion_ids || []) {
      if (seenPremise.has(premiseId)) {
        rowErrors.push(`duplicate premise id ${premiseId} in ${row.review_id}`);
      }
      seenPremise.add(premiseId);
    }

    let evidence = [];
    try {
      evidence = stableEvidence(row, assertionsById, sourcesSet, row.review_id, rowErrors, 'check');
    } catch (error) {
      rowErrors.push(String(error.message || error));
    }

    const normalizedCounter = normalizeCounterEvidence(row, row.review_id, rowErrors);
    if (!rowErrors.length) {
 const confidence = toInferenceCertainty(row.inference_certainty, row.review_id, rowErrors);
      if (rowErrors.length) {
        // handled below
      }

      const proposal = {
        assertion_id: 'asrt-9999',
        subject_person_id: row.subject_person_id,
        object_person_id: row.object_person_id,
        relation_type: row.relation_type,
        relation_subtype: row.relation_subtype,
        direction: row.direction,
        status: 'active',
        confidence,
        editorial_status: 'conservative',
        editor_note: `复合亲属推论入库：${row.review_id}`,
        evidence,
        inference: {
          rule: row.rule,
          premise_assertion_ids: row.premise_assertion_ids,
          counterevidence_review: normalizedCounter,
          certainty: confidence,
          review_status: 'three_round_accepted',
        },
        created_at: loadStamp(),
        updated_at: loadStamp(),
      };

      const key = assertSignature(proposal);
      const existing = activeBySig.get(key) || [];

      if (!validateAssertion(proposal)) {
        rowErrors.push(`would-create assertion schema invalid from ${row.review_id}: ${(validateAssertion.errors || []).map((e) => `${e.instancePath || ''} ${e.message}`).join('; ')}`);
      } else {
      const exactMatch = existing.find((a) =>
        a.inference?.rule === row.rule
        && canonicalPremiseSignature(a.inference?.premise_assertion_ids || []) === canonicalPremiseSignature(row.premise_assertion_ids || [])
      );
        if (exactMatch) {
          continue;
        }

        if (existing.length > 0) {
          errors.push(`non-exact assertion already active for ${row.review_id}; fail-closed same-signature mismatch`);
          blocked.push(row.review_id);
          continue;
        }

        created.push({ row, assertion: proposal });
        wouldCreateIds.push(row.review_id);
      }
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
    }
  }

  const report = {
    mode: MODE,
    total_rows: reviewRows.length,
    accepted_rows: countRows(reviewRows, (r) => r.final_decision?.status === 'accepted'),
    rejected_rows: countRows(reviewRows, (r) => r.final_decision?.status === 'rejected'),
    pending_rows: countRows(reviewRows, (r) => r.final_decision?.status === 'pending'),
    would_create: created.length,
    would_blocked: blocked.length,
    errors_count: errors.length,
    would_create_ids: wouldCreateIds,
    input_snapshot_sha256: reviewReport.input_snapshot_sha256,
    row_snapshot_sha256: reviewReport.row_snapshot_sha256,
    input_counts: reviewReport?.input_counts || null,
  };

  if (errors.length) {
    report.errors = errors;
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  if (!APPLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const next = nextAssertionNumber(assertions);
  const planned = assertions.map((row) => ({ ...row }));
  let seq = next;
  const allChanges = [];

  for (const item of created) {
    seq += 1;
    const added = {
      ...item.assertion,
      assertion_id: `asrt-${String(seq).padStart(4, '0')}`,
    };
    if (!validateAssertion(added)) {
      throw new Error(
        `added assertion schema invalid ${item.row.review_id}: ${(validateAssertion.errors || []).map((e) => `${e.instancePath || ''} ${e.message}`).join('; ')}`
      );
    }
    allChanges.push(item.row.review_id);
    planned.push(added);
  }

  const output = `${planned
    .sort((a, b) => {
      const ma = /^asrt-(\d+)$/.exec(String(a.assertion_id || ''));
      const mb = /^asrt-(\d+)$/.exec(String(b.assertion_id || ''));
      return (ma ? Number(ma[1]) : 0) - (mb ? Number(mb[1]) : 0);
    })
    .map((row) => JSON.stringify(row)).join('\n')}\n`;

  atomicWrite(ASSERTIONS_PATH, output);
  atomicWrite(REPORT_PATH, `${JSON.stringify({ ...report, applied_changes: allChanges }, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, applied_changes: allChanges }, null, 2));
}

main();
