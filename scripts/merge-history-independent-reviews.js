#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_PATH = path.join(ROOT, 'editorial', 'relationship-review.jsonl');
const TS_R1 = '2026-08-27T05:30:00Z';
const TS_R2 = '2026-08-27T05:40:00Z';
const TS_FINAL = '2026-08-27T05:50:00Z';

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function decision(proposal, reviewer, reviewedAt) {
  if (proposal?.status !== 'accepted') throw new Error(`${reviewer} did not accept ${proposal?.assertion_id || 'the history assertion'}`);
  return {
    status: 'accepted',
    decision_relation_type: proposal.decision_relation_type,
    decision_relation_subtype: proposal.decision_relation_subtype ?? null,
    decision_direction: proposal.decision_direction,
    decision_evidence_refs: proposal.decision_evidence_refs,
    reviewer,
    decision_note: proposal.decision_note,
    reviewed_at: reviewedAt
  };
}

const [a] = readJsonl(path.join(ROOT, 'editorial', 'reviewer-a-v2-history.jsonl'));
const [b] = readJsonl(path.join(ROOT, 'editorial', 'reviewer-b-v2-history.jsonl'));
if (!a || !b || a.assertion_id !== b.assertion_id) throw new Error('Independent history review files must contain the same single assertion id');
const r1 = decision(a, 'reviewer-a', TS_R1);
const r2 = decision(b, 'reviewer-b', TS_R2);
if (stable({ ...r1, reviewer: null, decision_note: null, reviewed_at: null }) !== stable({ ...r2, reviewer: null, decision_note: null, reviewed_at: null })) {
  throw new Error(`Independent reviewers did not agree exactly on ${a.assertion_id}`);
}

const rows = readJsonl(REVIEW_PATH);
const row = rows.find((item) => item.assertion_id === a.assertion_id);
if (!row) throw new Error(`Canonical review row not found: ${a.assertion_id}`);
const expectedIdentity = {
  subject_person_id: 'nt-people-0125',
  object_person_id: 'nt-people-0165',
  relation_type: 'legal',
  direction: 'directed'
};
for (const [field, expected] of Object.entries(expectedIdentity)) {
  if (row[field] !== expected) {
    throw new Error(`Stale history review id ${a.assertion_id}: ${field}=${row[field]} (expected ${expected}); regenerate independent reviews against the current snapshot`);
  }
}
const evidenceKey = (item) => stable({
  source_id: item.source_id,
  passage: item.passage,
  evidence_level: item.evidence_level,
  note: item.note,
  certainty: item.certainty
});
const snapshotEvidence = (row.evidence_snapshot || []).map(evidenceKey).sort();
const reviewedEvidence = (r2.decision_evidence_refs || []).map(evidenceKey).sort();
if (stable(snapshotEvidence) !== stable(reviewedEvidence)) {
  throw new Error(`Stale or incomplete history evidence review for ${a.assertion_id}; reviewers must cover the current evidence snapshot exactly`);
}
row.round1 = r1;
row.round2 = r2;
row.final_decision = {
  ...r2,
  reviewer: 'editorial-coordinator',
  decision_note: '两位独立审校员一致确认人物端点、司法行为方向、约瑟夫史料定位及 ancient_text 证据层级。',
  reviewed_at: TS_FINAL
};
row.updated_at = TS_FINAL;
fs.writeFileSync(REVIEW_PATH, `${rows.map((item) => JSON.stringify(item)).join('\n')}\n`);
console.log(`Merged independent history review: ${a.assertion_id}`);
