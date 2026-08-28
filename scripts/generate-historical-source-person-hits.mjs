#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES_PATH = path.join(ROOT, 'editorial', 'old-testament-person-candidates.jsonl');
const ACCESS_REVIEW_PATH = path.join(ROOT, 'editorial', 'source-access-review.jsonl');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'historical-source-person-hit.schema.json');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'historical-source-person-hits.jsonl');
const REPORT_PATH = path.join(ROOT, 'editorial', 'historical-source-person-hits-report.json');
const SOURCE_IDS = ['source:0006', 'source:0007'];
const LOCATOR_CAP = 25;
const VALIDATE_ONLY = process.argv.includes('--validate-only');
const COMMON_WORDS = new Set(['adore', 'all', 'as', 'ash', 'barak', 'beer', 'cheer', 'day', 'eden', 'gad', 'ham', 'job', 'no', 'on', 'omer', 'ram', 'reed', 'salt', 'sheba', 'shelah', 'shua', 'teman', 'zerah']);

const relative = (filePath) => path.relative(ROOT, filePath).split(path.sep).join('/');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = (filePath) => hash(fs.readFileSync(filePath));
const compare = (a, b) => String(a).localeCompare(String(b), 'en');

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${relative(filePath)}`);
  return fs.readFileSync(filePath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`${relative(filePath)}:${index + 1}: invalid JSON`); }
  });
}

function normalizeQuery(value) {
  return String(value || '').normalize('NFKC').replace(/[’`]/g, "'").replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function candidateQueries(candidate) {
  const values = [candidate.latinized, candidate.normalized_unified_name, candidate.step_identity_key?.split('@')[0], ...(candidate.names || []).map((name) => name.raw_name?.split('@')[0])];
  const byFolded = new Map();
  for (const value of values) {
    const query = normalizeQuery(value);
    if (!/^[A-Za-z][A-Za-z .'-]*[A-Za-z]$/.test(query) || query.length < 2) continue;
    const folded = query.toLowerCase();
    if (!byFolded.has(folded)) byFolded.set(folded, query);
  }
  return [...byFolded.values()].sort((a, b) => compare(a.toLowerCase(), b.toLowerCase()));
}

function createQueryIndex(candidates) {
  const index = new Map();
  for (const candidate of candidates) {
    const queries = candidateQueries(candidate);
    if (!queries.length) throw new Error(`${candidate.candidate_id}: no searchable Latin name variant`);
    for (const query of queries) {
      const folded = query.toLowerCase();
      if (!index.has(folded)) index.set(folded, { query, candidateIds: [] });
      index.get(folded).candidateIds.push(candidate.candidate_id);
    }
  }
  for (const entry of index.values()) entry.candidateIds.sort(compare);
  return index;
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compileChunks(index) {
  const entries = [...index.values()].sort((a, b) => b.query.length - a.query.length || compare(a.query, b.query));
  const chunks = [];
  for (let i = 0; i < entries.length; i += 180) {
    chunks.push(new RegExp(`(?<![A-Za-z])(?:${entries.slice(i, i + 180).map((entry) => escapeRegex(entry.query)).join('|')})(?![A-Za-z])`, 'giu'));
  }
  return chunks;
}

function registeredSources() {
  const byId = new Map(readJsonl(ACCESS_REVIEW_PATH).map((row) => [row.source_id, row]));
  return SOURCE_IDS.map((sourceId) => {
    const row = byId.get(sourceId);
    if (!row) throw new Error(`Missing registered source ${sourceId}`);
    if (row.license_status !== 'verified_public_domain' || row.access_status !== 'locked_public_download' || !row.files?.length) throw new Error(`${sourceId}: source is not a locked public-domain download`);
    return { sourceId, files: row.files };
  });
}

function verifySourceFiles(sources) {
  for (const source of sources) for (const registered of source.files) {
    const filePath = path.resolve(ROOT, registered.local_path);
    if (!filePath.startsWith(path.join(ROOT, '.sources') + path.sep)) throw new Error(`${source.sourceId}: source path escapes .sources`);
    if (!fs.existsSync(filePath)) throw new Error(`${source.sourceId}: missing ${registered.local_path}`);
    const buffer = fs.readFileSync(filePath);
    if (buffer.length !== registered.bytes) throw new Error(`${source.sourceId}: byte mismatch ${registered.local_path}`);
    if (hash(buffer) !== registered.sha256) throw new Error(`${source.sourceId}: SHA-256 mismatch ${registered.local_path}`);
    if (buffer.toString('utf8').split(/\n/).length - 1 !== registered.line_count) throw new Error(`${source.sourceId}: line-count mismatch ${registered.local_path}`);
  }
}

function createCoverage(candidates) {
  const coverage = new Map();
  for (const candidate of candidates) for (const sourceId of SOURCE_IDS) coverage.set(`${candidate.candidate_id}\0${sourceId}`, {
    candidate_id: candidate.candidate_id, source_id: sourceId, matched: new Set(), hit_count: 0, locators: [], risks: new Set()
  });
  return coverage;
}

function updateJosephus(line, state) {
  if (line.includes('*** START OF THE PROJECT GUTENBERG EBOOK')) state.started = true;
  if (!state.started) return;
  const book = line.match(/^BOOK ([IVXLCDM]+)\./);
  if (book?.[1] === 'I') state.bookOneCount += 1;
  if (state.bookOneCount >= 2 && book) { state.book = book[1]; state.chapter = null; state.body = true; }
  const chapter = line.match(/^CHAPTER (\d+)\./);
  if (chapter && state.body) state.chapter = Number(chapter[1]);
}

function scan(sources, queryIndex, chunks, coverage) {
  for (const source of sources) for (const registered of source.files) {
    const lines = fs.readFileSync(path.resolve(ROOT, registered.local_path), 'utf8').split(/\n/);
    const josephus = { started: false, body: false, bookOneCount: 0, book: null, chapter: null };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].replace(/\r$/, '');
      if (source.sourceId === 'source:0006') updateJosephus(line, josephus);
      for (const regex of chunks) {
        regex.lastIndex = 0;
        for (const match of line.matchAll(regex)) {
          const entry = queryIndex.get(normalizeQuery(match[0]).toLowerCase());
          if (!entry) throw new Error(`Matched unindexed query: ${match[0]}`);
          for (const candidateId of entry.candidateIds) {
            const row = coverage.get(`${candidateId}\0${source.sourceId}`);
            row.hit_count += 1;
            row.matched.add(entry.query);
            if (row.locators.length < LOCATOR_CAP) {
              const locator = { source_path: registered.local_path, line: i + 1, matched_query: entry.query };
              if (source.sourceId === 'source:0006' && josephus.body) {
                locator.work = 'Antiquities of the Jews';
                if (josephus.book) locator.book = josephus.book;
                if (josephus.chapter) locator.chapter = josephus.chapter;
              }
              row.locators.push(locator);
            }
            if (entry.candidateIds.length > 1) row.risks.add('ambiguous_name_shared_by_candidates');
            if (entry.query.replace(/[^A-Za-z]/g, '').length <= 3) row.risks.add('short_query');
            if (COMMON_WORDS.has(entry.query.toLowerCase())) row.risks.add('common_english_word_query');
            if (source.sourceId === 'source:0007') row.risks.add('ocr_requires_page_scan_confirmation');
            if (source.sourceId === 'source:0006' && !josephus.body) row.risks.add('front_matter_or_toc_hit');
          }
        }
      }
    }
  }
}

function serialize(coverage) {
  return [...coverage.values()].sort((a, b) => compare(a.candidate_id, b.candidate_id) || compare(a.source_id, b.source_id)).map((row) => ({
    candidate_id: row.candidate_id,
    source_id: row.source_id,
    matched_queries: [...row.matched].sort((a, b) => compare(a.toLowerCase(), b.toLowerCase())),
    hit_count: row.hit_count,
    locators: row.locators.sort((a, b) => compare(a.source_path, b.source_path) || a.line - b.line || compare(a.matched_query, b.matched_query)),
    locators_capped: row.hit_count > row.locators.length,
    status: 'pending',
    false_positive_risk_flags: [...row.risks].sort(compare)
  }));
}

function validateRows(rows, candidates, sources) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const errors = [], candidateIds = new Set(candidates.map((row) => row.candidate_id)), seen = new Set();
  const registeredFiles = new Map(sources.flatMap((source) => source.files.map((file) => [file.local_path, { sourceId: source.sourceId, lineCount: file.line_count }])));
  let previous = '';
  for (const [i, row] of rows.entries()) {
    if (!validate(row)) for (const error of validate.errors || []) errors.push(`row ${i + 1}${error.instancePath}: ${error.message}`);
    const key = `${row.candidate_id}\0${row.source_id}`;
    if (seen.has(key)) errors.push(`duplicate ${row.candidate_id}/${row.source_id}`);
    if (key <= previous) errors.push(`not sorted at ${row.candidate_id}/${row.source_id}`);
    seen.add(key); previous = key;
    if (!candidateIds.has(row.candidate_id)) errors.push(`unknown candidate ${row.candidate_id}`);
    if (row.hit_count === 0 && (row.matched_queries.length || row.locators.length || row.locators_capped)) errors.push(`${row.candidate_id}/${row.source_id}: invalid no-hit row`);
    if (row.hit_count > 0 && (!row.matched_queries.length || !row.locators.length)) errors.push(`${row.candidate_id}/${row.source_id}: incomplete hit row`);
    if (row.locators_capped !== (row.hit_count > row.locators.length)) errors.push(`${row.candidate_id}/${row.source_id}: cap flag mismatch`);
    if (JSON.stringify(row.matched_queries) !== JSON.stringify([...row.matched_queries].sort((a, b) => compare(a.toLowerCase(), b.toLowerCase())))) errors.push(`${row.candidate_id}/${row.source_id}: matched queries not sorted`);
    if (JSON.stringify(row.false_positive_risk_flags) !== JSON.stringify([...row.false_positive_risk_flags].sort(compare))) errors.push(`${row.candidate_id}/${row.source_id}: risk flags not sorted`);
    let previousLocator = '';
    for (const locator of row.locators) {
      if (!row.matched_queries.includes(locator.matched_query)) errors.push(`${row.candidate_id}/${row.source_id}: undeclared locator query`);
      const registered = registeredFiles.get(locator.source_path);
      if (!registered || registered.sourceId !== row.source_id) errors.push(`${row.candidate_id}/${row.source_id}: unregistered locator path`);
      else if (locator.line > registered.lineCount + 1) errors.push(`${row.candidate_id}/${row.source_id}: locator line out of range`);
      const locatorKey = `${locator.source_path}\0${String(locator.line).padStart(9, '0')}\0${locator.matched_query}`;
      if (locatorKey < previousLocator) errors.push(`${row.candidate_id}/${row.source_id}: locators not sorted`);
      previousLocator = locatorKey;
    }
  }
  for (const candidateId of candidateIds) for (const sourceId of SOURCE_IDS) if (!seen.has(`${candidateId}\0${sourceId}`)) errors.push(`missing ${candidateId}/${sourceId}`);
  if (rows.length !== candidates.length * SOURCE_IDS.length) errors.push(`row count ${rows.length} != ${candidates.length * SOURCE_IDS.length}`);
  if (errors.length) throw new Error(`historical source hit validation failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);
}

function sourceSummary(rows, sourceId) {
  const sourceRows = rows.filter((row) => row.source_id === sourceId);
  return { coverage_rows: sourceRows.length, hit_rows: sourceRows.filter((row) => row.hit_count > 0).length, no_hit_rows: sourceRows.filter((row) => row.hit_count === 0).length, total_hits: sourceRows.reduce((sum, row) => sum + row.hit_count, 0), capped_rows: sourceRows.filter((row) => row.locators_capped).length };
}

function createReport(rows, candidates, sources, jsonl) {
  return {
    dataset: 'pending_historical_source_person_hit_index', version: 1, review_state: 'discovery_only_all_rows_pending',
    candidate_input: relative(CANDIDATES_PATH), candidate_count: candidates.length, candidate_sha256: fileHash(CANDIDATES_PATH),
    output_path: relative(OUTPUT_PATH), output_sha256: hash(jsonl), row_count: rows.length,
    hit_rows: rows.filter((row) => row.hit_count > 0).length, no_hit_rows: rows.filter((row) => row.hit_count === 0).length, locator_cap: LOCATOR_CAP,
    source_files: sources.flatMap((source) => source.files.map((file) => ({ source_id: source.sourceId, source_path: file.local_path, sha256: file.sha256, bytes: file.bytes, line_count: file.line_count }))),
    per_source: Object.fromEntries(SOURCE_IDS.map((sourceId) => [sourceId, sourceSummary(rows, sourceId)])),
    limitations: ['Name hits are discovery candidates, not identity or relationship evidence.', 'Shared, short, and ordinary-word names can produce false positives.', 'Philo OCR locators require confirmation against the public-domain page scans.', 'Locator lists are capped; hit_count retains the complete occurrence count.', 'No source text or snippets are stored in the generated artifacts.']
  };
}

function validateReport(report, rows, candidates, sources, jsonl) {
  const errors = [];
  if (report.dataset !== 'pending_historical_source_person_hit_index' || report.version !== 1) errors.push('report identity mismatch');
  if (report.review_state !== 'discovery_only_all_rows_pending') errors.push('review_state mismatch');
  if (report.candidate_count !== candidates.length || report.candidate_sha256 !== fileHash(CANDIDATES_PATH)) errors.push('candidate provenance mismatch');
  if (report.candidate_input !== relative(CANDIDATES_PATH) || report.output_path !== relative(OUTPUT_PATH)) errors.push('report path mismatch');
  if (report.row_count !== rows.length || report.output_sha256 !== hash(jsonl)) errors.push('output provenance mismatch');
  if (report.hit_rows !== rows.filter((row) => row.hit_count > 0).length || report.no_hit_rows !== rows.filter((row) => row.hit_count === 0).length) errors.push('hit counts mismatch');
  if (report.locator_cap !== LOCATOR_CAP) errors.push('locator cap mismatch');
  const expectedSourceFiles = sources.flatMap((source) => source.files.map((file) => ({ source_id: source.sourceId, source_path: file.local_path, sha256: file.sha256, bytes: file.bytes, line_count: file.line_count })));
  if (JSON.stringify(report.source_files) !== JSON.stringify(expectedSourceFiles)) errors.push('registered source provenance mismatch');
  for (const sourceId of SOURCE_IDS) if (JSON.stringify(report.per_source?.[sourceId]) !== JSON.stringify(sourceSummary(rows, sourceId))) errors.push(`${sourceId}: report summary mismatch`);
  if (errors.length) throw new Error(`historical source hit report validation failed:\n${errors.join('\n')}`);
}

const candidates = readJsonl(CANDIDATES_PATH);
if (VALIDATE_ONLY) {
  const sources = registeredSources(), jsonl = fs.readFileSync(OUTPUT_PATH, 'utf8'), rows = readJsonl(OUTPUT_PATH), report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  validateRows(rows, candidates, sources); validateReport(report, rows, candidates, sources, jsonl);
  console.log(JSON.stringify({ status: 'ok', mode: 'validate-only', rows: rows.length, hitRows: report.hit_rows, noHitRows: report.no_hit_rows }, null, 2));
} else {
  const sources = registeredSources(); verifySourceFiles(sources);
  const queryIndex = createQueryIndex(candidates), coverage = createCoverage(candidates);
  scan(sources, queryIndex, compileChunks(queryIndex), coverage);
  const rows = serialize(coverage); validateRows(rows, candidates, sources);
  const jsonl = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, report = createReport(rows, candidates, sources, jsonl);
  fs.writeFileSync(OUTPUT_PATH, jsonl); fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`); validateReport(report, rows, candidates, sources, jsonl);
  console.log(JSON.stringify({ status: 'ok', mode: 'generate', rows: rows.length, hitRows: report.hit_rows, noHitRows: report.no_hit_rows, perSource: report.per_source }, null, 2));
}
