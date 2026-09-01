#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const DATA_DIR = path.join(ROOT, 'data');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'chinese-name-candidates.jsonl');
const PEOPLE_PATH = path.join(DATA_DIR, 'people.jsonl');
const REVIEWS_PATH = path.join(EDITORIAL_DIR, 'chinese-name-review.jsonl');
const SCHEMA_PATH = path.join(SCHEMAS_DIR, 'chinese-name-review.schema.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const SOURCE_ID = 'source:0003';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force'),
    validateOnly: args.includes('--validate-only')
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildCandidateMap(candidates) {
  const byPerson = new Map();
  for (const candidate of candidates) {
    if (!candidate || !candidate.person_id || !candidate.candidate_id) {
      continue;
    }
    const rows = byPerson.get(candidate.person_id) ?? [];
    rows.push(candidate);
    byPerson.set(candidate.person_id, rows);
  }
  return byPerson;
}

function pickTopCandidatesForPerson(rows) {
  const distinctRanks = [];
  const rankOrder = [];
  for (const row of rows) {
    rankOrder.push(row.candidate_rank);
  }
  rankOrder.sort((a, b) => a - b);
  for (const rank of rankOrder) {
    if (!distinctRanks.length || distinctRanks[distinctRanks.length - 1] !== rank) {
      distinctRanks.push(rank);
      if (distinctRanks.length >= 3) break;
    }
  }
  const cutoffRank = distinctRanks[distinctRanks.length - 1] ?? Infinity;
  return rows
    .filter((row) => row.candidate_rank <= cutoffRank)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.candidate_chinese.localeCompare(b.candidate_chinese);
    })
    .map((row) => ({
      candidate_id: row.candidate_id,
      candidate_chinese: row.candidate_chinese,
      candidate_rank: row.candidate_rank,
      score: row.score,
      supporting_passages: row.supporting_passages,
      support_count: row.support_count,
      mention_count: row.mention_count,
      coverage: row.coverage,
      precision: row.precision,
      score_margin_to_next: row.score_margin_to_next
    }));
}

function buildReviewRows(people, candidateMap) {
  const rows = [];
  const peopleIds = [...people.keys()].sort((a, b) => a.localeCompare(b));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const timestamp = manifest.created_at || '2026-08-26T00:00:00Z';

  for (const personId of peopleIds) {
    const person = people.get(personId);
    const candidateRows = candidateMap.get(personId);
    const sortedCandidateRows = (candidateRows || []).slice().sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate_chinese !== b.candidate_chinese) return a.candidate_chinese.localeCompare(b.candidate_chinese);
      return a.supporting_passages.length - b.supporting_passages.length;
    });
    const topCandidates = sortedCandidateRows.length ? pickTopCandidatesForPerson(sortedCandidateRows) : [];
    const notes = sortedCandidateRows.length ? '' : 'no top candidate options from current source build';

    rows.push({
      review_id: '',
      person_id: personId,
      latinized: person.latinized,
      top_candidate_refs: topCandidates,
      round1: {
        status: 'pending',
        selected_candidate_id: null,
        proposed_chinese: null,
        reviewer: null,
        decision_note: '',
        reviewed_at: null
      },
      round2: {
        status: 'pending',
        selected_candidate_id: null,
        proposed_chinese: null,
        reviewer: null,
        decision_note: '',
        reviewed_at: null
      },
      final_decision: {
        status: 'pending',
        selected_candidate_id: null,
        final_chinese: null,
        reviewer: null,
        decision_note: '',
        reviewed_at: null
      },
      source_id: SOURCE_ID,
      created_at: timestamp,
      updated_at: timestamp,
      notes
    });
  }
  return rows;
}

