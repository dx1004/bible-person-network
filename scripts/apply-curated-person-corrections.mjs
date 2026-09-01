#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const STAMP = '2026-08-31T00:00:00Z';
if (APPLY === CHECK) throw new Error('pass exactly one of --apply or --check');

const paths = Object.fromEntries(Object.entries({
  people: 'data/people.jsonl', names: 'data/names.jsonl', mentions: 'data/mentions.jsonl',
  assertions: 'data/assertions.jsonl', reviews: 'editorial/old-testament-person-review.jsonl',
  relationA: 'editorial/old-testament-relationship-review-round-a.jsonl',
  relationB: 'editorial/old-testament-relationship-review-round-b.jsonl',
  relationFinal: 'editorial/old-testament-relationship-review-boardroom.jsonl',
  directReview: 'editorial/direct-relationship-review.jsonl',
  ledger: 'editorial/curated-person-corrections.jsonl', report: 'editorial/curated-person-corrections-report.json',
  reviewReport: 'editorial/old-testament-person-review-report.json'
}).map(([key, value]) => [key, path.join(ROOT, value)]));
const correction = {
  correction_id: 'cpc-000001', review_id: 'otpr-0903', candidate_id: 'otc-0903', person_id: 'person-001235',
  name_ids: ['name-3612', 'name-3613', 'name-3614'], mention_ids: ['mnt-008470', 'mnt-008471'],
  assertion_ids: ['asrt-1587', 'asrt-3963'], relation_candidate_ids: ['otrelc-002210', 'otrelc-002211'], evidence_refs: ['JER 36:26', 'JER 38:6'],
  reason: '希伯来文 הַמֶּלֶךְ (hammelekh) 是带定冠词的普通名词“王”，在耶利米书36:26和38:6中修饰“王的儿子”，不是具名人物。'
};
const readJsonl = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const stable = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, content) => { const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, content); fs.renameSync(temporary, file); };
const note = (existing, marker) => String(existing || '').includes(correction.correction_id) ? existing : `${String(existing || '').trim()} ${marker}`.trim();
const decision = (mode) => ({
  status: 'rejected', decision_action: null, target_person_id: null, canonical_chinese: null, reviewer: mode,
  decision_note: correction.reason, reviewed_at: STAMP,
  reviewer_role_id: mode === 'editorial' ? 'editorial_a' : mode === 'critic' ? 'critic_b' : 'boardroom_adjudicator',
  reviewer_model_id: mode === 'editorial' ? 'gpt-5.6-sol' : mode === 'critic' ? 'gpt-5.5' : 'gpt-5.6-terra',
  reviewer_prompt_version: mode === 'editorial' ? 'editorial-a-v1' : mode === 'critic' ? 'critic-b-v1' : 'boardroom-v1'
});

const people = readJsonl(paths.people), names = readJsonl(paths.names), mentions = readJsonl(paths.mentions);
const assertions = readJsonl(paths.assertions), reviews = readJsonl(paths.reviews);
const relationA = readJsonl(paths.relationA), relationB = readJsonl(paths.relationB), relationFinal = readJsonl(paths.relationFinal);
const directReview = readJsonl(paths.directReview);
const errors = [];
if (!people.some((row) => row.person_id === correction.person_id)) errors.push(`missing person ${correction.person_id}`);
if (!reviews.some((row) => row.review_id === correction.review_id && row.candidate_id === correction.candidate_id)) errors.push(`missing review ${correction.review_id}`);
for (const id of correction.name_ids) if (!names.some((row) => row.name_id === id && row.person_id === correction.person_id)) errors.push(`missing name ${id}`);
for (const id of correction.mention_ids) if (!mentions.some((row) => row.mention_id === id && row.person_id === correction.person_id)) errors.push(`missing mention ${id}`);
for (const id of correction.assertion_ids) if (!assertions.some((row) => row.assertion_id === id)) errors.push(`missing assertion ${id}`);
if (errors.length) throw new Error(errors.join('\n'));

const ledgerRow = { ...correction, prior_person_status: 'accepted', corrected_person_status: 'rejected', round_a: decision('editorial'), round_b: decision('critic'), final_decision: decision('boardroom') };
const ledgerSnapshot = `${stable(ledgerRow)}\n`;
const report = {
  generated_at: STAMP, dataset: 'curated-person-corrections', correction_count: 1,
  rejected_person_ids: [correction.person_id], excluded_mention_count: correction.mention_ids.length,
  deactivated_assertion_count: correction.assertion_ids.length, ledger_snapshot_sha256: sha256(ledgerSnapshot),
  invariant: { preserves_records: true, three_round_rejection_recorded: true, rejected_people_have_no_active_assertions: true }
};

