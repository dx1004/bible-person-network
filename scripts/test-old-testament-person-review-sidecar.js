#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function copyTemplate(baseDir) {
  fs.mkdirSync(path.join(baseDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'schemas'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'editorial'), { recursive: true });

  fs.cpSync(path.join(ROOT, 'scripts', 'apply-old-testament-person-review-sidecar.js'), path.join(baseDir, 'scripts', 'apply-old-testament-person-review-sidecar.js'));
  fs.cpSync(path.join(ROOT, 'scripts', 'validate-old-testament-person-review-sidecar.js'), path.join(baseDir, 'scripts', 'validate-old-testament-person-review-sidecar.js'));
  fs.cpSync(path.join(ROOT, 'schemas', 'old-testament-person-review-sidecar.schema.json'), path.join(baseDir, 'schemas', 'old-testament-person-review-sidecar.schema.json'));
  fs.cpSync(path.join(ROOT, 'schemas', 'old-testament-person-review.schema.json'), path.join(baseDir, 'schemas', 'old-testament-person-review.schema.json'));

  const nmSrc = path.join(ROOT, 'node_modules');
  const nmDst = path.join(baseDir, 'node_modules');
  try {
    fs.symlinkSync(nmSrc, nmDst, 'dir');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function runCheck(dir) {
  return execSync('node scripts/validate-old-testament-person-review-sidecar.js', {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function runApply(dir) {
  return execSync('node scripts/apply-old-testament-person-review-sidecar.js', {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function makeCaseBase(dir) {
  const candidateRows = [{
    step_identity_key: 'abraham@gen.11.26',
    source_id: 'source:0002',
    source_file: '.sources/stepbible-data/Proper Nouns/TIPNR - Translators Individualised Proper Names with all References - STEPBible.org CC BY.txt',
    candidate_status: 'pending',
    candidate_decision: 'pending',
    canonical_name: 'אַבְרָהָם',
    latinized: 'Abraham',
    normalized_unified_name: 'Abraham',
    sex: 'male',
    step_unified_raw: 'Abraham@Gen.11.26=H0123',
    names: [],
    ot_refs: ['GEN 11:26'],
    ot_ref_count: 1,
    nt_ref_count: 0,
    created_at: '2026-08-26T00:00:00Z',
    source_snapshot: '2026-08-26T00:00:00Z',
    metadata: { source_norm: 'abraham gen 11 26', has_nt_refs: false },
    candidate_id: 'otc-9001',
  }];
  writeJsonl(path.join(dir, 'editorial', 'old-testament-person-candidates.jsonl'), candidateRows);

  const baseReviewRow = {
    review_id: 'otpr-9001',
    candidate_id: 'otc-9001',
    step_identity_key: 'abraham@gen.11.26',
    candidate_status: 'pending',
    canonical_chinese: '亚伯拉罕',
    review_method: 'multi_agent_ai_review',
    protocol_version: '2.0.0',
    source_id: 'source:0002',
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
    round1: {
      status: 'pending', decision_action: null, target_person_id: null, canonical_chinese: null,
      reviewer: null, decision_note: '', reviewed_at: null, reviewer_role_id: null,
      reviewer_model_id: null, reviewer_prompt_version: null,
    },
    round2: {
      status: 'pending', decision_action: null, target_person_id: null, canonical_chinese: null,
      reviewer: null, decision_note: '', reviewed_at: null, reviewer_role_id: null,
      reviewer_model_id: null, reviewer_prompt_version: null,
    },
    final_decision: {
      status: 'pending', decision_action: null, target_person_id: null, canonical_chinese: null,
      reviewer: null, decision_note: '', reviewed_at: null, reviewer_role_id: null,
      reviewer_model_id: null, reviewer_prompt_version: null,
    },
    evidence_audit: null,
  };
  writeJsonl(path.join(dir, 'editorial', 'old-testament-person-review.jsonl'), [baseReviewRow]);
}

function runCase(dir, label, rows, shouldPass, assertAfter, useApply = false) {
  // remove prior batch files to avoid cross-case interference
  for (const file of fs.readdirSync(path.join(dir, 'editorial'))) {
    if (file.startsWith('old-testament-person-review-batch-')) {
      fs.unlinkSync(path.join(dir, 'editorial', file));
    }
  }
  fs.rmSync(path.join(dir, 'editorial', 'old-testament-person-review-sidecar-merge-report.json'), { force: true });
  writeJsonl(path.join(dir, 'editorial', `old-testament-person-review-batch-${label}.jsonl`), rows);

  try {
    const runner = useApply ? runApply : runCheck;
    runner(dir);
    if (!shouldPass) throw new Error('expected failure but command passed');
    if (typeof assertAfter === 'function') {
      const reviewRows = readJsonl(path.join(dir, 'editorial', 'old-testament-person-review.jsonl'));
      assertAfter(reviewRows);
    }
  } catch (err) {
    const text = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    if (shouldPass) {
      throw new Error(`expected pass but command failed: ${String(err.message || '').slice(0, 180)}\n${text}`);
    }
    return;
  }
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-people-ot-sidecar-'));
  copyTemplate(tmpDir);
  makeCaseBase(tmpDir);

  const t = {
    review_id: 'otpr-9001',
    candidate_id: 'otc-9001',
    decision: {},
    created_at: '2026-08-28T00:00:01Z',
    batch_id: 'batch-0001',
    operator: 'test-operator',
  };

  const round1 = {
    ...t,
    stage: 'round1',
    decision: {
      status: 'accepted',
      decision_action: 'create_new',
      target_person_id: null,
      canonical_chinese: '亚伯拉罕',
      reviewer: 'editorial-reviewer-a',
      decision_note: 'round1 pass',
      reviewed_at: '2026-08-28T00:00:01Z',
      reviewer_role_id: 'editorial_a',
      reviewer_model_id: 'gpt-5.6-sol',
      reviewer_prompt_version: 'editorial-a-v1',
    },
  };
  const round2 = {
    ...t,
    stage: 'round2',
    created_at: '2026-08-28T00:00:02Z',
    decision: {
      status: 'accepted',
      decision_action: 'create_new',
      target_person_id: null,
      canonical_chinese: '亚伯拉罕',
      reviewer: 'critic-reviewer-b',
      decision_note: 'round2 pass',
      reviewed_at: '2026-08-28T00:00:02Z',
      reviewer_role_id: 'critic_b',
      reviewer_model_id: 'gpt-5.5',
      reviewer_prompt_version: 'critic-b-v1',
    },
  };
  const finalPass = {
    ...t,
    stage: 'final_decision',
    created_at: '2026-08-28T00:00:03Z',
    decision: {
      status: 'accepted',
      decision_action: 'create_new',
      target_person_id: null,
      canonical_chinese: '亚伯拉罕',
      reviewer: 'boardroom-reviewer',
      decision_note: 'final pass',
      reviewed_at: '2026-08-28T00:00:03Z',
      reviewer_role_id: 'boardroom_adjudicator',
      reviewer_model_id: 'gpt-5.6-terra',
      reviewer_prompt_version: 'boardroom-v1',
    },
    evidence_audit: {
      status: 'passed',
      reviewer_role_id: 'evidence_auditor',
      reviewer_model_id: 'deterministic-validator',
      prompt_version: 'evidence-auditor-v1',
      checked_at: '2026-08-28T00:00:04Z',
      notes: 'double checked',
      evidence_refs: ['GEN 1:1', 'data/notes.md'],
    },
  };

  // Case A: full pass
  runCase(tmpDir, 'pass', [round1, round2, finalPass], true);

  // Case B: missing evidence audit on final accepted
  runCase(tmpDir, 'no-audit', [round1, round2, { ...finalPass, evidence_audit: null }], false);

  // Case C: round1/round2 mismatch
  runCase(tmpDir, 'mismatch', [
    round1,
    { ...round2, decision: { ...round2.decision, decision_action: 'merge_existing' } },
    finalPass,
  ], false);

  // Case D: rejected with invalid reviewed_at
  runCase(tmpDir, 'bad-reviewed-at', [{
    ...round1,
      stage: 'final_decision',
      decision: {
        ...finalPass.decision,
        status: 'rejected',
        decision_action: null,
        target_person_id: null,
        canonical_chinese: null,
        reviewed_at: 'not-a-date',
        reviewer: 'boardroom-reviewer',
        decision_note: 'reject invalid review date',
    },
  }], false);

  // Case E: repeat run should stay pass
  runCase(tmpDir, 'repeat', [round1, round2, finalPass], true);
  runCase(tmpDir, 'repeat', [round1, round2, finalPass], true);

  // Case F: later row with same review_id/fingerprint key should override earlier one
  const round1WithFingerprint = {
    ...round1,
    created_at: '2026-08-28T00:00:01Z',
    fingerprint: 'stable-fingerprint-v2',
  };
  const round1WithFingerprintNewer = {
    ...round1WithFingerprint,
    created_at: '2026-08-28T00:00:02Z',
    decision: {
      ...round1WithFingerprint.decision,
      decision_note: 'round1 newer',
    },
  };
  runCase(tmpDir, 'same-key-fallback', [round1WithFingerprint, round1WithFingerprintNewer], true, (reviewRows) => {
    if (reviewRows[0].round1.decision_note !== 'round1 newer') {
      throw new Error('expected latest-created_at round1 decision to win when key fields match');
    }
  }, true);

  console.log('all tests passed');
}

main();
