#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSERTIONS = path.join(ROOT, 'data', 'assertions.jsonl');
const REVIEW = path.join(ROOT, 'editorial', 'old-testament-relationship-review-boardroom.jsonl');
const CANDIDATES = path.join(ROOT, 'editorial', 'old-testament-relationship-candidates.jsonl');
const REPORT = path.join(ROOT, 'exports', 'old-testament-relationship-application-report.json');
const APPLY = process.argv.includes('--apply');
const STAMP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8')).created_at;

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map(JSON.parse) : [];
}
function numericId(value) { return Number(String(value || '').match(/(\d+)$/)?.[1] || 0); }
function signature(row) { return `${row.subject_person_id}|${row.object_person_id}|${row.relation_type}|${row.relation_subtype || ''}|${row.direction}`; }
function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

function hasValidLocator(passage) {
  return /^([1-3]?[A-Z]{2,4})\s+\d+:\d+(?:-\d+)?$/.test(String(passage || '').trim());
}

function parseSourceToken(value) {
  const match = String(value || '').match(/^([a-z]+):(.+)@(.+)$/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

function hasMatchingStepTokens(candidate) {
  const tokenRows = Array.isArray(candidate.source_tokens) ? candidate.source_tokens : [];
  const parsedTokens = tokenRows.map(parseSourceToken).filter(Boolean);
  const tokenSet = new Set(parsedTokens);
  if (candidate.relation_subtype === 'sibling') {
    return tokenSet.has('siblings') && parsedTokens.filter((token) => token === 'siblings').length >= 2;
  }
  if (candidate.relation_subtype === 'partner') {
    return (tokenSet.has('partners') || tokenSet.has('partner')) &&
      parsedTokens.filter((token) => token === 'partners' || token === 'partner').length >= 2;
  }
  if (candidate.relation_subtype === 'parent') {
    return (tokenSet.has('parents') || tokenSet.has('parent')) && tokenSet.has('offspring');
  }
  return false;
}

function resolveEvidenceRefs(candidate, row, sharedPassages) {
  const out = [];
  const addRef = (ref) => {
    if (!ref || typeof ref !== 'object') return;
    const source_id = String(ref.source_id || '').trim();
    const passage = String(ref.passage || '').trim();
    if (!source_id || source_id === 'source:0009') return;
    if (source_id !== 'source:0002') return;
    if (!hasValidLocator(passage)) return;
    const evidence_level = ref.evidence_level || 'modern_reference';
    const note = String(ref.note || '').trim() || `STEP TIPNR ${candidate?.relation_subtype || ''} field; two-round OT relationship review accepted this shared locator.`;
    out.push({ source_id, passage, evidence_level, note, certainty: Number(ref.certainty ?? 0.78) });
  };
  for (const ref of (row.final_decision?.decision_evidence_refs || [])) {
    addRef(ref);
  }
  for (const ref of (candidate.evidence || [])) {
    addRef(ref);
  }
  for (const passage of (sharedPassages || [])) {
    addRef({ source_id: 'source:0002', passage, evidence_level: 'modern_reference', note: 'Shared accepted mention passage for OT relationship review.' });
  }
  const seen = new Set();
  const deduped = [];
  for (const ref of out) {
    const key = `${ref.source_id}|${ref.passage}|${ref.evidence_level}|${ref.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

const assertions = readJsonl(ASSERTIONS);
const finalRows = readJsonl(REVIEW);
const candidates = new Map(readJsonl(CANDIDATES).map((row) => [row.candidate_relation_id, row]));
const accepted = finalRows.filter((row) => row.final_decision?.status === 'accepted');
const activeBySignature = new Map(assertions.filter((row) => row.status === 'active').map((row) => [signature(row), row]));
let nextAssertion = Math.max(...assertions.map((row) => numericId(row.assertion_id)), 0) + 1;
let created = 0;
let enriched = 0;

for (const row of accepted) {
  const sharedPassages = row.evidence_audit?.validation?.shared_accepted_mention_passages || [];
  const candidate = candidates.get(row.candidate_relation_id);
  if (!candidate) {
    throw new Error(`apply ot relationship review failed: missing candidate for ${row.candidate_relation_id}`);
  }
  const evidence = resolveEvidenceRefs(candidate, row, sharedPassages || []);
  const useFallbackEvidence = evidence.length === 0;
  if (useFallbackEvidence && !hasMatchingStepTokens(candidate)) {
    throw new Error(`apply ot relationship review failed: accepted row ${row.candidate_relation_id} has no usable source:0002 evidence and unmatched STEP tokens`);
  }
  if (evidence.length === 0) {
    throw new Error(`apply ot relationship review failed: accepted row ${row.candidate_relation_id} has no source:0002 evidence refs`);
  }
  const key = signature(row);
  const existing = activeBySignature.get(key);
  if (existing) {
    const evidenceKeys = new Set(existing.evidence.map((item) => `${item.source_id}|${item.passage}|${item.evidence_level}`));
    let changed = false;
    for (const item of evidence) {
      const evidenceKey = `${item.source_id}|${item.passage}|${item.evidence_level}`;
      if (evidenceKeys.has(evidenceKey)) continue;
      existing.evidence.push(item);
      evidenceKeys.add(evidenceKey);
      changed = true;
    }
    if (changed) {
      existing.editor_note = `${existing.editor_note || ''}; OT review ${row.candidate_relation_id}`.replace(/^;\s*/, '');
      existing.updated_at = STAMP;
      enriched += 1;
    }
    continue;
  }
  const assertion = {
    assertion_id: `asrt-${String(nextAssertion++).padStart(4, '0')}`,
    subject_person_id: row.subject_person_id,
    object_person_id: row.object_person_id,
    relation_type: row.relation_type,
    relation_subtype: row.relation_subtype,
    direction: row.direction,
    evidence,
    status: 'active',
    confidence: 0.78,
    editorial_status: 'conservative',
    editor_note: `Accepted OT relationship review ${row.candidate_relation_id}.`,
    created_at: STAMP,
    updated_at: STAMP
  };
  assertions.push(assertion);
  activeBySignature.set(key, assertion);
  created += 1;
}

assertions.sort((a, b) => numericId(a.assertion_id) - numericId(b.assertion_id));
const report = {
  mode: APPLY ? 'apply' : 'dry-run',
  accepted_review_rows: accepted.length,
  pending_review_rows: finalRows.filter((row) => row.final_decision?.status === 'pending').length,
  created_assertions: created,
  enriched_existing_assertions: enriched,
  total_assertions: assertions.length,
  active_assertions: assertions.filter((row) => row.status === 'active').length
};

if (APPLY) {
  writeAtomic(ASSERTIONS, `${assertions.map((row) => JSON.stringify(row)).join('\n')}\n`);
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  writeAtomic(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