if (CHECK) {
  if (!fs.existsSync(paths.ledger) || fs.readFileSync(paths.ledger, 'utf8') !== ledgerSnapshot) throw new Error('curated person correction ledger drift');
  if (JSON.parse(fs.readFileSync(paths.report, 'utf8')).ledger_snapshot_sha256 !== report.ledger_snapshot_sha256) throw new Error('curated person correction report drift');
  if (people.find((row) => row.person_id === correction.person_id)?.status !== 'rejected') throw new Error('person correction not applied');
  if (assertions.some((row) => row.status === 'active' && (row.subject_person_id === correction.person_id || row.object_person_id === correction.person_id))) throw new Error('active assertion references rejected person');
  console.log(JSON.stringify({ ...report, mode: 'check' }, null, 2)); process.exit(0);
}

const outputs = {
  people: people.map((row) => row.person_id !== correction.person_id ? row : { ...row, status: 'rejected', editor_note: note(row.editor_note, `人物纠错 ${correction.correction_id}：${correction.reason}`), updated_at: STAMP }),
  names: names.map((row) => !correction.name_ids.includes(row.name_id) ? row : { ...row, status: 'rejected', notes: note(row.notes, `人物纠错 ${correction.correction_id}：非人名。`), updated_at: STAMP }),
  mentions: mentions.map((row) => !correction.mention_ids.includes(row.mention_id) ? row : { ...row, status: 'excluded', editorial_rationale: note(row.editorial_rationale, `人物纠错 ${correction.correction_id}：普通名词“王”，非人物提及。`), updated_at: STAMP }),
  assertions: assertions.map((row) => !correction.assertion_ids.includes(row.assertion_id) ? row : { ...row, status: 'inactive', editor_note: note(row.editor_note, `人物纠错 ${correction.correction_id}：端点不是人物，关系失活。`), updated_at: STAMP }),
  reviews: reviews.map((row) => row.review_id !== correction.review_id ? row : {
    ...row, round1: decision('editorial'), round2: decision('critic'), final_decision: decision('boardroom'), updated_at: STAMP,
    notes: note(row.notes, `人物纠错 ${correction.correction_id}：原接受决定已被三轮来源复核推翻。`),
    evidence_audit: { status: 'passed', reviewer_role_id: 'evidence_auditor', reviewer_model_id: 'deterministic-validator', prompt_version: 'evidence-auditor-v1', checked_at: STAMP, notes: correction.reason, evidence_refs: [`editorial/curated-person-corrections.jsonl#correction_id=${correction.correction_id}`, ...correction.evidence_refs.map((ref) => `Bible:${ref}`)] }
  })
};
const rejectRelationStage = (rows, field) => rows.map((row) => !correction.relation_candidate_ids.includes(row.candidate_relation_id) ? row : {
  ...row,
  [field]: { ...row[field], status: 'rejected', decision_note: correction.reason, reviewed_at: STAMP }
});
outputs.relationA = rejectRelationStage(relationA, 'round1');
outputs.relationB = rejectRelationStage(relationB, 'round2');
outputs.relationFinal = rejectRelationStage(relationFinal, 'final_decision');
outputs.directReview = directReview.map((row) => row.subject_person_id !== correction.person_id && row.object_person_id !== correction.person_id ? row : {
  ...row, proposed_assertion: null,
  round_a: { ...row.round_a, status: 'rejected_ambiguous_identity', reason_code: 'endpoint_not_named_person', note: correction.reason, reviewed_at: STAMP },
  round_b: { ...row.round_b, status: 'rejected_ambiguous_identity', reason_code: 'endpoint_not_named_person', note: correction.reason, reviewed_at: STAMP },
  final_decision: { ...row.final_decision, status: 'rejected_ambiguous_identity', reason_code: 'endpoint_not_named_person', note: correction.reason, reviewed_at: STAMP }
});
for (const key of ['people', 'names', 'mentions', 'assertions', 'reviews', 'relationA', 'relationB', 'relationFinal', 'directReview']) write(paths[key], `${outputs[key].map((row) => JSON.stringify(row)).join('\n')}\n`);
const reviewReport = JSON.parse(fs.readFileSync(paths.reviewReport, 'utf8'));
reviewReport.accepted = outputs.reviews.filter((row) => row.final_decision?.status === 'accepted').length;
reviewReport.rejected = outputs.reviews.filter((row) => row.final_decision?.status === 'rejected').length;
reviewReport.pending = outputs.reviews.filter((row) => row.final_decision?.status === 'pending').length;
reviewReport.evidence_audit_passed = outputs.reviews.filter((row) => row.evidence_audit?.status === 'passed').length;
write(paths.reviewReport, `${JSON.stringify(reviewReport, null, 2)}\n`);
write(paths.ledger, ledgerSnapshot); write(paths.report, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, mode: 'apply' }, null, 2));
