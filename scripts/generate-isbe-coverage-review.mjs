#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL = path.join(ROOT, 'editorial');
const HITS = path.join(EDITORIAL, 'historical-source-person-hits.jsonl');
const PEOPLE_REVIEW = path.join(EDITORIAL, 'old-testament-person-review.jsonl');
const OUTPUT = path.join(EDITORIAL, 'isbe-1915-coverage-review.jsonl');
const REPORT = path.join(EDITORIAL, 'isbe-1915-coverage-review-report.json');
const APPLY = process.argv.includes('--apply');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readJsonl = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const compare = (a, b) => String(a).localeCompare(String(b), 'en');

function decide(hit, accepted) {
  if (!accepted) return { status: 'excluded_canonical_candidate', rationale: 'Canonical OT candidate review rejected this candidate; ISBE discovery coverage cannot restore it.' };
  if (!hit.hit_count) return { status: 'no_direct_match', rationale: 'No normalized candidate-name match occurs in the locked five-volume ISBE OCR corpus.' };
  const risks = new Set(hit.false_positive_risk_flags);
  if (risks.has('ambiguous_name_shared_by_candidates') || risks.has('common_english_word_query') || risks.has('short_query')) {
    return { status: 'reviewed_inconclusive', rationale: 'The locked corpus has a name occurrence, but shared, ordinary-word, or short-name ambiguity prevents unique source attribution.' };
  }
  return { status: 'accepted_coverage', rationale: 'An accepted canonical candidate has an unambiguous, non-ordinary normalized name occurrence in the locked ISBE corpus.' };
}

function build() {
  const reviews = new Map(readJsonl(PEOPLE_REVIEW).map((row) => [row.candidate_id, row.final_decision?.status === 'accepted']));
  const hits = readJsonl(HITS).filter((row) => row.source_id === 'source:0010').sort((a, b) => compare(a.candidate_id, b.candidate_id));
  if (hits.length !== 2720) throw new Error(`Expected 2720 ISBE hit rows, got ${hits.length}`);
  const rows = hits.map((hit) => {
    const decision = decide(hit, reviews.get(hit.candidate_id));
    return {
      candidate_id: hit.candidate_id,
      source_id: 'source:0010',
      coverage_decision: decision.status,
      rationale: decision.rationale,
      hit_count: hit.hit_count,
      matched_queries: hit.matched_queries,
      locators: hit.locators.map(({ source_path, line, matched_query }) => ({ source_path, line, matched_query })),
      locators_capped: hit.locators_capped,
      risk_flags: hit.false_positive_risk_flags,
      relationship_evidence: [],
      relationship_evidence_policy: 'ISBE 1915 is approved as a complete coverage-audit source only; it contributes no new or changed public relationship evidence.',
      source_text_stored: false
    };
  });
  const counts = Object.fromEntries([...new Set(rows.map((row) => row.coverage_decision))].sort().map((status) => [status, rows.filter((row) => row.coverage_decision === status).length]));
  const jsonl = `${rows.map(JSON.stringify).join('\n')}\n`;
  const report = {
    source_id: 'source:0010', edition: 'International Standard Bible Encyclopedia, James Orr et al., 1915, 5 vols.', status: 'completed_coverage_audit',
    candidate_count: rows.length, decision_counts: counts, positive_hit_rows: rows.filter((row) => row.hit_count > 0).length,
    no_hit_rows: rows.filter((row) => row.hit_count === 0).length, relationship_evidence_retained: 0,
    coverage_contract: 'All 2,720 OT candidates have a recorded ISBE discovery decision. The source is not used to add or modify public relationship assertions.',
    copyright_boundary: { source_text_stored: false, snippets_stored: false, public_output: 'locators_and_original_editorial_rationale_only' },
    input_sha256: hash(fs.readFileSync(HITS)), output_sha256: hash(jsonl)
  };
  return { rows, jsonl, report };
}

function validate() {
  const { rows, jsonl, report } = build();
  const savedRows = readJsonl(OUTPUT), savedReport = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  if (JSON.stringify(savedRows) !== JSON.stringify(rows)) throw new Error('ISBE coverage rows are stale');
  if (JSON.stringify(savedReport) !== JSON.stringify(report)) throw new Error('ISBE coverage report is stale');
  if (rows.some((row) => row.relationship_evidence.length || row.source_text_stored !== false)) throw new Error('ISBE copyright/evidence boundary failed');
  console.log(JSON.stringify({ status: 'ok', source: 'source:0010', candidates: rows.length, decisions: report.decision_counts }, null, 2));
}

if (APPLY) {
  const { jsonl, report } = build();
  fs.writeFileSync(OUTPUT, jsonl);
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}
validate();
