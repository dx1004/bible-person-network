#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const DATA_DIR = path.join(ROOT, 'data');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'old-testament-chinese-name-candidate.schema.json');
const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'old-testament-chinese-name-candidates.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'old-testament-chinese-name-candidates-report.json');
const CUV_USFM_DIR = path.join(ROOT, '.sources', 'cmn-cu89s-usfm');
const OLD_CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates.jsonl');

const DEFAULT_SOURCE_ID = 'source:0003';

const DATASET_TIMESTAMP = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8')).created_at;
if (!DATASET_TIMESTAMP || Number.isNaN(Date.parse(DATASET_TIMESTAMP))) {
  throw new Error('data/manifest.json must provide a valid created_at timestamp');
}

const OT_BOOKS = new Set(['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAH', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL']);

const BOOK_CODE_ALIASES = {
  NAM: 'NAH',
  EZK: 'EZE'
};

function parseArg(name, fallback = process.env[name.toUpperCase()]) {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const withEq = `${key}=`;
  const found = args.find((a) => a.startsWith(withEq));
  if (found) return found.slice(withEq.length);
  const idx = args.indexOf(key);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return fallback;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at ${filePath}:${idx + 1}`);
      }
    });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeToken(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
    .replace(/^[^\u4e00-\u9fff]+|[^\u4e00-\u9fff]+$/g, '')
    .trim();
}

function isLikelyGeographicOrTitle(value) {
  if (!value) return false;
  return /(\u5730$|\u57ce$|\u5c71$|\u6d77$|\u6cb3$|\u57ce|\u4f4d\u95f4$|\u4eba\u7fa4$|^\u4f0a\u4fe1$)/.test(value);
}

function parseVerseMarkers(usfmDir) {
  if (!fs.existsSync(usfmDir)) {
    throw new Error(`CUV 目录不存在: ${usfmDir}`);
  }

  const tokenPassageCounts = new Map();
  const tokenPassageSet = new Map();
  const verseTextByPassage = new Map();
  const parsedFiles = [];
  const files = fs
    .readdirSync(usfmDir)
    .filter((file) => /-([A-Z0-9]{2,4})cmn-cu89s\.usfm$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  const chapterRe = /^\\c\s+(\d+)/;
 const verseRe = /(?:^|\s)\\v\s+(\d+(?:-\d+)?)/g;
  const tokenRe = /\\\+?pn\s+(.+?)\\\+?pn\*/g;

  for (const file of files) {
    const content = fs.readFileSync(path.join(usfmDir, file), 'utf8');
    const idMatch = content.match(/^\\id\s+([1-3]?[A-Z]{2,4})/m);
    const rawBook = idMatch ? idMatch[1].toUpperCase() : null;
    if (!rawBook) continue;
    const book = BOOK_CODE_ALIASES[rawBook] || rawBook;
    if (!OT_BOOKS.has(book)) continue;

    parsedFiles.push(file);

    let chapter = null;
    let passage = null;
    for (const line of content.split(/\r?\n/)) {
      const chapterMatch = line.match(chapterRe);
      if (chapterMatch) {
        chapter = chapterMatch[1];
        passage = null;
        continue;
      }
 const verseMatches = Array.from(line.matchAll(verseRe));
 const segments = verseMatches.length > 0
 ? verseMatches.map((match, index) => ({
 verse: match[1],
 text: line.slice(match.index, verseMatches[index + 1]?.index ?? line.length),
 }))
 : [{ verse: null, text: line }];

 for (const segment of segments) {
 if (segment.verse && chapter) passage = `${book} ${chapter}:${segment.verse}`;
 if (!passage) continue;

 const current = verseTextByPassage.get(passage) || '';
 verseTextByPassage.set(passage, `${current} ${segment.text}`.trim());

 tokenRe.lastIndex = 0;
 let match;
 while ((match = tokenRe.exec(segment.text)) !== null) {
        const token = normalizeToken(match[1]);
        if (!token || !/[\u4e00-\u9fff]/.test(token)) continue;
        if (isLikelyGeographicOrTitle(token)) continue;

        const byPassage = tokenPassageCounts.get(token) ?? new Map();
        byPassage.set(passage, (byPassage.get(passage) || 0) + 1);
        tokenPassageCounts.set(token, byPassage);

        const set = tokenPassageSet.get(token) ?? new Set();
        set.add(passage);
        tokenPassageSet.set(token, set);
 }
 }
    }
  }

  const repoRelativeFiles = parsedFiles.map((file) => path.relative(ROOT, path.join(usfmDir, file)));
  return {
    tokenPassageCounts,
    tokenPassageSet,
    verseTextByPassage,
    parsedFiles: repoRelativeFiles,
    parsedFileInventories: repoRelativeFiles.map((relativePath) => {
      const fullPath = path.join(ROOT, relativePath);
      const fileBuffer = fs.readFileSync(fullPath);
      const fileHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex');

      return {
        path: relativePath,
        checksum: fileHash,
        size: fileBuffer.length
      };
    })
  };
}

function intersectPassages(a, b) {
  const out = [];
  for (const p of a) {
    if (b.has(p)) out.push(p);
  }
  return out;
}

function scoreCandidate(overlapCount, candidatePassages, mentionCount, tokenPassagesCount) {
  const overlap = overlapCount;
  const personMentions = Math.max(mentionCount, 1);
  const precisionDenom = Math.max(tokenPassagesCount, 1);
  const union = candidatePassages.size + mentionCount - overlap;

  const coverage = Number((overlap / personMentions).toFixed(4));
  const precision = Number((overlap / precisionDenom).toFixed(4));
  const jaccard = Number((overlap / Math.max(union, 1)).toFixed(4));
  const score = Number((coverage * 0.5 + precision * 0.3 + jaccard * 0.2).toFixed(4));
  return { coverage, precision, jaccard, score };
}

function runCandidates({ usfmDir, oldCandidates }) {
  const {
    tokenPassageCounts,
    tokenPassageSet,
    parsedFileInventories
  } = parseVerseMarkers(usfmDir);
  const candidates = [];
  const notes = [];

  const tokenEntries = [...tokenPassageCounts.keys()].sort((a, b) => a.localeCompare(b));
  let noMatchOldCandidateCount = 0;
  let matchedRows = 0;

  for (const row of oldCandidates) {
    const oldCandidateId = row.candidate_id;
    const latinized = row.latinized || '';
    const canonical_name = row.canonical_name || '';
    const mentions = Array.from(new Set((row.ot_refs || []).filter((x) => typeof x === 'string')));

    if (!mentions.length) {
      noMatchOldCandidateCount += 1;
      candidates.push({
        candidate_id: '',
        old_candidate_id: oldCandidateId,
        latinized,
        canonical_name,
        candidate_chinese: null,
        supporting_passages: [],
        support_count: 0,
        mention_count: 0,
        coverage: 0,
        precision: 0,
        jaccard: 0,
        score: 0,
        ambiguity: {
          level: 'none',
          reasons: ['no_mentions'],
          notes: 'No OT refs available for overlap generation.'
        },
        status: 'pending',
        source_id: DEFAULT_SOURCE_ID,
        method: 'pn_overlap_ot_refs',
        score_margin_to_next: 0,
        candidate_rank: 1,
        high_confidence_candidate: false
      });
      continue;
    }

    const candidateRows = [];
    const mentionSet = new Set(mentions);

    for (const token of tokenEntries) {
      const tokenPassages = tokenPassageSet.get(token);
      if (!tokenPassages) continue;
      const supportPassages = intersectPassages(mentionSet, tokenPassages);
      if (!supportPassages.length) continue;

      const tokenCounts = tokenPassageCounts.get(token) || new Map();
      const { coverage, precision, jaccard, score } = scoreCandidate(
        supportPassages.length,
        tokenPassages,
        mentions.length,
        tokenCounts.size
      );

      candidateRows.push({
        candidate_id: '',
        old_candidate_id: oldCandidateId,
        latinized,
        canonical_name,
        candidate_chinese: token,
        supporting_passages: supportPassages.sort(),
        support_count: supportPassages.length,
        mention_count: mentions.length,
        coverage,
        precision,
        jaccard,
        score,
        ambiguity: {
          level: 'none',
          reasons: ['single_token'],
          notes: ''
        },
        status: 'pending',
        source_id: DEFAULT_SOURCE_ID,
        method: 'pn_overlap_ot_refs',
        score_margin_to_next: 0,
        candidate_rank: 0,
        high_confidence_candidate: false
      });
    }

    if (!candidateRows.length) {
      noMatchOldCandidateCount += 1;
      candidates.push({
        candidate_id: '',
        old_candidate_id: oldCandidateId,
        latinized,
        canonical_name,
        candidate_chinese: null,
        supporting_passages: [],
        support_count: 0,
        mention_count: mentions.length,
        coverage: 0,
        precision: 0,
        jaccard: 0,
        score: 0,
        ambiguity: {
          level: 'none',
          reasons: ['no_cuv_support'],
          notes: 'No overlapping CUV name-token with OT refs.'
        },
        status: 'pending',
        source_id: DEFAULT_SOURCE_ID,
        method: 'pn_overlap_ot_refs',
        score_margin_to_next: 0,
        candidate_rank: 1,
        high_confidence_candidate: false
      });
      continue;
    }

    candidateRows.sort((a, b) => {
      if (a.old_candidate_id !== b.old_candidate_id) return a.old_candidate_id.localeCompare(b.old_candidate_id);
      if (b.score !== a.score) return b.score - a.score;
      if ((a.candidate_chinese || '\u0000') !== (b.candidate_chinese || '\u0000')) {
        return (a.candidate_chinese || '').localeCompare(b.candidate_chinese || '');
      }
      if (a.latinized !== b.latinized) return a.latinized.localeCompare(b.latinized);
      if (b.support_count !== a.support_count) return b.support_count - a.support_count;
      if (a.canonical_name !== b.canonical_name) return a.canonical_name.localeCompare(b.canonical_name);
      if (a.supporting_passages.length !== b.supporting_passages.length) return b.supporting_passages.length - a.supporting_passages.length;

      const aFirstPassage = a.supporting_passages[0] || '';
      const bFirstPassage = b.supporting_passages[0] || '';
      if (aFirstPassage !== bFirstPassage) return aFirstPassage.localeCompare(bFirstPassage);

      return a.method.localeCompare(b.method);
    });

    const uniqueScores = [];
    for (const item of candidateRows) {
      if (!uniqueScores.length || uniqueScores[uniqueScores.length - 1] !== item.score) uniqueScores.push(item.score);
    }

    let rank = 1;
    let lastScore = null;
    for (const item of candidateRows) {
      if (lastScore === null) {
        item.candidate_rank = 1;
      } else if (item.score !== lastScore) {
        rank += 1;
        item.candidate_rank = rank;
      } else {
        item.candidate_rank = rank;
      }
      lastScore = item.score;

      item.score_margin_to_next = item.candidate_rank === 1 ? Number((uniqueScores[0] - (uniqueScores[1] || 0)).toFixed(4)) : 0;
      item.high_confidence_candidate = item.candidate_rank === 1
        && item.score >= 0.9
        && item.support_count >= 2
        && item.precision >= 0.9
        && item.coverage >= 0.9
        && item.score_margin_to_next >= 0.15;

      if (item.supporting_passages.length > 1) {
        item.ambiguity = {
          level: 'multi_token',
          reasons: ['multi_passage_support'],
          notes: 'Token appears in multiple matched passages.'
        };
      }
    }

    matchedRows += candidateRows.length;
    candidates.push(...candidateRows);
  }

  candidates.sort((a, b) => {
    if (a.old_candidate_id !== b.old_candidate_id) return a.old_candidate_id.localeCompare(b.old_candidate_id);
    if (b.score !== a.score) return b.score - a.score;
    if ((a.candidate_chinese || '\u0000') !== (b.candidate_chinese || '\u0000')) {
      return (a.candidate_chinese || '').localeCompare(b.candidate_chinese || '');
    }
    if (a.latinized !== b.latinized) return a.latinized.localeCompare(b.latinized);
    if (a.canonical_name !== b.canonical_name) return a.canonical_name.localeCompare(b.canonical_name);
    if (b.support_count !== a.support_count) return b.support_count - a.support_count;
    if (a.supporting_passages.length !== b.supporting_passages.length) return b.supporting_passages.length - a.supporting_passages.length;

    const aFirstPassage = a.supporting_passages[0] || '';
    const bFirstPassage = b.supporting_passages[0] || '';
    if (aFirstPassage !== bFirstPassage) return aFirstPassage.localeCompare(bFirstPassage);

    if (a.method !== b.method) return a.method.localeCompare(b.method);
    return a.candidate_chinese?.localeCompare(b.candidate_chinese || '') || 0;
  });

  for (let i = 0; i < candidates.length; i += 1) {
    candidates[i].candidate_id = `otcnc-${String(i + 1).padStart(6, '0')}`;
  }

  const ambiguityStats = candidates.reduce((acc, item) => {
    acc[item.ambiguity.level] = (acc[item.ambiguity.level] || 0) + 1;
    return acc;
  }, {});

  const coverageValues = candidates.map((row) => row.coverage);
  const precisionValues = candidates.map((row) => row.precision);

  const oldCandidateIds = new Set(oldCandidates.map((row) => row.candidate_id));
  const rowsByOldCandidate = new Map();
  for (const row of candidates) {
    const list = rowsByOldCandidate.get(row.old_candidate_id) ?? [];
    list.push(row);
    rowsByOldCandidate.set(row.old_candidate_id, list);
  }

  for (const list of rowsByOldCandidate.values()) {
    const hasTopMatch = list.some((r) => r.candidate_rank === 1 && r.score > 0);
    if (!hasTopMatch) {
      const hasPlaceholder = list.some((r) => r.candidate_chinese === null);
      if (!hasPlaceholder) {
        notes.push({ kind: 'warning', message: `old_candidate_id ${list[0].old_candidate_id} has non-positive top score` });
      }
    }
  }

  const report = {
    generated_at: DATASET_TIMESTAMP,
    source_id: DEFAULT_SOURCE_ID,
    source_locator: 'source:0003',
    input_reference: {
      source: DEFAULT_SOURCE_ID,
      input_locator: 'CUV_USFM_DIR',
      input_files: parsedFileInventories
    },
    candidate_count: candidates.length,
    old_candidate_count: oldCandidateIds.size,
    matched_old_candidate_count: oldCandidateIds.size - noMatchOldCandidateCount,
    no_match_old_candidate_count: noMatchOldCandidateCount,
    ambiguity_stats: ambiguityStats,
    coverage: {
      min: coverageValues.length ? Math.min(...coverageValues) : 0,
      max: coverageValues.length ? Math.max(...coverageValues) : 0,
      avg: coverageValues.length ? Number((coverageValues.reduce((s, n) => s + n, 0) / coverageValues.length).toFixed(4)) : 0
    },
    precision: {
      min: precisionValues.length ? Math.min(...precisionValues) : 0,
      max: precisionValues.length ? Math.max(...precisionValues) : 0,
      avg: precisionValues.length ? Number((precisionValues.reduce((s, n) => s + n, 0) / precisionValues.length).toFixed(4)) : 0
    },
    notes: [
      {
        kind: 'summary',
        old_candidate_count: oldCandidateIds.size,
        candidate_count: candidates.length,
        matched_old_candidate_count: oldCandidateIds.size - noMatchOldCandidateCount,
        no_match_old_candidate_count: noMatchOldCandidateCount,
        generated_rows_for_matched_candidates: matchedRows
      },
      ...notes
    ]
  };
  report.checksum = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');

  return {
    candidates,
    report,
    parsedFileInventories
  };
}

function validate(schema, rows) {
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validateItem = ajv.compile(schema);
  for (const [idx, row] of rows.entries()) {
    if (!validateItem(row)) {
      const details = (validateItem.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at row ${idx + 1}: ${details}`);
    }
  }
}

