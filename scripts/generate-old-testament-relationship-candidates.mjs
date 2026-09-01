#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL = path.join(ROOT, 'editorial');
const EXPORTS = path.join(ROOT, 'exports');
const OUTPUT = path.join(EDITORIAL, 'old-testament-relationship-candidates.jsonl');
const REPORT = path.join(EDITORIAL, 'old-testament-relationship-candidates-report.json');
const SCHEMA = path.join(ROOT, 'schemas', 'old-testament-relationship-candidates.schema.json');
const VALIDATE_ONLY = process.argv.includes('--validate-only');
const STAMP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8')).created_at;

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map(JSON.parse) : [];
}

function unique(values) { return [...new Set(values)]; }

function relationShape(kind, sourcePerson, targetPerson) {
  if (kind === 'parents') return { subject: targetPerson, object: sourcePerson, subtype: 'parent', direction: 'directed' };
  if (kind === 'offspring') return { subject: sourcePerson, object: targetPerson, subtype: 'parent', direction: 'directed' };
  if (kind === 'siblings' || kind === 'partners') {
    const [subject, object] = [sourcePerson, targetPerson].sort();
    return { subject, object, subtype: kind === 'siblings' ? 'sibling' : 'partner', direction: 'undirected' };
  }
  throw new Error(`unsupported relationship kind ${kind}`);
}

const candidates = readJsonl(path.join(EDITORIAL, 'old-testament-person-candidates.jsonl'));
const reviews = readJsonl(path.join(EDITORIAL, 'old-testament-person-review.jsonl'));
const acceptedIds = new Set(reviews.filter((row) => row.final_decision?.status === 'accepted').map((row) => row.candidate_id));
const acceptedCandidates = candidates.filter((row) => acceptedIds.has(row.candidate_id));
const exactIdentity = new Map(acceptedCandidates.map((row) => [row.step_identity_key.toLowerCase(), row]));
const personMapDoc = JSON.parse(fs.readFileSync(path.join(EXPORTS, 'old-testament-candidate-person-map.json'), 'utf8'));
const personByCandidate = new Map(personMapDoc.rows.map((row) => [row.candidate_id, row.person_id]));
const priorReviewed = fs.existsSync(path.join(EDITORIAL, 'old-testament-relationship-review-boardroom.jsonl'))
  ? readJsonl(path.join(EDITORIAL, 'old-testament-relationship-review-boardroom.jsonl')) : [];
const relationSignature = (row) => `${row.subject_person_id}|${row.object_person_id}|${row.relation_subtype}|${row.direction}`;
const priorIdBySignature = new Map(priorReviewed.map((row) => [relationSignature(row), row.candidate_relation_id]));
let nextCandidateId = Math.max(0, ...priorReviewed.map((row) => Number(String(row.candidate_relation_id || '').match(/(\d+)$/)?.[1] || 0))) + 1;

const aggregated = new Map();
let rawTokens = 0;
let placeholderTokens = 0;
let unresolvedTokens = 0;
let selfLoops = 0;

for (const sourceCandidate of acceptedCandidates) {
  const sourcePerson = personByCandidate.get(sourceCandidate.candidate_id);
  if (!sourcePerson) throw new Error(`missing person map ${sourceCandidate.candidate_id}`);
  for (const [kind, tokens] of Object.entries(sourceCandidate.relationships_raw || {})) {
    for (const token of tokens) {
      rawTokens += 1;
      const raw = String(token.raw || '').trim();
      if (!raw || ['+', '-', '?'].includes(raw)) { placeholderTokens += 1; continue; }
      const targetCandidate = exactIdentity.get(raw.toLowerCase());
      if (!targetCandidate) { unresolvedTokens += 1; continue; }
      const targetPerson = personByCandidate.get(targetCandidate.candidate_id);
      if (!targetPerson) { unresolvedTokens += 1; continue; }
      const shape = relationShape(kind, sourcePerson, targetPerson);
      if (shape.subject === shape.object) { selfLoops += 1; continue; }
      const signature = `${shape.subject}|${shape.object}|${shape.subtype}|${shape.direction}`;
      const intersections = (sourceCandidate.ot_refs || []).filter((ref) => (targetCandidate.ot_refs || []).includes(ref));
      const passages = token.refs?.length
        ? token.refs
        : intersections.length
          ? intersections
          : [sourceCandidate.ot_refs?.[0] || targetCandidate.ot_refs?.[0]].filter(Boolean);
      if (!passages.length) { unresolvedTokens += 1; continue; }
      const current = aggregated.get(signature) || {
        subject_person_id: shape.subject,
        object_person_id: shape.object,
        relation_type: 'kinship',
        relation_subtype: shape.subtype,
        direction: shape.direction,
        passages: [],
        source_candidate_ids: [],
        source_tokens: []
      };
      current.passages.push(...passages);
      current.source_candidate_ids.push(sourceCandidate.candidate_id, targetCandidate.candidate_id);
      current.source_tokens.push(`${kind}:${raw}`);
      aggregated.set(signature, current);
    }
  }
}

const rows = [...aggregated.values()]
  .sort((a, b) => `${a.subject_person_id}|${a.object_person_id}|${a.relation_subtype}`.localeCompare(`${b.subject_person_id}|${b.object_person_id}|${b.relation_subtype}`))
  .map((row) => ({
    candidate_relation_id: priorIdBySignature.get(relationSignature(row)) || `otrelc-${String(nextCandidateId++).padStart(6, '0')}`,
    subject_person_id: row.subject_person_id,
    object_person_id: row.object_person_id,
    relation_type: row.relation_type,
    relation_subtype: row.relation_subtype,
    direction: row.direction,
    evidence: unique(row.passages).map((passage) => ({
      source_id: 'source:0002',
      passage,
      evidence_level: 'modern_reference',
      note: `STEP TIPNR ${row.relation_subtype} field; requires editorial confirmation against the cited passage.`,
      certainty: 0.72
    })),
    source_candidate_ids: unique(row.source_candidate_ids),
    source_tokens: unique(row.source_tokens),
    status: 'pending',
    created_at: STAMP
  }));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA, 'utf8')));
const errors = [];
rows.forEach((row, index) => {
  if (!validate(row)) errors.push(`row ${index + 1}: ${ajv.errorsText(validate.errors)}`);
});
if (errors.length) throw new Error(`OT relationship candidates invalid (${errors.length}):\n${errors.slice(0, 50).join('\n')}`);

const report = {
  generated_at: STAMP,
  accepted_people: acceptedCandidates.length,
  raw_relationship_tokens: rawTokens,
  placeholder_tokens: placeholderTokens,
  unresolved_tokens: unresolvedTokens,
  self_loops_excluded: selfLoops,
  candidate_relationships: rows.length,
  relation_subtypes: Object.fromEntries(['parent', 'sibling', 'partner'].map((type) => [type, rows.filter((row) => row.relation_subtype === type).length]))
};

if (VALIDATE_ONLY) {
  const existing = readJsonl(OUTPUT);
  if (JSON.stringify(existing) !== JSON.stringify(rows)) throw new Error('OT relationship candidate snapshot is stale');
  const existingReport = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  if (JSON.stringify(existingReport) !== JSON.stringify(report)) throw new Error('OT relationship candidate report is stale');
} else {
  fs.writeFileSync(OUTPUT, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
