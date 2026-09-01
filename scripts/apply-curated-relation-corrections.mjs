#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSERTIONS_PATH = path.join(ROOT, 'data', 'assertions.jsonl');
const LEDGER_PATH = path.join(ROOT, 'editorial', 'curated-relation-corrections.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'curated-relation-corrections-report.json');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const STAMP = '2026-08-31T00:00:00Z';

if (APPLY === CHECK) throw new Error('pass exactly one of --apply or --check');

const CORRECTIONS = [{
  correction_id: 'crc-000001',
  assertion_id: 'asrt-0377',
  subject_person_id: 'person-000010',
  object_person_id: 'person-000106',
  rejected_relation_type: 'kinship',
  rejected_relation_subtype: 'sibling',
  replacement_assertion_id: 'asrt-0022',
  evidence_refs: ['GEN 2:18-24', 'GEN 3:20', 'GEN 4:1'],
  reason: '亚当与夏娃在已锁定经文定位中是配偶／一体关系，不是手足；STEP sibling token 与经文语义冲突。较早的 asrt-0021 已经由两轮审校拒绝同一错误，后续导入的 asrt-0377 属重复回归。',
}, {
  correction_id: 'crc-000002',
  assertion_id: 'asrt-10727',
  subject_person_id: 'person-002062',
  object_person_id: 'person-002447',
  rejected_relation_type: 'kinship',
  rejected_relation_subtype: 'child',
  replacement_assertion_id: null,
  evidence_refs: ['NEH 11:11'],
  reason: 'NEH 11:11的谱系为米拉约→撒督→米书兰→希勒家→西莱雅；asrt-10727把远代祖先关系误写成米拉约→西莱雅的直接 child 边，方向与子类型均不成立。该边停用，真实远代谱系仅作为多跳路径保留。',
}];

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}

function reviewDecision(mode, reason) {
  return { status: 'rejected', reviewer_mode: mode, reason, reviewed_at: STAMP };
}

const assertions = readJsonl(ASSERTIONS_PATH);
const assertionById = new Map(assertions.map((row) => [row.assertion_id, row]));
const errors = [];
const ledger = [];

for (const correction of CORRECTIONS) {
  const target = assertionById.get(correction.assertion_id);
  const replacement = correction.replacement_assertion_id
    ? assertionById.get(correction.replacement_assertion_id)
    : null;
  if (!target) { errors.push(`missing target ${correction.assertion_id}`); continue; }
  if (correction.replacement_assertion_id && !replacement) {
    errors.push(`missing replacement ${correction.replacement_assertion_id}`);
    continue;
  }
  if (target.subject_person_id !== correction.subject_person_id
    || target.object_person_id !== correction.object_person_id
    || target.relation_type !== correction.rejected_relation_type
    || target.relation_subtype !== correction.rejected_relation_subtype) {
    errors.push(`target shape drift ${correction.assertion_id}`);
  }
  if (replacement && (replacement.subject_person_id !== correction.subject_person_id
    || replacement.object_person_id !== correction.object_person_id
    || replacement.status !== 'active'
    || replacement.relation_type !== 'kinship'
    || !['partner', 'spouse'].includes(replacement.relation_subtype))) {
    errors.push(`replacement shape drift ${correction.replacement_assertion_id}`);
  }
  ledger.push({
    ...correction,
    prior_status: target.status,
    corrected_status: 'inactive',
    round_a: reviewDecision('editorial', correction.reason),
    round_b: reviewDecision('critic', correction.reason),
    final_decision: reviewDecision('boardroom', correction.reason),
  });
}

if (errors.length) throw new Error(errors.join('\n'));

const correctedAssertions = assertions.map((row) => {
  const correction = CORRECTIONS.find((item) => item.assertion_id === row.assertion_id);
  if (!correction) return row;
  const marker = `关系语义纠错 ${correction.correction_id}：${correction.reason}`;
  return {
    ...row,
    status: 'inactive',
    editorial_status: 'conservative',
    editor_note: String(row.editor_note || '').includes(correction.correction_id)
      ? row.editor_note
      : `${String(row.editor_note || '').trim()} ${marker}`.trim(),
    updated_at: STAMP,
  };
});

const normalizedLedger = ledger.map((row) => ({ ...row, prior_status: 'active' }));
const ledgerSnapshot = normalizedLedger.map((row) => `${stableStringify(row)}\n`).join('');
const report = {
  generated_at: STAMP,
  dataset: 'curated-relation-corrections',
  correction_count: normalizedLedger.length,
  corrected_assertion_ids: normalizedLedger.map((row) => row.assertion_id),
  ledger_snapshot_sha256: sha256(ledgerSnapshot),
  invariant: {
    preserves_original_assertion_record: true,
    deactivates_rejected_relation: true,
    requires_active_replacement_relation: false,
    three_round_rejection_recorded: true,
  },
};

if (CHECK) {
  if (!fs.existsSync(LEDGER_PATH) || fs.readFileSync(LEDGER_PATH, 'utf8') !== ledgerSnapshot) {
    throw new Error('curated relation correction ledger drift');
  }
  const savedReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (savedReport.ledger_snapshot_sha256 !== report.ledger_snapshot_sha256) {
    throw new Error('curated relation correction report drift');
  }
  for (const correction of CORRECTIONS) {
    if (assertionById.get(correction.assertion_id)?.status !== 'inactive') {
      throw new Error(`correction not applied ${correction.assertion_id}`);
    }
  }
  console.log(JSON.stringify({ ...report, mode: 'check' }, null, 2));
  process.exit(0);
}

atomicWrite(ASSERTIONS_PATH, `${correctedAssertions.map((row) => JSON.stringify(row)).join('\n')}\n`);
atomicWrite(LEDGER_PATH, ledgerSnapshot);
atomicWrite(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, mode: 'apply' }, null, 2));
