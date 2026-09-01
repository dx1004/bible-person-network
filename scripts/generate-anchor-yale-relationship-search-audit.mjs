#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE_ARG = process.argv.find((item) => item.startsWith('--capture='));
const CAPTURE_PATH = CAPTURE_ARG ? CAPTURE_ARG.slice('--capture='.length) : null;
const HEADWORD_AUDIT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-headword-audit.jsonl');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-relationship-search-audit.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-relationship-search-audit-report.json');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'anchor-yale-relationship-search-audit.schema.json');
const APPLY = process.argv.includes('--apply');

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const headwordRows = readJsonl(HEADWORD_AUDIT_PATH);
const headwordByLocator = new Map();
for (const row of headwordRows) {
  for (const match of row.matches) {
    const entry = headwordByLocator.get(match.locator) ?? {candidateIds: new Set()};
    for (const candidateId of row.candidate_ids) entry.candidateIds.add(candidateId);
    headwordByLocator.set(match.locator, entry);
  }
}

let capture;
if (APPLY) {
  if (!CAPTURE_PATH) throw new Error('--apply requires an explicit --capture=<path>');
  capture = JSON.parse(fs.readFileSync(CAPTURE_PATH, 'utf8'));
} else {
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  capture = {
    source_id: report.source_id,
    captured_at: report.generated_at,
    query: report.query,
    summary: report.search_summary,
    result_count: report.visible_result_count,
    result_cap_observed: report.result_cap_observed,
    volume_summaries: report.volume_summaries || [],
    rows: readJsonl(OUTPUT_PATH).map((row) => ({title: row.article_title, locator: row.locator})),
    source_text_stored: false,
    snippets_stored: false
  };
}

if (capture.source_id !== 'source:0009') throw new Error('capture source_id mismatch');
if (capture.source_text_stored !== false || capture.snippets_stored !== false) throw new Error('restricted text boundary violated');
if (capture.rows.length !== capture.result_count) throw new Error('capture result count mismatch');

const volumeSummaries = Array.isArray(capture.volume_summaries) ? capture.volume_summaries : [];
const volumeChapterTotal = volumeSummaries.reduce((sum, item) => sum + Number(item.chapters || 0), 0);
const completePartitionedCapture = volumeSummaries.length === 6
  && volumeChapterTotal === 2726
  && capture.result_count === 2726
  && new Set(capture.rows.map((row) => row.locator)).size === 2726;

const rows = capture.rows.map((item) => {
  const headword = headwordByLocator.get(item.locator);
  return {
    source_id: 'source:0009',
    article_title: item.title,
    locator: item.locator,
    person_headword: Boolean(headword),
    candidate_ids: headword ? [...headword.candidateIds].sort() : [],
    audit_scope: completePartitionedCapture
      ? 'bloomsbury_six_volume_partitioned_kinship_search'
      : 'bloomsbury_combined_kinship_search_visible_results',
    source_text_stored: false,
    snippets_stored: false,
    reviewed_at: capture.captured_at
  };
});

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({allErrors: true, strict: true, strictSchema: false, validateSchema: false});
addFormats(ajv);
const validate = ajv.compile(schema);
const errors = [];
const locators = new Set();
for (const [index, row] of rows.entries()) {
  if (!validate(row)) for (const error of validate.errors ?? []) errors.push(`row ${index + 1}${error.instancePath}: ${error.message}`);
  if (locators.has(row.locator)) errors.push(`duplicate locator ${row.locator}`);
  locators.add(row.locator);
}
if (errors.length) throw new Error(`Anchor Yale relationship search audit failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);

const personRows = rows.filter((row) => row.person_headword);
const candidateIds = new Set(personRows.flatMap((row) => row.candidate_ids));
const report = {
  generated_at: capture.captured_at,
  status: completePartitionedCapture ? 'completed_six_volume_partitioned_search' : 'completed_partial_visible_results',
  source_id: 'source:0009',
  query: capture.query,
  search_summary: capture.summary,
  visible_result_count: rows.length,
  result_cap_observed: capture.result_cap_observed,
  volume_summaries: volumeSummaries,
  volume_chapter_total: volumeChapterTotal,
  official_person_headword_results: personRows.length,
  candidate_ids_with_visible_result: candidateIds.size,
  relationship_assertions_retained: 0,
  limitation: completePartitionedCapture
    ? 'All 2,726 matching chapters were enumerated through six volume-scoped searches. Visible contexts were inspected transiently; no article text or snippets are stored, and context matches do not automatically approve relationship assertions.'
    : 'Bloomsbury reported 2,726 matching chapters but the unpartitioned interface exposed only the first 2,000 results. Visible search metadata alone is insufficient to approve relationship assertions.',
  copyright_boundary: {source_text_stored: false, snippets_stored: false}
};

if (APPLY) {
  fs.writeFileSync(OUTPUT_PATH, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
