#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function assertionSnapshotKey(snapshot) {
  return stable({
    subject_person_id: snapshot.subject_person_id,
    object_person_id: snapshot.object_person_id,
    relation_type: snapshot.relation_type,
    relation_subtype: snapshot.relation_subtype ?? null,
    direction: snapshot.direction,
    evidence: snapshot.evidence
  });
}

function migrateChinese(oldPath) {
  const currentPath = path.join(ROOT, 'editorial/chinese-name-review.jsonl');
  const candidates = readJsonl(path.join(ROOT, 'editorial/chinese-name-candidates.jsonl'));
  const candidatesByPersonAndText = new Map(candidates.map((candidate) => [
    `${candidate.person_id}|${candidate.candidate_chinese}`,
    candidate
  ]));
  const oldByPerson = new Map(readJsonl(oldPath).map((row) => [row.person_id, row]));
  let migrated = 0;
  let pending = 0;
  const rows = readJsonl(currentPath).map((row) => {
    const old = oldByPerson.get(row.person_id);
    if (!old || old.final_decision.status !== 'accepted') {
      pending += 1;
      return row;
    }
    const candidate = candidatesByPersonAndText.get(`${row.person_id}|${old.final_decision.final_chinese}`);
    if (!candidate) {
      pending += 1;
      return row;
    }
    const remap = (decision) => ({ ...decision, selected_candidate_id: candidate.candidate_id });
    if (!row.top_candidate_refs.some((ref) => ref.candidate_id === candidate.candidate_id)) {
      row.top_candidate_refs.push({
        candidate_id: candidate.candidate_id,
        candidate_chinese: candidate.candidate_chinese,
        candidate_rank: candidate.candidate_rank,
        score: candidate.score,
        supporting_passages: candidate.supporting_passages,
        support_count: candidate.support_count,
        mention_count: candidate.mention_count,
        coverage: candidate.coverage,
        precision: candidate.precision,
        score_margin_to_next: candidate.score_margin_to_next
      });
    }
    row.round1 = remap(old.round1);
    row.round2 = remap(old.round2);
    row.final_decision = { ...old.final_decision, selected_candidate_id: candidate.candidate_id };
    row.updated_at = old.updated_at;
    migrated += 1;
    return row;
  });
  writeJsonl(currentPath, rows);
  return { migrated, pending };
}

function pendingRelationDecision() {
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

function migrateRelations(oldPath) {
  const currentPath = path.join(ROOT, 'editorial/relationship-review.jsonl');
  const oldBySnapshot = new Map(readJsonl(oldPath).map((row) => [assertionSnapshotKey(row.assertion_snapshot), row]));
  let migrated = 0;
  let pending = 0;
  const rows = readJsonl(currentPath).map((row) => {
    const old = oldBySnapshot.get(assertionSnapshotKey(row.assertion_snapshot));
    if (!old || old.final_decision.status === 'pending') {
      row.round1 = pendingRelationDecision();
      row.round2 = pendingRelationDecision();
      row.final_decision = pendingRelationDecision();
      pending += 1;
      return row;
    }
    row.round1 = old.round1;
    row.round2 = old.round2;
    row.final_decision = old.final_decision;
    row.updated_at = old.updated_at;
    migrated += 1;
    return row;
  });
  writeJsonl(currentPath, rows);
  return { migrated, pending };
}

if (!args['old-chinese'] || !args['old-relations']) {
  throw new Error('Usage: node scripts/migrate-editorial-reviews.js --old-chinese=/path/file --old-relations=/path/file');
}

const chinese = migrateChinese(path.resolve(args['old-chinese']));
const relations = migrateRelations(path.resolve(args['old-relations']));
console.log(JSON.stringify({ chinese, relations }, null, 2));
