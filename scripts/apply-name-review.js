#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');

const NAMES_PATH = path.join(DATA_DIR, 'names.jsonl');
const REVIEWS_PATH = path.join(EDITORIAL_DIR, 'name-review.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'name-review-report.json');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    checkOnly: args.includes('--check'),
    dryRun: args.includes('--dry-run')
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

function validateReviewArtifact() {
  const result = spawnSync(process.execPath, ['scripts/init-name-review.js', '--validate-only'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error('name-review validation failed (run with --validate-only for details)');
  }
}

function main() {
  const { checkOnly, dryRun } = parseArgs();

  validateReviewArtifact();

  const reviews = readJsonl(REVIEWS_PATH);
  if (checkOnly) {
    console.log('OK check:name-review-application');
    return;
  }

  const names = readJsonl(NAMES_PATH);
  const reviewByName = new Map(reviews.map((row) => [row.name_id, row]));
  let updated = 0;
  let skipped = 0;
  const reviewedAt = reviews[0]?.final_decision?.reviewed_at ?? new Date().toISOString();

  const nextNames = names.map((row) => {
    const review = reviewByName.get(row.name_id);
    if (!review) return row;
    if (!['accepted', 'rejected'].includes(review.final_decision.status)) {
      skipped += 1;
      return row;
    }
    const changed = { ...row };
    changed.status = review.final_decision.status;
    changed.notes = `name-review: ${review.final_decision.decision_reason}. Evidence: ${review.final_decision.evidence_refs.join('; ')}`;
    changed.updated_at = review.final_decision.reviewed_at || reviewedAt;
    if (
      changed.status !== row.status ||
      changed.notes !== row.notes ||
      changed.updated_at !== row.updated_at
    ) {
      updated += 1;
      return changed;
    }
    skipped += 1;
    return row;
  });

  const reportLines = {
    generated_at: new Date().toISOString(),
    output_path: path.relative(ROOT, NAMES_PATH).replace(/\\/g, '/'),
    total_name_rows: names.length,
    names_updated: updated,
    names_skipped: skipped
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(reportLines, null, 2) + '\n', 'utf8');

  if (dryRun) {
    console.log(`DRY RUN: would update ${updated} names`);
    return;
  }

  if (updated > 0) {
    writeJsonl(NAMES_PATH, nextNames);
  }
  console.log(`Updated ${updated} name rows`);
  console.log(`Skipped ${skipped} name rows`);
}

main();
