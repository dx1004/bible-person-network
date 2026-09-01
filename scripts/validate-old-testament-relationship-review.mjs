#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL = path.join(ROOT, 'editorial');
const DATA = path.join(ROOT, 'data');

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${file}:${index + 1}: invalid JSON`); }
  }) : [];
}

const sources = readJsonl(path.join(DATA, 'sources.jsonl'));
const anchors = new Set(
  sources
    .filter((row) => {
      const label = `${row.short_name || ''} ${row.edition || ''} ${row.title || ''} ${row.url || ''} ${row.notes || ''}`.toLowerCase();
      return label.includes('anchor');
    })
    .map((row) => row.source_id)
    .concat('source:0009')
);

function parseSourceToken(value) {
  const match = String(value || '').match(/^([a-z]+):(.+)@(.+)$/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

function hasValidLocator(passage) {
  return /^([1-3]?[A-Z]{2,4})\s+\d+:\d+(?:-\d+)?$/.test(String(passage || '').trim());
}

function hasMatchingStepTokens(candidate) {
  const tokenRows = Array.isArray(candidate.source_tokens) ? candidate.source_tokens : [];
  const parsedTokens = tokenRows.map(parseSourceToken).filter(Boolean);
  const tokenSet = new Set(parsedTokens);
  if (candidate.relation_type !== 'kinship' || !['parent', 'sibling', 'partner'].includes(candidate.relation_subtype)) {
    return true;
  }
  if (candidate.relation_subtype === 'sibling') {
    return tokenSet.has('siblings');
  }
  if (candidate.relation_subtype === 'partner') {
    return tokenSet.has('partners') || tokenSet.has('partner');
  }
  if (candidate.relation_subtype === 'parent') {
    return tokenSet.has('parents') || tokenSet.has('parent') || tokenSet.has('offspring');
  }
  return false;
}

function evidenceFromDecisionOrCandidate(candidate, finalRow) {
  const out = [];
  const addRefs = (refs) => {
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object') continue;
      const sourceId = String(ref.source_id || '').trim();
      const passage = String(ref.passage || '').trim();
      if (!sourceId || !hasValidLocator(passage)) continue;
      if (sourceId !== 'source:0002') continue;
      out.push({
        source_id: sourceId,
        passage,
        evidence_level: ref.evidence_level || '',
        note: ref.note || ''
      });
    }
  };
  addRefs(finalRow.final_decision?.decision_evidence_refs || []);
  addRefs(Array.isArray(candidate.evidence) ? candidate.evidence : []);
  return out;
}

function hasAnchorEvidence(candidate, finalRow) {
  for (const ref of finalRow.final_decision?.decision_evidence_refs || []) {
    if (anchors.has(String(ref.source_id || '').trim())) return true;
  }
  for (const ref of candidate.evidence || []) {
    if (anchors.has(String(ref.source_id || '').trim())) return true;
  }
  return false;
}

const candidates = readJsonl(path.join(EDITORIAL, 'old-testament-relationship-candidates.jsonl'));
const roundA = readJsonl(path.join(EDITORIAL, 'old-testament-relationship-review-round-a.jsonl'));
const roundB = readJsonl(path.join(EDITORIAL, 'old-testament-relationship-review-round-b.jsonl'));
const finalRows = readJsonl(path.join(EDITORIAL, 'old-testament-relationship-review-boardroom.jsonl'));
const correctionRows = fs.existsSync(path.join(EDITORIAL, 'curated-person-corrections.jsonl'))
  ? readJsonl(path.join(EDITORIAL, 'curated-person-corrections.jsonl')) : [];
const correctedCandidateIds = new Set(correctionRows.flatMap((row) => row.relation_candidate_ids || []));
const people = new Set(readJsonl(path.join(DATA, 'people.jsonl')).filter((row) => row.status === 'accepted').map((row) => row.person_id));
const mentions = readJsonl(path.join(DATA, 'mentions.jsonl'));
const mentionKeys = new Set(mentions.filter((row) => row.status === 'accepted').map((row) => `${row.person_id}|${row.passage}`));

const candidateById = new Map(candidates.map((row) => [row.candidate_relation_id, row]));
const aById = new Map(roundA.map((row) => [row.candidate_relation_id, row]));
const bById = new Map(roundB.map((row) => [row.candidate_relation_id, row]));
const finalById = new Map(finalRows.map((row) => [row.candidate_relation_id, row]));
const errors = [];

for (const [label, rows, map] of [['round A', roundA, aById], ['round B', roundB, bById], ['boardroom', finalRows, finalById]]) {
  if (rows.length !== candidates.length + correctedCandidateIds.size) errors.push(`${label}: expected ${candidates.length + correctedCandidateIds.size}, got ${rows.length}`);
  if (map.size !== rows.length) errors.push(`${label}: duplicate candidate_relation_id`);
}
for (const id of correctedCandidateIds) {
  if (candidateById.has(id)) { errors.push(`${id}: corrected non-person candidate must not remain generated`); continue; }
  if (aById.get(id)?.round1?.status !== 'rejected' || bById.get(id)?.round2?.status !== 'rejected' || finalById.get(id)?.final_decision?.status !== 'rejected') {
    errors.push(`${id}: corrected non-person candidate must retain three rejected review stages`);
  }
}

for (const candidate of candidates) {
  const id = candidate.candidate_relation_id;
  const a = aById.get(id);
  const b = bById.get(id);
  const final = finalById.get(id);
  if (!a || !b || !final) { errors.push(`${id}: missing review stage`); continue; }
  for (const row of [a, b, final]) {
    for (const key of ['subject_person_id', 'object_person_id', 'relation_type', 'relation_subtype', 'direction']) {
      if (row[key] !== candidate[key]) errors.push(`${id}: ${key} drift`);
    }
  }
  if (!people.has(candidate.subject_person_id) || !people.has(candidate.object_person_id)) errors.push(`${id}: endpoint not accepted`);
  if (candidate.subject_person_id === candidate.object_person_id) errors.push(`${id}: self-loop`);
  const aStatus = a.round1?.status;
  const bStatus = b.round2?.status;
  const finalStatus = final.final_decision?.status;
  if (!['accepted', 'pending', 'rejected'].includes(aStatus)) errors.push(`${id}: invalid round A status`);
  if (!['accepted', 'pending', 'rejected'].includes(bStatus)) errors.push(`${id}: invalid round B status`);
  if (!['accepted', 'pending', 'rejected'].includes(finalStatus)) errors.push(`${id}: invalid final status`);
  if (finalStatus === 'accepted' && (aStatus !== 'accepted' || bStatus !== 'accepted')) errors.push(`${id}: final accepted without two accepted rounds`);
  if (finalStatus === 'accepted') {
  const shared = final.evidence_audit?.validation?.shared_accepted_mention_passages || [];
  const sourceRefs = evidenceFromDecisionOrCandidate(candidate, final) || [];
  if (!shared.length && !sourceRefs.length) {
    errors.push(`${id}: accepted without positive evidence`);
  }
  if (!shared.length && sourceRefs.length && !hasMatchingStepTokens(candidate)) {
    errors.push(`${id}: missing semantically matching STEP tokens`);
  }
    if (hasAnchorEvidence(candidate, final)) {
      errors.push(`${id}: anchor source used in accepted evidence`);
    }
    for (const passage of shared) {
      if (!mentionKeys.has(`${candidate.subject_person_id}|${passage}`)) errors.push(`${id}: missing subject mention ${passage}`);
      if (!mentionKeys.has(`${candidate.object_person_id}|${passage}`)) errors.push(`${id}: missing object mention ${passage}`);
    }
  }
  const prohibitedKeys = new Set(['source_text', 'article_body', 'excerpt', 'quotation']);
  const stack = [final];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (prohibitedKeys.has(key)) errors.push(`${id}: prohibited source-text field ${key}`);
      if (child && typeof child === 'object') stack.push(child);
    }
  }
}

if (errors.length) throw new Error(`OT relationship review failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);

const counts = Object.fromEntries(['accepted', 'pending', 'rejected'].map((status) => [status, finalRows.filter((row) => row.final_decision.status === status).length]));
const pairs = {};
for (const candidate of candidates) {
  const pair = `${aById.get(candidate.candidate_relation_id).round1.status}|${bById.get(candidate.candidate_relation_id).round2.status}`;
  pairs[pair] = (pairs[pair] || 0) + 1;
}
console.log(JSON.stringify({ status: 'ok', candidates: candidates.length, rounds: { a: roundA.length, b: roundB.length, final: finalRows.length }, round_pairs: pairs, final_counts: counts, source_text_stored: false }, null, 2));
