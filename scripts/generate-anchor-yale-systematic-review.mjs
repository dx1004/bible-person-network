#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_PATH = path.join(ROOT, 'editorial', 'old-testament-person-candidates.jsonl');
const PERSON_REVIEW_PATH = path.join(ROOT, 'editorial', 'old-testament-person-review.jsonl');
const LOCATOR_AUDIT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-headword-audit.jsonl');
const RELATIONSHIP_SEARCH_REPORT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-relationship-search-audit-report.json');
const RELATIONSHIP_REVIEW_REPORT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-relationship-review-audit-report.json');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-systematic-review.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'anchor-yale-systematic-review-report.json');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'anchor-yale-systematic-review.schema.json');
const APPLY = process.argv.includes('--apply');

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line,index)=>{
    try { return JSON.parse(line); }
    catch { throw new Error(`${path.relative(ROOT,filePath)}:${index+1}: invalid JSON`); }
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const candidates = readJsonl(CANDIDATE_PATH);
const personReviews = new Map(readJsonl(PERSON_REVIEW_PATH).map((row)=>[row.candidate_id,row]));
const locatorAudit = readJsonl(LOCATOR_AUDIT_PATH);
const relationshipSearchReport = readJson(RELATIONSHIP_SEARCH_REPORT_PATH);
const relationshipReviewReport = readJson(RELATIONSHIP_REVIEW_REPORT_PATH);
const auditByCandidate = new Map();
for (const row of locatorAudit) for (const candidateId of row.candidate_ids) auditByCandidate.set(candidateId,row);

const reviewedAt = '2026-08-30T04:40:00Z';
const rows = candidates.map((candidate)=>{
  const personReview = personReviews.get(candidate.candidate_id);
  const decision = personReview?.final_decision?.status;
  if (!['accepted','rejected'].includes(decision)) throw new Error(`${candidate.candidate_id}: missing final person decision`);
  const locator = auditByCandidate.get(candidate.candidate_id);
  if (!locator) throw new Error(`${candidate.candidate_id}: missing Anchor locator audit`);
  let status;
  let rationale;
  if (decision === 'rejected') {
    status = 'not_applicable_rejected_candidate';
    rationale = 'The canonical person review rejected this candidate; the Anchor title is retained only as source metadata.';
  } else if (locator.locator_status === 'no_direct_hit') {
    status = 'no_direct_headword';
    rationale = 'The official 1,923-entry Anchor Yale Person List has no exact normalized headword for this candidate name.';
  } else if (locator.candidate_ids.length > 1) {
    status = 'reviewed_inconclusive_homonym';
    rationale = 'An exact official person headword exists, but the same Latinized name maps to multiple canonical candidates and subscription-free metadata cannot disambiguate them.';
  } else {
    status = 'accepted';
    rationale = 'The accepted canonical candidate uniquely matches an exact title in the official Anchor Yale Person List.';
  }
  return {
    source_id:'source:0009',
    candidate_id:candidate.candidate_id,
    latinized:candidate.latinized,
    candidate_decision:decision,
    headword_status:locator.locator_status,
    matches:locator.matches,
    identity_review:{status,rationale},
    relationship_review:{status:'not_retained_headword_only',retained_evidence:[]},
    basis:'official_person_list_title_and_locator_only',
    source_text_stored:false,
    reviewed_at:reviewedAt
  };
});

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH,'utf8'));
const ajv = new Ajv({allErrors:true,strict:true,strictSchema:false,validateSchema:false});
addFormats(ajv);
const validate = ajv.compile(schema);
const errors=[];
const seen=new Set();
for (const [index,row] of rows.entries()) {
  if (!validate(row)) for (const error of validate.errors??[]) errors.push(`row ${index+1}${error.instancePath}: ${error.message}`);
  if (seen.has(row.candidate_id)) errors.push(`duplicate ${row.candidate_id}`);
  seen.add(row.candidate_id);
}
if (seen.size!==candidates.length) errors.push(`coverage ${seen.size}/${candidates.length}`);
if (errors.length) throw new Error(`Anchor Yale systematic review failed (${errors.length}):\n${errors.slice(0,100).join('\n')}`);

const counts=Object.fromEntries([...new Set(rows.map((row)=>row.identity_review.status))].map((status)=>[status,rows.filter((row)=>row.identity_review.status===status).length]));
const accessibleContextAutomationComplete =
  relationshipSearchReport.status === 'completed_six_volume_partitioned_search'
  && relationshipSearchReport.visible_result_count === 2726
  && relationshipSearchReport.volume_chapter_total === 2726
  && relationshipReviewReport.assertion_coverage === relationshipReviewReport.assertion_rows
  && relationshipReviewReport.review_status_distribution?.pending === 0
  && relationshipReviewReport.review_status_distribution?.pending_exception === 0;

const report={
  generated_at:relationshipReviewReport.generated_at,
  status:'in_progress_restricted_full_text',
  accessible_metadata_automation_status:accessibleContextAutomationComplete ? 'completed' : 'incomplete',
  source_id:'source:0009',
  candidate_coverage:rows.length,
  identity_counts:counts,
  official_person_headwords:1923,
  relationship_chapters_reviewed:relationshipSearchReport.visible_result_count,
  relationship_assertion_coverage:relationshipReviewReport.assertion_coverage,
  relationship_context_matches_retained:relationshipReviewReport.source_context_capture?.derived_row_count || 0,
  relationship_context_assertions_matched:relationshipReviewReport.source_context_capture?.derived_assertion_count || 0,
  manual_locator_lookup_required:0,
  limitations:[
    'Subscription Required blocks full article-body access.',
    'The official Person list, six-volume table-of-contents locators, and all 2,726 visible kinship-search chapter contexts are automated and complete.',
    'Context matches are corroborating metadata and do not automatically approve relationship assertions.'
  ],
  copyright_boundary:{source_text_stored:false,snippets_stored:false}
};
if (APPLY) {
  fs.writeFileSync(OUTPUT_PATH,rows.map((row)=>JSON.stringify(row)).join('\n')+'\n');
  fs.writeFileSync(REPORT_PATH,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
