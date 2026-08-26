#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DATA_DIR = path.join(ROOT, 'data');
const RECON_DIR = path.join(ROOT, 'reconciliation');
const STEP_FILE = path.join(DATA_DIR, 'stepbible.persons.json');
const SBL_FILE = path.join(DATA_DIR, 'sblgnt.persons.json');
const OUT_FILE = path.join(RECON_DIR, 'step_sbl_diff.json');
const RECON_REPORT_FILE = path.join(DATA_DIR, 'reconciliation.json');

function readList(file) {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw
    .map((item) => {
      if (typeof item === 'string') return String(item || '').trim();
      if (item && typeof item === 'object') {
        return String(item.person || item.canonical_name || item.name || item.unified_name || item.prioritized_name || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalise(name) {
  return String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function readReconciliationMeta() {
  if (!fs.existsSync(RECON_REPORT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(RECON_REPORT_FILE, 'utf8'));
  } catch (err) {
    return null;
  }
}

function countOrValue(value) {
  if (Array.isArray(value)) return value.length;
  return Number.isInteger(value) ? value : null;
}

function main() {
  const stepNames = readList(STEP_FILE);
  const sblNames = readList(SBL_FILE);
  const recon = readReconciliationMeta();
  const sblImplemented = Array.isArray(sblNames) && sblNames.length > 0;
  const sblCoverage = recon
    ? {
        sbl_book_count: recon.completeness?.sbl_book_count ?? recon.sblCoverage?.sbl_book_count ?? null,
        total_nt_refs_in_step:
          recon.completeness?.total_nt_refs_in_step ?? recon.sblCoverage?.total_nt_refs_in_step ?? null,
        sbl_verified_refs:
          countOrValue(recon.sbl_verified_refs) ?? countOrValue(recon.sblCoverage?.sbl_verified_refs),
        sbl_missing_refs:
          countOrValue(recon.sbl_missing_refs) ?? countOrValue(recon.sblCoverage?.sbl_missing_refs),
      }
    : null;

  const stepVsSbl = sblImplemented
    ? {
        status: 'implemented',
        note: 'SBL proper-name list available.',
        stepCount: stepNames.length,
        sblCount: sblNames.length
      }
    : {
        status: 'not_implemented',
        note: 'direct SBL proper-name extraction not implemented yet.',
        stepCount: stepNames.length,
        sblCount: 0
      };

  const sblPersonScanMethod = recon?.sbl_person_scan?.method || null;
  if (sblPersonScanMethod === 'step_lexicon_sbl_token_scan') {
    stepVsSbl.status = 'implemented_limited';
    stepVsSbl.note = 'SBL 人名比较基于 STEP希腊词形与SBL经文位点的保守词形匹配，不是完整NER。';
  }
  const stepSet = new Set(stepNames.map(normalise));
  const sblSet = new Set(sblNames.map(normalise));
  const onlyInStep = [];
  const onlyInSbl = [];
  if (sblImplemented) {
    for (const n of stepNames) {
      const norm = normalise(n);
      if (!sblSet.has(norm)) onlyInStep.push(n);
    }
    for (const n of sblNames) {
      const norm = normalise(n);
      if (!stepSet.has(norm)) onlyInSbl.push(n);
    }
  }
  const comparison = sblImplemented
    ? {
        onlyInStepCount: onlyInStep.length,
        onlyInSblCount: onlyInSbl.length,
        onlyInStep,
        onlyInSbl
      }
    : {
        onlyInStepCount: 0,
        onlyInSblCount: 0,
        onlyInStep: [],
        onlyInSbl: []
      };

  const out = {
    generatedAt: new Date().toISOString(),
    stepCount: stepNames.length,
    sblCount: sblNames.length,
    sblNameExtraction: stepVsSbl,
    sblCoverage,
    ...(recon?.sbl_person_scan ? { sbl_person_scan: recon.sbl_person_scan } : {}),
    ...comparison
  };

  fs.mkdirSync(RECON_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  fs.writeFileSync(RECON_REPORT_FILE, JSON.stringify(out, null, 2));
  console.log('reconcile done');
  if (sblImplemented) {
    console.log(`onlyInStep: ${onlyInStep.length}, onlyInSbl: ${onlyInSbl.length}`);
  } else {
    console.log('sblNameExtraction: not_implemented (comparison skipped)');
  }
  if (sblCoverage) {
    console.log(`sbl verse coverage: verified=${sblCoverage.sbl_verified_refs}, pending=${sblCoverage.sbl_missing_refs}`);
  }
}

main();
