#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJsonl = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8').trim().split('\n').filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); }
  catch { throw new Error(`${relativePath}:${index + 1}: invalid JSON`); }
});

const candidates = readJsonl('editorial/old-testament-person-candidates.jsonl');
const candidateIds = new Set(candidates.map((row) => row.candidate_id));
const audit = readJsonl('editorial/lexham-headword-locator-audit.jsonl');
const direct = audit.filter((row) => row.locator_status === 'direct_hit');
const expected = new Map();
for (const row of direct) for (const candidateId of row.candidate_ids) expected.set(candidateId, row);

const configs = [
  ['round1', 'editorial/lexham-systematic-review-round-a.jsonl'],
  ['round2', 'editorial/lexham-systematic-review-round-b.jsonl'],
  ['final_decision', 'editorial/lexham-systematic-review-boardroom.jsonl']
];
const errors = [];
const stages = {};
for (const [stage, file] of configs) {
  const rows = readJsonl(file);
  stages[stage] = rows;
  const seen = new Set();
  for (const row of rows) {
    if (row.source_id !== 'source:0008' || row.stage !== stage) errors.push(`${stage}:${row.candidate_id}: wrong source or stage`);
    if (!expected.has(row.candidate_id)) errors.push(`${stage}:${row.candidate_id}: not covered by a direct-hit locator`);
    if (seen.has(row.candidate_id)) errors.push(`${stage}:${row.candidate_id}: duplicate`);
    seen.add(row.candidate_id);
    const locator = expected.get(row.candidate_id);
    if (locator) {
      if (row.latinized !== locator.latinized) errors.push(`${stage}:${row.candidate_id}: latinized name drift`);
      const rowLocator = stage === 'final_decision' ? row.locators?.[0]?.locator : row.locator;
      const rowTitle = stage === 'final_decision' ? row.locators?.[0]?.article_title : row.article_title;
      if (rowLocator !== locator.locator || rowTitle !== locator.article_title) errors.push(`${stage}:${row.candidate_id}: locator snapshot drift`);
    }
    if (!['accepted', 'rejected', 'pending'].includes(row.identity_match?.status)) errors.push(`${stage}:${row.candidate_id}: invalid identity status`);
    if (!Array.isArray(row.relationship_evidence)) errors.push(`${stage}:${row.candidate_id}: relationship_evidence must be an array`);
    if (row.evidence_audit?.source_text_stored !== false || row.evidence_audit?.basis !== 'headword_only') errors.push(`${stage}:${row.candidate_id}: copyrighted-text boundary missing`);
    if (stage === 'final_decision' && row.evidence_audit?.status !== 'passed') errors.push(`${stage}:${row.candidate_id}: evidence audit not passed`);
    if (stage === 'final_decision') for (const relation of row.relationship_evidence ?? []) {
      if (!candidateIds.has(relation.subject_candidate_id) || !candidateIds.has(relation.object_candidate_id)) errors.push(`${stage}:${row.candidate_id}: invalid relation endpoint`);
      if (relation.direction !== 'directed') errors.push(`${stage}:${row.candidate_id}: relation must be directed`);
      if (relation.relation_type !== 'kinship' || relation.basis !== 'article_title') errors.push(`${stage}:${row.candidate_id}: relation exceeds headword-only scope`);
    }
  }
  if (seen.size !== expected.size) errors.push(`${stage}: coverage ${seen.size}/${expected.size}`);
  for (const candidateId of expected.keys()) if (!seen.has(candidateId)) errors.push(`${stage}: missing ${candidateId}`);
}

const finalCounts = { accepted: 0, rejected: 0, pending: 0 };
let relationshipEvidence = 0;
for (const row of stages.final_decision) {
  finalCounts[row.identity_match.status] += 1;
  relationshipEvidence += row.relationship_evidence.length;
  const reviewed = row.evidence_audit?.reviewed_inputs ?? [];
  if (!reviewed.some((item) => item.stage === 'round1') || !reviewed.some((item) => item.stage === 'round2')) errors.push(`final_decision:${row.candidate_id}: missing independent-round provenance`);
}
if (errors.length) throw new Error(`Lexham systematic review failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);

console.log(JSON.stringify({
  status: 'completed',
  source_id: 'source:0008',
  coverage: { headwords: direct.length, candidates: expected.size, round1: stages.round1.length, round2: stages.round2.length, final: stages.final_decision.length },
  final_counts: finalCounts,
  retained_relationship_evidence: relationshipEvidence,
  source_text_stored: false
}, null, 2));
