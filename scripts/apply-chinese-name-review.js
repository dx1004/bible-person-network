#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');

const PEOPLE_PATH = path.join(DATA_DIR, 'people.jsonl');
const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'chinese-name-candidates.jsonl');
const REVIEWS_PATH = path.join(EDITORIAL_DIR, 'chinese-name-review.jsonl');

const SOURCE_ID = 'source:0003';

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
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}`);
      }
    });
}

function validateReviewStrict() {
  const result = spawnSync(
    process.execPath,
    ['scripts/init-chinese-name-review.js', '--validate-only'],
    { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' }
  );
  if (result.status !== 0) {
    throw new Error('chinese-name-review validation failed (run with --check for details)');
  }
}

function buildLookup(rows, keyField) {
  const map = new Map();
  for (const row of rows) {
    map.set(row[keyField], row);
  }
  return map;
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

function assertApplyable(row, candidateById) {
  if (!row.final_decision || !row.round1 || !row.round2) {
    throw new Error(`Invalid decision blocks for ${row.person_id}`);
  }

  const finalStatus = row.final_decision.status;
  if (!['pending', 'accepted', 'rejected'].includes(finalStatus)) {
    throw new Error(`Invalid final_decision.status for ${row.person_id}: ${finalStatus}`);
  }

  if (finalStatus !== 'accepted') {
    return;
  }

  if (row.round1.status !== 'accepted' || row.round2.status !== 'accepted') {
    throw new Error(`Final accepted requires both round1 and round2 accepted: ${row.person_id}`);
  }

  const selected = row.final_decision.selected_candidate_id;
  const r1 = row.round1.selected_candidate_id;
  const r2 = row.round2.selected_candidate_id;
  if (!selected || !r1 || !r2) {
    throw new Error(`Accepted decision must include selected_candidate_id for all rounds: ${row.person_id}`);
  }
  if (selected !== r1 || selected !== r2) {
    throw new Error(`Selected candidate mismatch across rounds: ${row.person_id}`);
  }

  const finalChinese = row.final_decision.final_chinese;
  const r1Chinese = row.round1.proposed_chinese;
  const r2Chinese = row.round2.proposed_chinese;
  if (!finalChinese || !r1Chinese || !r2Chinese) {
    throw new Error(`Accepted decision requires non-empty Chinese text in all rounds: ${row.person_id}`);
  }
  if (finalChinese !== r1Chinese || finalChinese !== r2Chinese) {
    throw new Error(`Chinese mismatch across rounds: ${row.person_id}`);
  }

  const candidate = candidateById.get(selected);
  if (!candidate) {
    throw new Error(`Missing selected candidate ${selected} for ${row.person_id}`);
  }
  if (candidate.person_id !== row.person_id) {
    throw new Error(`Selected candidate ${selected} belongs to ${candidate.person_id}, not ${row.person_id}`);
  }
  if (candidate.candidate_chinese !== finalChinese) {
    throw new Error(`Selected candidate ${selected} chinese mismatch for ${row.person_id}`);
  }
}

function makeReport(summary) {
  const parts = [
    `source_id: ${SOURCE_ID}`,
    `reviewed_people: ${summary.total}`,
    `applied_updates: ${summary.applied}`,
    `unchanged_people: ${summary.total - summary.applied}`,
    `skipped_pending_or_rejected: ${summary.skipped}`,
    `candidates_not_found: ${summary.missingCandidate}`
  ];
  return parts.join('\n');
}

function main() {
  const { checkOnly, dryRun } = parseArgs();

  validateReviewStrict();

  const candidates = readJsonl(CANDIDATES_PATH);
  const reviews = readJsonl(REVIEWS_PATH);
  const reviewsByPerson = buildLookup(reviews, 'person_id');
  const candidateMap = buildLookup(candidates, 'candidate_id');

  if (checkOnly) {
    for (const review of reviews) {
      if (review.source_id === SOURCE_ID) {
        assertApplyable(review, candidateMap);
      }
    }
    console.log('OK check:chinese-name-review-application');
    return;
  }

  for (const review of reviews) {
    if (review.source_id === SOURCE_ID) {
      assertApplyable(review, candidateMap);
    }
  }

  const people = readJsonl(PEOPLE_PATH);

  let applied = 0;
  let skipped = 0;
  let missingCandidate = 0;

  const nextPeople = people.map((person) => {
    const review = reviewsByPerson.get(person.person_id);
    if (!review || review.source_id !== SOURCE_ID) {
      return person;
    }
    if (review.final_decision.status !== 'accepted') {
      skipped += 1;
      return person;
    }

    // All consistency checks for accepted decisions are enforced above via assertApplyable.
    // Any failure here indicates upstream data drift and should fail closed.

    const selectedCandidate = candidateMap.get(review.final_decision.selected_candidate_id);
    if (!selectedCandidate) throw new Error(`Missing selected candidate ${review.final_decision.selected_candidate_id} for ${person.person_id}`);
    if (selectedCandidate.person_id !== person.person_id) throw new Error(`Selected candidate ${review.final_decision.selected_candidate_id} belongs to ${selectedCandidate.person_id}, not ${person.person_id}`);
    if (selectedCandidate.candidate_chinese !== review.final_decision.final_chinese) throw new Error(`Selected candidate chinese mismatch for ${person.person_id}`);

    const updated = { ...person };
    const chinese = selectedCandidate.candidate_chinese;
    updated.canonical_chinese = chinese;
    updated.status = 'accepted';
    updated.review_status = {
      ...(updated.review_status || {}),
      chinese_label_status: 'accepted',
      chinese_label_note: review.final_decision.decision_note || (updated.review_status?.chinese_label_note || '')
    };
    updated.updated_at = review.final_decision.reviewed_at || updated.updated_at;
    if (
      person.canonical_chinese === updated.canonical_chinese
      && person.status === updated.status
      && JSON.stringify(person.review_status) === JSON.stringify(updated.review_status)
      && person.updated_at === updated.updated_at
    ) {
      skipped += 1;
      return person;
    }
    applied += 1;
    return updated;
  });

  console.log(makeReport({
    total: people.length,
    applied,
    skipped,
    missingCandidate
  }));

  if (dryRun) {
    console.log(`DRY RUN: would apply ${applied} people updates`);
    return;
  }

  if (applied > 0) {
    writeJsonl(PEOPLE_PATH, nextPeople);
  } else {
    console.log('No applied items; no people updates written');
  }
  console.log(`Applied ${applied} people updates`);
}

main();
