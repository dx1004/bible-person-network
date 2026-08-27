#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TS_R1 = '2026-08-26T10:00:00Z';
const TS_R2 = '2026-08-26T11:00:00Z';
const TS_FINAL = '2026-08-26T12:00:00Z';

function readJsonl(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
  });
}

function writeJsonl(file, rows) {
  fs.writeFileSync(path.join(ROOT, file), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function indexUnique(rows, key, file, expected) {
  const result = new Map();
  for (const row of rows) {
    if (!row[key] || result.has(row[key])) throw new Error(`${file}: missing or duplicate ${key}: ${row[key]}`);
    result.set(row[key], row);
  }
  if (expected !== undefined && result.size !== expected) throw new Error(`${file}: expected ${expected} rows, got ${result.size}`);
  return result;
}

function chineseDecision(proposal, reviewer, reviewedAt) {
  if (!proposal || !['accepted', 'pending', 'rejected'].includes(proposal.status)) throw new Error(`invalid Chinese proposal for ${proposal?.person_id}`);
  if (proposal.status === 'pending') {
    return { status: 'pending', selected_candidate_id: null, proposed_chinese: null, reviewer: null, decision_note: '', reviewed_at: null };
  }
  if (proposal.status === 'rejected') {
    return { status: 'rejected', selected_candidate_id: null, proposed_chinese: null, reviewer, decision_note: proposal.decision_note, reviewed_at: reviewedAt };
  }
  if (!proposal.selected_candidate_id || !proposal.proposed_chinese || !proposal.decision_note) throw new Error(`incomplete accepted Chinese proposal: ${proposal.person_id}`);
  return {
    status: 'accepted',
    selected_candidate_id: proposal.selected_candidate_id,
    proposed_chinese: proposal.proposed_chinese,
    reviewer,
    decision_note: proposal.decision_note,
    reviewed_at: reviewedAt
  };
}

function relationDecision(proposal, reviewer, reviewedAt) {
  if (!proposal || !['accepted', 'pending', 'rejected'].includes(proposal.status)) throw new Error(`invalid relation proposal for ${proposal?.assertion_id}`);
  const empty = {
    decision_relation_type: null,
    decision_relation_subtype: null,
    decision_direction: null,
    decision_evidence_refs: []
  };
  if (proposal.status === 'pending') {
    return { status: 'pending', ...empty, reviewer: null, decision_note: '', reviewed_at: null };
  }
  if (proposal.status === 'rejected') {
    return { status: 'rejected', ...empty, reviewer, decision_note: proposal.decision_note, reviewed_at: reviewedAt };
  }
  if (!proposal.decision_relation_type || !proposal.decision_direction || !proposal.decision_note || !proposal.decision_evidence_refs?.length) {
    throw new Error(`incomplete accepted relation proposal: ${proposal.assertion_id}`);
  }
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

function evidenceSignature(refs) {
  return [...refs].map((ref) => JSON.stringify(ref)).sort().join('|');
}

function relationAgreement(a, b) {
  return a.status === 'accepted' && b.status === 'accepted'
    && a.decision_relation_type === b.decision_relation_type
    && (a.decision_relation_subtype ?? null) === (b.decision_relation_subtype ?? null)
    && a.decision_direction === b.decision_direction
    && evidenceSignature(a.decision_evidence_refs) === evidenceSignature(b.decision_evidence_refs);
}

function candidateRef(candidate) {
  const keys = ['candidate_id', 'candidate_chinese', 'candidate_rank', 'score', 'supporting_passages', 'support_count', 'mention_count', 'coverage', 'precision', 'score_margin_to_next'];
  return Object.fromEntries(keys.map((key) => [key, candidate[key]]));
}

function mergeChinese() {
  const canonical = readJsonl('editorial/chinese-name-review.jsonl');
  const candidates = indexUnique(readJsonl('editorial/chinese-name-candidates.jsonl'), 'candidate_id', 'chinese-name-candidates');
  const a = indexUnique(readJsonl('editorial/reviewer-a-chinese.jsonl'), 'person_id', 'reviewer-a-chinese', canonical.length);
  const b = indexUnique(readJsonl('editorial/reviewer-b-chinese.jsonl'), 'person_id', 'reviewer-b-chinese', canonical.length);
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  for (const row of canonical) {
    const pa = a.get(row.person_id);
    const pb = b.get(row.person_id);
    const r1 = chineseDecision(pa, 'reviewer-a', TS_R1);
    const r2 = chineseDecision(pb, 'reviewer-b', TS_R2);
    row.round1 = r1;
    row.round2 = r2;
    for (const decision of [r1, r2]) {
      if (decision.status !== 'accepted') continue;
      const candidate = candidates.get(decision.selected_candidate_id);
      if (!candidate || candidate.person_id !== row.person_id || candidate.candidate_chinese !== decision.proposed_chinese) {
        throw new Error(`reviewer selected invalid Chinese candidate for ${row.person_id}`);
      }
      if (!row.top_candidate_refs.some((ref) => ref.candidate_id === candidate.candidate_id)) row.top_candidate_refs.push(candidateRef(candidate));
    }
    if (r1.status === 'accepted' && r2.status === 'accepted'
      && r1.selected_candidate_id === r2.selected_candidate_id && r1.proposed_chinese === r2.proposed_chinese) {
      row.final_decision = {
        status: 'accepted', selected_candidate_id: r2.selected_candidate_id, final_chinese: r2.proposed_chinese,
        reviewer: 'editorial-coordinator', decision_note: '两位独立审校员一致接受同一和合本候选名。', reviewed_at: TS_FINAL
      };
      accepted += 1;
    } else if (r1.status === 'rejected' && r2.status === 'rejected') {
      row.final_decision = {
        status: 'rejected', selected_candidate_id: null, final_chinese: null,
        reviewer: 'editorial-coordinator', decision_note: '两位独立审校员均拒绝现有候选。', reviewed_at: TS_FINAL
      };
      rejected += 1;
    } else {
      row.final_decision = { status: 'pending', selected_candidate_id: null, final_chinese: null, reviewer: null, decision_note: '', reviewed_at: null };
      pending += 1;
    }
    row.updated_at = TS_FINAL;
  }
  writeJsonl('editorial/chinese-name-review.jsonl', canonical);
  return { accepted, pending, rejected };
}

function mergeRelations() {
  const canonical = readJsonl('editorial/relationship-review.jsonl');
  const b = indexUnique(readJsonl('editorial/reviewer-b-relations.jsonl'), 'assertion_id', 'reviewer-b-relations', canonical.length);
  const a = indexUnique(readJsonl('editorial/reviewer-a-relations.jsonl'), 'assertion_id', 'reviewer-a-relations', canonical.length);
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  for (const row of canonical) {
    const r1 = relationDecision(b.get(row.assertion_id), 'reviewer-b', TS_R1);
    const r2 = relationDecision(a.get(row.assertion_id), 'reviewer-a', TS_R2);
    row.round1 = r1;
    row.round2 = r2;
    if (relationAgreement(r1, r2)) {
      row.final_decision = {
        ...r2,
        reviewer: 'editorial-coordinator',
        decision_note: '两位独立审校员对关系类型、方向与证据引用达成一致。',
        reviewed_at: TS_FINAL
      };
      accepted += 1;
    } else if (r1.status === 'rejected' && r2.status === 'rejected') {
      row.final_decision = {
        status: 'rejected', decision_relation_type: null, decision_relation_subtype: null, decision_direction: null,
        decision_evidence_refs: [], reviewer: 'editorial-coordinator', decision_note: '两位独立审校员均判定现有主张证据不足或端点错误。', reviewed_at: TS_FINAL
      };
      rejected += 1;
    } else {
      row.final_decision = {
        status: 'pending', decision_relation_type: null, decision_relation_subtype: null, decision_direction: null,
        decision_evidence_refs: [], reviewer: null, decision_note: '', reviewed_at: null
      };
      pending += 1;
    }
    row.updated_at = TS_FINAL;
  }
  writeJsonl('editorial/relationship-review.jsonl', canonical);
  return { accepted, pending, rejected };
}

const chinese = mergeChinese();
const relations = mergeRelations();
console.log(JSON.stringify({ chinese, relations }, null, 2));
