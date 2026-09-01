#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_FILE = path.join(ROOT, 'exports', 'run.json');
const DATA_DIR = path.join(ROOT, 'data');
const MANIFEST_FILE = path.join(DATA_DIR, 'manifest.json');

function readJsonl(filePath, skipEmpty = false) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!skipEmpty) return out;
  return out;
}

function countPendingReview(rows) {
  let chinesePending = 0;
  let relationPending = 0;
  let relationRejected = 0;
  for (const row of rows.assertions) {
    if (row.status === 'superseded') relationRejected += 1;
    else if (row.editorial_status === 'pending') relationPending += 1;
  }
  for (const row of rows.people) {
    if (row?.review_status?.chinese_label_status === 'pending') chinesePending += 1;
  }
  return { chinesePending, relationPending, relationRejected };
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonlRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function estimatePendingOldTestamentReview() {
  const report = readJson(path.join(ROOT, 'editorial', 'old-testament-person-review-report.json'), null);
  if (report && Number.isInteger(report.pending)) {
    return report.pending;
  }
  const rows = readJsonlRows(path.join(ROOT, 'editorial', 'old-testament-person-review.jsonl'));
  return rows.filter((row) => row?.final_decision?.status === 'pending' || row?.candidate_status === 'pending').length;
}

function estimateCrossTestamentPending() {
  const report = readJson(path.join(ROOT, 'editorial', 'cross-testament-identity-review-report.json'), null);
  const rows = readJsonlRows(path.join(ROOT, 'editorial', 'cross-testament-identity-review.jsonl'));
  const pending = rows.filter((row) => row?.final_decision?.status === 'pending').length;
  const unmatched = rows.filter((row) => !(row?.step_identity_matches?.length > 0)).length;
  return {
    pending: rows.length > 0 ? pending : Number(report?.snapshot_count || 0),
    unmatched: rows.length > 0 ? unmatched : Number(report?.unmatched_count || 0),
  };
}

function otGateBlocks(manifest, needsReview) {
  const catalogSources = readJsonlRows(path.join(DATA_DIR, 'sources.jsonl'));
  const accessReviews = readJsonlRows(path.join(ROOT, 'editorial', 'source-access-review.jsonl'));
  const blockedSources = [...new Set([
    ...catalogSources
      .filter((source) => source?.status === 'pending')
      .map((source) => source.source_id),
    ...accessReviews
      .filter((source) => source?.release_required !== false && source?.systematic_review_status !== 'completed')
      .map((source) => source.source_id)
  ].filter(Boolean))];
  const sourceStatusBlock = blockedSources.length > 0;

  const publishedScopeStatus = manifest?.published_scope?.status;
  const pipelineGate = manifest?.pipeline_gate || {};
  const stage = pipelineGate.stage;
  const gateState = pipelineGate.state;
  const otStatePending = String(publishedScopeStatus || '').toLowerCase() === 'editorial_review_required'
    || String(gateState || '').toLowerCase().includes('ot')
    || String(stage || '').toLowerCase().includes('ot');

  const oldTestamentPending = estimatePendingOldTestamentReview();
  const crossTestament = estimateCrossTestamentPending();

  const hasOtGateBlockers = sourceStatusBlock || otStatePending || oldTestamentPending > 0 || crossTestament.pending > 0;

  return {
    hasBlockers: hasOtGateBlockers,
    blockers: {
      needsReview: Boolean(needsReview),
      sourcePendingCount: blockedSources.length,
      sourcePending: blockedSources,
      oldTestamentCandidatePending: oldTestamentPending,
      crossTestamentPending: crossTestament.pending,
      crossTestamentUnmatched: crossTestament.unmatched,
      publishedScopeStatus,
      pipelineGateState: gateState,
      pipelineGateStage: stage
    }
  };
}

function reconciliationStatus() {
  const reconPath = path.join(DATA_DIR, 'reconciliation.json');
  if (!fs.existsSync(reconPath)) return 'unknown';
  try {
    const r = JSON.parse(fs.readFileSync(reconPath, 'utf8'));
    if (r?.sblNameExtraction?.status === 'not_implemented') return 'not_implemented';
    if (r?.sblNameExtraction?.status) return r.sblNameExtraction.status;
    if (
      r?.sbl_person_scan?.status === 'implemented_independent_review' &&
      Number(r?.sbl_person_scan?.pending_audit_rows) === 0
    ) return 'implemented_independent_review';
    if (r?.sbl_person_scan?.method === 'step_lexicon_sbl_token_scan') return 'implemented_limited';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

if (!fs.existsSync(RUN_FILE)) {
  console.log('run.json not found. Execute `npm run validate:data` first.');
  process.exit(0);
}
const run = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const datasetTimestamp = manifest.created_at;
if (!datasetTimestamp || Number.isNaN(Date.parse(datasetTimestamp))) {
  throw new Error('data/manifest.json must provide a valid created_at timestamp');
}
const versionParts = String(manifest.version || '').split('.').map(Number);
if (versionParts.length !== 3 || versionParts.some((part) => !Number.isInteger(part) || part < 0)) {
  throw new Error('data/manifest.json must provide a semantic version');
}
const people = readJsonl(path.join(DATA_DIR, 'people.jsonl')).map((line) => JSON.parse(line));
const assertions = readJsonl(path.join(DATA_DIR, 'assertions.jsonl')).map((line) => JSON.parse(line));
const { chinesePending, relationPending, relationRejected } = countPendingReview({ people, assertions });
const publishedRelationships = assertions.filter(
  (row) => row.status === 'active' && row.editorial_status !== 'pending'
).length;
const sblNameExtractionStatus = reconciliationStatus();

const needsReview = (
  chinesePending > 0 ||
  relationPending > 0 ||
  sblNameExtractionStatus === 'not_implemented' ||
  sblNameExtractionStatus === 'implemented_limited' ||
  sblNameExtractionStatus === 'unknown'
);

  const otGate = otGateBlocks(manifest, needsReview);
  const needsEditorialReview = needsReview || otGate.hasBlockers;

const report = {
  ...run,
  counts: {
    ...run.counts,
    publishedRelationships,
    rejectedAssertions: relationRejected
  },
  generatedAt: new Date(datasetTimestamp).toISOString(),
  version: {
    major: versionParts[0],
    minor: versionParts[1],
    patch: versionParts[2]
  },
  status: needsEditorialReview ? 'editorial_review_required' : 'ready',
  gates: {
    ot: otGate.blockers
  },
  summary: [
    `People: ${run.counts.people}`,
    `Name variants: ${run.counts.names}`,
    `Mentions: ${run.counts.mentions}`,
    `Assertions: ${run.counts.assertions}`,
    `Published relationships: ${publishedRelationships}`,
    `Rejected assertions retained for audit: ${relationRejected}`,
    `Sources: ${run.counts.sources}`,
    `Identity options: ${run.counts.identityOptions}`,
    `Chinese labels pending review: ${chinesePending}`,
    `Relation assertions pending review: ${relationPending}`,
    `SBL proper-name extraction: ${sblNameExtractionStatus}`,
    `Source revisions pending: ${otGate.blockers.sourcePendingCount}`,
    `Old Testament review pending: ${otGate.blockers.oldTestamentCandidatePending}`,
    `Cross-testament identity pending: ${otGate.blockers.crossTestamentPending}`,
    `Cross-testament identity unmatched: ${otGate.blockers.crossTestamentUnmatched}`,
    `OT pipeline stage: ${otGate.blockers.pipelineGateStage || 'unknown'} (${otGate.blockers.pipelineGateState || 'none'})`
  ]
};
const reportPath = path.join(ROOT, 'exports', 'report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