function validateOnly({ oldCandidates }) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const rows = readJsonl(CANDIDATES_PATH);
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));

  validate(schema, rows);

  const oldCandidateIds = new Set(oldCandidates.map((row) => row.candidate_id));
  if (report.old_candidate_count !== oldCandidateIds.size) {
    throw new Error(`report old_candidate_count mismatch: ${report.old_candidate_count} vs ${oldCandidateIds.size}`);
  }

  if (report.candidate_count !== rows.length) {
    throw new Error(`report candidate_count mismatch: ${report.candidate_count} vs ${rows.length}`);
  }

  const seen = new Set();
  for (const row of rows) {
    if (!row.old_candidate_id) throw new Error('row missing old_candidate_id');
    if (!row.candidate_id) throw new Error('row missing candidate_id');
    if (seen.has(row.candidate_id)) throw new Error(`duplicate candidate_id: ${row.candidate_id}`);
    seen.add(row.candidate_id);

    if (!oldCandidateIds.has(row.old_candidate_id)) {
      throw new Error(`row references missing old_candidate_id: ${row.old_candidate_id}`);
    }
  }

  console.log('OK validate:old-testament-chinese-name-candidates');
}

function main() {
  const usfmDir = parseArg('cuv-usfm-dir', CUV_USFM_DIR);
  const validateOnlyMode = process.argv.includes('--validate-only');

  const oldCandidates = readJsonl(OLD_CANDIDATES_PATH);

  if (validateOnlyMode) {
    validateOnly({ oldCandidates });
    return;
  }

  if (!usfmDir) throw new Error('请通过 --cuv-usfm-dir 或 CUV_USFM_DIR 提供 CUV USFM 路径');

  const { candidates, report, parsedFileInventories } = runCandidates({ usfmDir, oldCandidates });

  report.input_reference.input_checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(parsedFileInventories))
    .digest('hex');

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  validate(schema, candidates);

  ensureDir(EDITORIAL_DIR);
  fs.writeFileSync(CANDIDATES_PATH, `${candidates.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

main();
