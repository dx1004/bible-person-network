#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL = path.join(ROOT, 'editorial');
const REPORT = path.join(EDITORIAL, 'historical-source-systematic-review-report.json');
const writeReport = process.argv.includes('--write');
const readJsonl = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); } catch { throw new Error(`${path.basename(file)}:${index + 1} invalid JSON`); }
});
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hits = readJsonl(path.join(EDITORIAL, 'historical-source-person-hits.jsonl'));
const existingReport = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : null;
const sourceHash = (sourceId, sourcePath) => {
  const fullPath = path.join(ROOT, sourcePath);
  if (fs.existsSync(fullPath)) return sha256(fullPath);
  const recorded = existingReport?.sources?.[sourceId]?.source_files
    ?.find((row) => row.source_path === sourcePath)?.sha256;
  if (!/^[a-f0-9]{64}$/.test(String(recorded || ''))) {
    throw new Error(`missing source file and locked checksum: ${sourcePath}`);
  }
  return recorded;
};
const configs = {
  'source:0006': {
    label: 'josephus',
    round1: ['historical-source-systematic-review-josephus-a-0001.jsonl','historical-source-systematic-review-josephus-a-0002.jsonl'],
    round2: ['historical-source-systematic-review-josephus-b-0001.jsonl','historical-source-systematic-review-josephus-b-0002.jsonl'],
    final: 'historical-source-systematic-review-josephus-boardroom.jsonl',
    paths: new Map([['.sources/josephus-whiston-gutenberg/pg2848.txt',48982]])
  },
  'source:0007': {
    label: 'philo',
    round1: ['historical-source-systematic-review-philo-a-0001.jsonl'],
    round2: ['historical-source-systematic-review-philo-b-0001.jsonl'],
    final: 'historical-source-systematic-review-philo-boardroom.jsonl',
    paths: new Map([
      ['.sources/philo-yonge-1854-55/volume-01.txt',27057],
      ['.sources/philo-yonge-1854-55/volume-02.txt',26798],
      ['.sources/philo-yonge-1854-55/volume-03.txt',27721],
      ['.sources/philo-yonge-1854-55/volume-04.txt',28680]
    ])
  }
};
const errors = []; const report = {generated_at:'2026-08-29T00:00:00Z',status:'completed',sources:{}};
for (const [sourceId,cfg] of Object.entries(configs)) {
  const sourceHits = hits.filter((row) => row.source_id === sourceId);
  const target = sourceHits.filter((row) => row.hit_count > 0).map((row) => row.candidate_id).sort();
  const expected = new Set(target);
  const stages = {
    round1: cfg.round1.flatMap((name) => readJsonl(path.join(EDITORIAL,name))),
    round2: cfg.round2.flatMap((name) => readJsonl(path.join(EDITORIAL,name))),
    final_decision: readJsonl(path.join(EDITORIAL,cfg.final))
  };
  for (const [stage,rows] of Object.entries(stages)) {
    const seen = new Set();
    for (const row of rows) {
      if (row.source_id !== sourceId || row.stage !== stage) errors.push(`${sourceId}:${row.candidate_id} wrong source/stage in ${stage}`);
      if (!expected.has(row.candidate_id)) errors.push(`${sourceId}:${row.candidate_id} not a positive hit`);
      if (seen.has(row.candidate_id)) errors.push(`${sourceId}:${stage} duplicate ${row.candidate_id}`); seen.add(row.candidate_id);
      if (!['accepted','rejected','pending'].includes(row.identity_match?.status)) errors.push(`${sourceId}:${stage}:${row.candidate_id} invalid identity status`);
      if (!Array.isArray(row.locators) || !Array.isArray(row.relationship_evidence)) errors.push(`${sourceId}:${stage}:${row.candidate_id} evidence fields must be arrays`);
      for (const locator of row.locators || []) {
        const limit = cfg.paths.get(locator.source_path);
        if (!limit || !Number.isInteger(locator.line) || locator.line < 1 || locator.line > limit + 1) errors.push(`${sourceId}:${stage}:${row.candidate_id} invalid locator`);
      }
      if (stage === 'final_decision' && row.evidence_audit?.source_text_stored !== false) errors.push(`${sourceId}:${row.candidate_id} source text retention invariant failed`);
    }
    for (const id of expected) if (!seen.has(id)) errors.push(`${sourceId}:${stage} missing ${id}`);
  }
  const finalCounts = {accepted:0,rejected:0,pending:0}; let relationships = 0;
  for (const row of stages.final_decision) { finalCounts[row.identity_match.status] += 1; relationships += row.relationship_evidence.length; }
  report.sources[sourceId] = {
    coverage_rows:sourceHits.length,
    hit_rows:target.length,
    no_hit_rows:sourceHits.length-target.length,
    round1_rows:stages.round1.length,
    round2_rows:stages.round2.length,
    final_rows:stages.final_decision.length,
    final_counts:finalCounts,
    retained_relationship_evidence:relationships,
    review_complete:true,
    source_files:[...cfg.paths.keys()].map((sourcePath)=>({source_path:sourcePath,sha256:sourceHash(sourceId,sourcePath)}))
  };
}
if (errors.length) throw new Error(`historical source systematic review failed (${errors.length}):\n${errors.slice(0,100).join('\n')}`);
if (writeReport) fs.writeFileSync(REPORT, `${JSON.stringify(report,null,2)}\n`);
else if (fs.existsSync(REPORT)) {
  if (JSON.stringify(existingReport)!==JSON.stringify(report)) throw new Error('historical systematic review report is stale');
}
console.log(JSON.stringify(report,null,2));
