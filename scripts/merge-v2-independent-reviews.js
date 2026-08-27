#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS_R1 = '2026-08-27T05:00:00Z';
const TS_R2 = '2026-08-27T05:10:00Z';
const TS_FINAL = '2026-08-27T05:20:00Z';

function readJsonl(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${relativePath}:${index + 1}: ${error.message}`); }
  });
}

function writeJsonl(relativePath, rows) {
  fs.writeFileSync(path.join(ROOT, relativePath), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function uniqueMap(rows, key, label) {
  const map = new Map();
  for (const row of rows) {
    if (!row[key] || map.has(row[key])) throw new Error(`${label}: missing or duplicate ${key}: ${row[key]}`);
    map.set(row[key], row);
  }
  return map;
}

function chineseDecision(proposal, reviewer, reviewedAt) {
  if (!proposal || proposal.status !== 'accepted') throw new Error(`v2 Chinese decision must be accepted: ${proposal?.person_id}`);
  return {
    status: 'accepted', selected_candidate_id: proposal.selected_candidate_id,
    proposed_chinese: proposal.proposed_chinese, reviewer,
    decision_note: proposal.decision_note, reviewed_at: reviewedAt
  };
}

function relationDecision(proposal, reviewer, reviewedAt) {
  if (!proposal || !['accepted', 'rejected'].includes(proposal.status)) throw new Error(`invalid v2 relation decision: ${proposal?.assertion_id}`);
  if (proposal.status === 'rejected') {
    return {
      status: 'rejected', decision_relation_type: null, decision_relation_subtype: null,
      decision_direction: null, decision_evidence_refs: [], reviewer,
      decision_note: proposal.decision_note, reviewed_at: reviewedAt
    };
  }
  return {
    status: proposal.status,
    decision_relation_type: proposal.decision_relation_type,
    decision_relation_subtype: proposal.decision_relation_subtype ?? null,
    decision_direction: proposal.decision_direction,
    decision_evidence_refs: proposal.decision_evidence_refs,
    reviewer,
    decision_note: proposal.decision_note,
    reviewed_at: reviewedAt
  };
}

function evidenceSignature(refs) {
  return [...refs].map((ref) => JSON.stringify(ref)).sort().join('|');
}

function relationAgreement(a, b) {
  return a.status === b.status && (a.status === 'rejected' || (
    a.decision_relation_type === b.decision_relation_type
    && a.decision_relation_subtype === b.decision_relation_subtype
    && a.decision_direction === b.decision_direction
    && evidenceSignature(a.decision_evidence_refs) === evidenceSignature(b.decision_evidence_refs)
  ));
}

function rejectedFinal(note) {
  return {
    status: 'rejected', decision_relation_type: null, decision_relation_subtype: null,
    decision_direction: null, decision_evidence_refs: [], reviewer: 'editorial-coordinator',
    decision_note: note, reviewed_at: TS_FINAL
  };
}

function mergeChinese() {
  const canonical = readJsonl('editorial/chinese-name-review.jsonl');
  const a = uniqueMap(readJsonl('editorial/reviewer-a-v2-chinese.jsonl'), 'person_id', 'reviewer-a-v2-chinese');
  const b = uniqueMap(readJsonl('editorial/reviewer-b-v2-chinese.jsonl'), 'person_id', 'reviewer-b-v2-chinese');
  const targets = canonical.filter((row) => a.has(row.person_id) && b.has(row.person_id));
  if (a.size !== targets.length || b.size !== targets.length) throw new Error('v2 Chinese files contain keys outside the canonical review file');
  for (const row of targets) {
    const r1 = chineseDecision(a.get(row.person_id), 'reviewer-a', TS_R1);
    const r2 = chineseDecision(b.get(row.person_id), 'reviewer-b', TS_R2);
    if (r1.selected_candidate_id !== r2.selected_candidate_id || r1.proposed_chinese !== r2.proposed_chinese) {
      throw new Error(`unresolved Chinese disagreement: ${row.person_id}`);
    }
    row.round1 = r1;
    row.round2 = r2;
    row.final_decision = {
      status: 'accepted', selected_candidate_id: r2.selected_candidate_id, final_chinese: r2.proposed_chinese,
      reviewer: 'editorial-coordinator', decision_note: '两位独立审校员一致接受同一和合本候选名。', reviewed_at: TS_FINAL
    };
    row.updated_at = TS_FINAL;
  }
  writeJsonl('editorial/chinese-name-review.jsonl', canonical);
  return targets.length;
}

function mergeRelations() {
  const canonical = readJsonl('editorial/relationship-review.jsonl');
  const a = uniqueMap(readJsonl('editorial/reviewer-a-v2-relations.jsonl'), 'assertion_id', 'reviewer-a-v2-relations');
  const b = uniqueMap(readJsonl('editorial/reviewer-b-v2-relations.jsonl'), 'assertion_id', 'reviewer-b-v2-relations');
  const targets = canonical.filter((row) => a.has(row.assertion_id) && b.has(row.assertion_id));
  if (a.size !== targets.length || b.size !== targets.length) throw new Error('v2 relation files contain keys outside the canonical review file');
  let accepted = 0;
  let rejectedByAgreement = 0;
  let rejectedByDisagreement = 0;
  for (const row of targets) {
    const r1 = relationDecision(a.get(row.assertion_id), 'reviewer-a', TS_R1);
    const r2 = relationDecision(b.get(row.assertion_id), 'reviewer-b', TS_R2);
    row.round1 = r1;
    row.round2 = r2;
    if (relationAgreement(r1, r2) && r1.status === 'accepted') {
      row.final_decision = {
        ...r2, reviewer: 'editorial-coordinator',
        decision_note: '两位独立审校员对精确端点、关系类型、方向与证据引用达成一致。', reviewed_at: TS_FINAL
      };
      accepted += 1;
    } else if (relationAgreement(r1, r2)) {
      row.final_decision = rejectedFinal('两位独立审校员均判定现有主张证据不足或精确端点错误。');
      rejectedByAgreement += 1;
    } else {
      row.final_decision = rejectedFinal(`双审分歧，按 v1 保守门槛不纳入关系网。审校A：${r1.decision_note} 审校B：${r2.decision_note}`);
      rejectedByDisagreement += 1;
    }
    row.updated_at = TS_FINAL;
  }
  writeJsonl('editorial/relationship-review.jsonl', canonical);
  return { total: targets.length, accepted, rejectedByAgreement, rejectedByDisagreement };
}

const chinese = mergeChinese();
const relations = mergeRelations();
console.log(JSON.stringify({ chinese, relations }, null, 2));