function validateRows(rows, schema) {
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [index, row] of rows.entries()) {
    if (!validate(row)) {
      const details = (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at chinese-name-review:${index + 1}: ${details}`);
    }
  }
}

function validateOnly() {
  if (!fs.existsSync(REVIEWS_PATH)) {
    throw new Error(`Missing review file: ${REVIEWS_PATH}`);
  }
  const reviews = readJsonl(REVIEWS_PATH);
  const people = new Map(readJsonl(PEOPLE_PATH).map((person) => [person.person_id, person]));
  const candidates = readJsonl(CANDIDATES_PATH);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const candidateById = new Map();
  const candidatesByPerson = new Map();
  const candidateIdsByPerson = new Map();
  for (const candidate of candidates) {
    candidateById.set(candidate.candidate_id, candidate);
    const rows = candidatesByPerson.get(candidate.person_id) ?? [];
    rows.push(candidate);
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.candidate_chinese.localeCompare(b.candidate_chinese);
    });
    candidatesByPerson.set(candidate.person_id, rows);
    const candidateIds = candidateIdsByPerson.get(candidate.person_id) ?? new Set();
    candidateIds.add(candidate.candidate_id);
    candidateIdsByPerson.set(candidate.person_id, candidateIds);
  }

  const reviewPeople = new Set();
  for (const row of reviews) {
    reviewPeople.add(row.person_id);
    if (!people.has(row.person_id)) {
      throw new Error(`Review references missing person_id: ${row.person_id}`);
    }
    const personCandidates = candidatesByPerson.get(row.person_id) || [];
    if (!row.top_candidate_refs) {
      throw new Error(`Top candidate refs missing: ${row.person_id}`);
    }
    for (const ref of row.top_candidate_refs) {
      const candidate = candidateById.get(ref.candidate_id);
      if (!candidate) {
        throw new Error(`Missing referenced candidate_id ${ref.candidate_id} in ${row.person_id}`);
      }
      if (candidate.person_id !== row.person_id) {
        throw new Error(`Candidate ${ref.candidate_id} belongs to ${candidate.person_id}, not ${row.person_id}`);
      }
      if (candidate.score !== ref.score) {
        throw new Error(`Top candidate score mismatch for ${ref.candidate_id}`);
      }
      if (personCandidates.length && !candidateIdsByPerson.get(row.person_id)?.has(ref.candidate_id)) {
        throw new Error(`Reference to candidate outside source person bucket: ${ref.candidate_id}`);
      }
    }
    const reviewCandidateSet = new Set(row.top_candidate_refs.map((ref) => ref.candidate_id));
    for (const [decisionName, decision, fieldName] of [
      ['round1', row.round1, 'proposed_chinese'],
      ['round2', row.round2, 'proposed_chinese'],
      ['final_decision', row.final_decision, 'final_chinese']
    ]) {
      if (!decision || !decision.status) {
        throw new Error(`Missing ${decisionName} object for ${row.person_id}`);
      }

      const selected = decision.selected_candidate_id;
      const candidateText = decision[fieldName];
      if (decision.status === 'pending') {
        if (selected !== null) {
          throw new Error(`Pending ${decisionName}.selected_candidate_id must be null: ${row.person_id}`);
        }
        if (candidateText !== null) {
          throw new Error(`Pending ${decisionName}.${fieldName} must be null: ${row.person_id}`);
        }
      } else if (decision.status === 'accepted' || selected !== null) {
        if (typeof selected !== 'string' || !selected) {
          throw new Error(`${decisionName} requires selected_candidate_id when ${decision.status}: ${row.person_id}`);
        }
        if (typeof candidateText !== 'string' || !candidateText.trim()) {
          throw new Error(`${decisionName} requires ${fieldName} when ${decision.status}: ${row.person_id}`);
        }
        const candidate = candidateById.get(selected);
        if (!candidate) {
          throw new Error(`${decisionName} references missing candidate_id ${selected} for ${row.person_id}`);
        }
        if (candidate.person_id !== row.person_id) {
          throw new Error(`${decisionName} candidate mismatch: ${selected} belongs to ${candidate.person_id}`);
        }
        if (!reviewCandidateSet.has(selected)) {
          throw new Error(`${decisionName} selection must come from top_candidate_refs: ${selected} (${row.person_id})`);
        }
        if (candidateText !== candidate.candidate_chinese) {
          throw new Error(`${decisionName} ${fieldName} mismatch for ${selected}: ${row.person_id}`);
        }
      } else if (candidateText !== null) {
        throw new Error(`Rejected ${decisionName}.${fieldName} must be null without a selected candidate: ${row.person_id}`);
      }

      if (decision.status !== 'pending') {
        if (typeof decision.reviewer !== 'string' || !decision.reviewer.trim()) {
          throw new Error(`${decisionName} requires reviewer when ${decision.status}: ${row.person_id}`);
        }
        if (typeof decision.reviewed_at !== 'string' || Number.isNaN(Date.parse(decision.reviewed_at))) {
          throw new Error(`${decisionName} requires reviewed_at when ${decision.status}: ${row.person_id}`);
        }
        if (typeof decision.decision_note !== 'string' || !decision.decision_note.trim()) {
          throw new Error(`${decisionName} requires decision_note when ${decision.status}: ${row.person_id}`);
        }
      }
    }
    if (row.top_candidate_refs.length === 0 && personCandidates.length > 0) {
      throw new Error(`No top candidates recorded for person with candidates: ${row.person_id}`);
    }
    if (personCandidates.length === 0 && row.top_candidate_refs.length > 0) {
      throw new Error(`Top candidates should be empty if source has no candidates: ${row.person_id}`);
    }
  }

  // This review corpus covers the NT name-candidate set. The unified people
  // table also contains OT-only people after the Bible-wide migration, so it
  // is intentionally valid for reviews to be a strict subset of people.
  const expectedReviewPeople = new Set(candidates.map((candidate) => candidate.person_id));
  if (reviews.length !== expectedReviewPeople.size) {
    throw new Error(`Review row count ${reviews.length} does not match candidate-person count ${expectedReviewPeople.size}`);
  }
  for (const personId of expectedReviewPeople) {
    if (!reviewPeople.has(personId)) {
      throw new Error(`Missing review row for candidate person_id ${personId}`);
    }
  }
  if (reviewPeople.size !== reviews.length) {
    throw new Error('Duplicate review rows by person_id detected');
  }

  validateRows(reviews, schema);
  console.log('OK validate:chinese-name-review');
}

function main() {
  const { force, validateOnly: validateOnlyMode } = parseArgs();
  const people = new Map(readJsonl(PEOPLE_PATH).map((person) => [person.person_id, person]));
  const candidates = readJsonl(CANDIDATES_PATH);
  const candidateMap = buildCandidateMap(candidates);

  if (validateOnlyMode) {
    validateOnly();
    return;
  }

  if (fs.existsSync(REVIEWS_PATH) && !force) {
    throw new Error(
      `Review file already exists: ${REVIEWS_PATH}. Use --force to overwrite a manual file intentionally.`
    );
  }

  const reviews = buildReviewRows(people, candidateMap);
  for (let i = 0; i < reviews.length; i += 1) {
    reviews[i].review_id = `cnr-${String(i + 1).padStart(4, '0')}`;
  }
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  validateRows(reviews, schema);

  ensureDir(EDITORIAL_DIR);
  fs.writeFileSync(REVIEWS_PATH, reviews.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

main();
