#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'chinese-name-candidates.schema.json');
const OUTPUT_PATH = path.join(EDITORIAL_DIR, 'chinese-name-candidates.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'chinese-name-candidates-report.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const OVERRIDE_PATH = path.join(EDITORIAL_DIR, 'chinese-name-overrides.jsonl');
const OVERRIDE_SCHEMA_PATH = path.join(ROOT, 'schemas', 'chinese-name-overrides.schema.json');
const DEFAULT_CUV_USFM_DIR = path.join(ROOT, '.sources', 'cmn-cu89s-usfm');

const DEFAULT_SOURCE_ID = 'source:0003';
const DATASET_TIMESTAMP = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).created_at;
if (!DATASET_TIMESTAMP || Number.isNaN(Date.parse(DATASET_TIMESTAMP))) {
  throw new Error('data/manifest.json must provide a valid created_at timestamp');
}
const NT_BOOKS = new Set([
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT',
  'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
  '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM',
  'HEB', 'JAS', '1PE', '2PE',
  '1JN', '2JN', '3JN', 'JUD', 'REV'
]);

function parseArg(name, fallback = process.env[name] || process.env[name.toUpperCase()]) {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const withEqual = `${key}=`;
  const found = args.find((a) => a.startsWith(withEqual));
  if (found) return found.slice(withEqual.length);
  const keyIndex = args.indexOf(key);
  if (keyIndex >= 0 && args[keyIndex + 1] && !args[keyIndex + 1].startsWith('--')) {
    return args[keyIndex + 1];
  }
  return fallback;
}

function computeContentHash(filePaths) {
  const hash = crypto.createHash('sha256');
  for (const file of filePaths.sort()) {
    hash.update(file);
    hash.update('\u0000');
    hash.update(fs.readFileSync(file));
    hash.update('\n');
  }
  return hash.digest('hex');
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

  const tokenPassageCounts = new Map(); // token -> passage -> count
  const tokenPassageSet = new Map(); // token -> Set(passage)
  const verseTextByPassage = new Map();
  const files = fs
    .readdirSync(usfmDir)
    .filter((file) => /\.usfm$/i.test(file))
    .sort((a, b) => a.localeCompare(b));
  const fileRegex = /-([A-Z0-9]{2,4})cmn-cu89s\.usfm$/i;
  const chapterRe = /^\\c\s+(\d+)/;
  const verseRe = /^\\v\s+(\d+(?:-\d+)?)/;
  const tokenRe = /\\\+?pn\s+(.+?)\\\+?pn\*/g;

  for (const file of files) {
    const content = fs.readFileSync(path.join(usfmDir, file), 'utf8');
    const idMatch = content.match(/^\\id\s+([1-3]?[A-Z]{2,4})/m);
    const fileMatch = file.match(fileRegex);
    const book = (idMatch ? idMatch[1].toUpperCase() : (fileMatch ? fileMatch[1].toUpperCase() : ''));
    if (!book) continue;
    if (!NT_BOOKS.has(book)) {
      if (process.env.CN_DEBUG === '1') {
        console.log(`skip-book:${book}`);
      }
      continue;
    }
    let chapter = null;
    let currentPassage = null;

    for (const line of content.split(/\r?\n/)) {
      if (process.env.CN_DEBUG === '1' && book === 'MAT' && line.includes('\\pn')) {
        tokenRe.lastIndex = 0;
        const tokenChecks = [];
        let tm;
        while ((tm = tokenRe.exec(line)) !== null) {
          tokenChecks.push(tm[1]);
        }
        if (tokenChecks.length === 0) {
          console.log('debug-no-match', book, line.slice(0, 120));
        } else {
          console.log('debug-match', book, tokenChecks.length, tokenChecks.join(','));
        }
      }
      const chapterMatch = line.match(chapterRe);
      if (chapterMatch) {
        chapter = chapterMatch[1];
        currentPassage = null;
        continue;
      }

      const verseMatch = line.match(verseRe);
      if (verseMatch && chapter) currentPassage = `${book} ${chapter}:${verseMatch[1]}`;
      if (!currentPassage) continue;

      const passage = currentPassage;
      verseTextByPassage.set(passage, `${verseTextByPassage.get(passage) || ''} ${line}`.trim());
      tokenRe.lastIndex = 0;
      let m;
      while ((m = tokenRe.exec(line)) !== null) {
        const token = normalizeToken(m[1]);
        if (!token || !/[\u4e00-\u9fff]/.test(token)) continue;
        if (isLikelyGeographicOrTitle(token)) continue;

        const byPassage = tokenPassageCounts.get(token) ?? new Map();
        byPassage.set(passage, (byPassage.get(passage) || 0) + 1);
        tokenPassageCounts.set(token, byPassage);

        const passageSet = tokenPassageSet.get(token) ?? new Set();
        passageSet.add(passage);
        tokenPassageSet.set(token, passageSet);
      }
    }
    if (process.env.CN_DEBUG === '1') {
      const count = Array.from(tokenPassageSet.values()).reduce((acc, set) => acc + set.size, 0);
      console.log(`parsed:${book}:${tokenPassageCounts.size}/${count}`);
    }
  }

  return {
    tokenPassageCounts,
    tokenPassageSet,
    verseTextByPassage,
    parsedFiles: files.map((file) => path.join(usfmDir, file))
  };
}

function loadCuratedOverrides(peopleIndex, verseTextByPassage, mentionsByPerson, mentionCountByPerson) {
  const rows = readJsonl(OVERRIDE_PATH);
  const schema = JSON.parse(fs.readFileSync(OVERRIDE_SCHEMA_PATH, 'utf8'));
  validate(schema, rows);
  const seen = new Set();
  return rows.map((row) => {
    const key = `${row.person_id}|${row.candidate_chinese}`;
    if (seen.has(key)) throw new Error(`duplicate curated Chinese-name override: ${key}`);
    seen.add(key);
    const person = peopleIndex.get(row.person_id);
    if (!person) throw new Error(`curated Chinese-name override references missing person: ${row.person_id}`);
    const sourceText = verseTextByPassage.get(row.source_passage) || '';
    const sourceTokens = row.source_tokens?.length ? row.source_tokens : [row.candidate_chinese];
    if (sourceTokens.some((token) => !sourceText.includes(token))) {
      throw new Error(`curated Chinese label components for ${row.candidate_chinese} not found at ${row.source_passage}`);
    }
    const mentionPassages = new Set((mentionsByPerson.get(row.person_id) || new Map()).keys());
    const supportingPassages = [...mentionPassages].filter((passage) => {
      const text = verseTextByPassage.get(passage) || '';
      return sourceTokens.every((token) => text.includes(token));
    });
    if (!supportingPassages.includes(row.canonical_passage)) supportingPassages.push(row.canonical_passage);
    supportingPassages.sort();
    const allTokenPassages = [...verseTextByPassage.entries()]
      .filter(([, text]) => sourceTokens.every((token) => text.includes(token)))
      .map(([passage]) => passage);
    const mentionCount = mentionCountByPerson.get(row.person_id) || 1;
    const supportCount = supportingPassages.length;
    const coverage = Number((supportCount / mentionCount).toFixed(4));
    const precision = Number((supportCount / Math.max(allTokenPassages.length, 1)).toFixed(4));
    const unionSize = Math.max(1, mentionCount + allTokenPassages.length - supportCount);
    const jaccard = Number((supportCount / unionSize).toFixed(4));
    const score = Number((coverage * 0.5 + precision * 0.3 + jaccard * 0.2).toFixed(4));
    return {
      candidate_id: '',
      person_id: row.person_id,
      latinized: person.latinized || '',
      candidate_chinese: row.candidate_chinese,
      supporting_passages: supportingPassages,
      support_count: supportCount,
      mention_count: mentionCount,
      coverage,
      precision,
      jaccard,
      score,
      ambiguity: {
        level: 'none',
        reasons: ['curated_literal_cuv_text'],
        notes: row.editor_note
      },
      status: 'pending',
      source_id: DEFAULT_SOURCE_ID,
      method: 'curated_cuv_literal_text',
      score_margin_to_next: 0,
      candidate_rank: 0,
      high_confidence_candidate: false
    };
  });
}

function buildMentionIndex() {
  const mentions = readJsonl(path.join(DATA_DIR, 'mentions.jsonl'));
  const mentionsByPerson = new Map(); // person_id -> Map(passage -> count)
  const personsByPassage = new Map(); // passage -> Set(person_id)
  const mentionSignatures = new Map(); // person_id -> signature string
  const peopleBySignature = new Map(); // signature -> Set(person_id)

  for (const row of mentions) {
    if (!row || !row.person_id || !row.passage) continue;
    const personRows = mentionsByPerson.get(row.person_id) ?? new Map();
    personRows.set(row.passage, (personRows.get(row.passage) || 0) + 1);
    mentionsByPerson.set(row.person_id, personRows);

    const personSet = personsByPassage.get(row.passage) ?? new Set();
    personSet.add(row.person_id);
    personsByPassage.set(row.passage, personSet);
  }

  const mentionCountByPerson = new Map();
  for (const [personId, passageMap] of mentionsByPerson.entries()) {
    const signature = [...passageMap.keys()].sort().join('|');
    mentionCountByPerson.set(personId, passageMap.size);
    mentionSignatures.set(personId, signature);
    const persons = peopleBySignature.get(signature) ?? new Set();
    persons.add(personId);
    peopleBySignature.set(signature, persons);
  }
  return {
    mentionsByPerson,
    personsByPassage,
    mentionCountByPerson,
    mentionSignatures,
    peopleBySignature
  };
}

function intersectPassages(a, b) {
  const out = [];
  for (const passage of a) {
    if (b.has(passage)) out.push(passage);
  }
  return out;
}

function runCandidates({ usfmDir, peopleIndex }) {
  const { tokenPassageCounts, tokenPassageSet, verseTextByPassage, parsedFiles } = parseVerseMarkers(usfmDir);
  const {
    mentionsByPerson,
    personsByPassage,
    mentionCountByPerson,
    mentionSignatures,
    peopleBySignature
  } = buildMentionIndex();
  if (process.env.CN_DEBUG === '1') {
    console.log(`cuv_tokens:${tokenPassageCounts.size}; mentions_persons:${mentionsByPerson.size}; people_index:${peopleIndex.size}`);
  }
  const candidates = [];
  const notes = [];

  const tokenEntries = Array.from(tokenPassageCounts.keys()).sort((a, b) => a.localeCompare(b));

  const personIds = Array.from(mentionsByPerson.keys()).sort((a, b) => a.localeCompare(b));
  for (const personId of personIds) {
    const mentionPassages = mentionsByPerson.get(personId);
    const person = peopleIndex.get(personId);
    if (!person) continue;

    const personMentionCount = mentionCountByPerson.get(personId) || 0;
    const personPassageSet = new Set(mentionPassages.keys());

      for (const candidate of tokenEntries) {
        const supportPassages = intersectPassages(personPassageSet, tokenPassageSet.get(candidate));
        if (!supportPassages.length) continue;

      const byPassageCounts = tokenPassageCounts.get(candidate) || new Map();
      const overlapSetSize = supportPassages.length;
      const unionSize = tokenPassageSet.get(candidate).size + personPassageSet.size - overlapSetSize;
      const mentionCountForCoverage = Math.max(personMentionCount, 1);

      const coverage = Number((overlapSetSize / mentionCountForCoverage).toFixed(4));
      const precision = Number((overlapSetSize / byPassageCounts.size).toFixed(4));
      const jaccard = Number((overlapSetSize / unionSize).toFixed(4));
      const score = Number((coverage * 0.5 + precision * 0.3 + jaccard * 0.2).toFixed(4));

        const multiToken = supportPassages.some((passage) => (tokenPassageCounts.get(candidate).get(passage) || 0) > 1);
      const sharedToken = supportPassages.some((passage) => (personsByPassage.get(passage) || new Set()).size > 1);
      const reasons = [];
      let level = 'none';
      if (sharedToken) reasons.push('multi_person_in_same_passage');
      if (multiToken) reasons.push('multi_token_in_same_passage');
      if (sharedToken && multiToken) level = 'shared_token_and_multi';
      else if (sharedToken) level = 'shared_token';
      else if (multiToken) level = 'multi_token';

        candidates.push({
        candidate_id: '',
        person_id: personId,
        latinized: person.latinized || '',
        candidate_chinese: candidate,
        supporting_passages: supportPassages.sort(),
        support_count: supportPassages.length,
        mention_count: personMentionCount,
        coverage,
        precision,
        jaccard,
        score,
        ambiguity: {
          level,
          reasons,
          notes: reasons.length ? reasons.join('; ') : 'single_person_single_token'
        },
        status: 'pending',
        source_id: DEFAULT_SOURCE_ID,
        method: 'pn_overlap_nt_mentions',
        score_margin_to_next: 0,
        candidate_rank: 0
      });
    }
  }

  for (const curated of loadCuratedOverrides(peopleIndex, verseTextByPassage, mentionsByPerson, mentionCountByPerson)) {
    const duplicate = candidates.find((row) => row.person_id === curated.person_id && row.candidate_chinese === curated.candidate_chinese);
    if (!duplicate) candidates.push(curated);
  }

  candidates.sort((a, b) => {
    if (a.person_id === b.person_id) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate_chinese !== b.candidate_chinese) return a.candidate_chinese.localeCompare(b.candidate_chinese);
      return a.supporting_passages.length - b.supporting_passages.length;
    }
    return a.person_id.localeCompare(b.person_id);
  });

  let previousPerson = null;
  let currentRank = 0;
  let groupStart = 0;
  let previousScore = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate.person_id !== previousPerson) {
      if (previousPerson !== null) {
        finalizePersonGroup(candidates, groupStart, i);
      }
      previousPerson = candidate.person_id;
      currentRank = 1;
      groupStart = i;
      previousScore = candidate.score;
    } else {
      currentRank = (candidate.score === previousScore) ? currentRank : currentRank + 1;
      previousScore = candidate.score;
    }
    candidate.candidate_rank = currentRank;
  }
  if (previousPerson !== null) {
    finalizePersonGroup(candidates, groupStart, candidates.length);
  }

  for (const person of new Set(candidates.map((candidate) => candidate.person_id))) {
    const signature = mentionSignatures.get(person);
    if (!signature) continue;
    const siblings = peopleBySignature.get(signature);
    if (!siblings || siblings.size <= 1) continue;
    for (const candidate of candidates) {
      if (candidate.person_id === person && !candidate.ambiguity.reasons.includes('identical_person_passage_signature')) {
        candidate.ambiguity.reasons.push('identical_person_passage_signature');
        if (candidate.ambiguity.notes) {
          candidate.ambiguity.notes += '; identical_person_passage_signature';
        } else {
          candidate.ambiguity.notes = 'identical_person_passage_signature';
        }
        candidate.high_confidence_candidate = false;
      }
    }
  }

  for (const candidate of candidates) {
    const thresholdPassed = candidate.support_count >= 2 && candidate.score >= 0.9 && candidate.precision >= 0.9 && candidate.coverage >= 0.9;
    const isTop = candidate.candidate_rank === 1;
    candidate.high_confidence_candidate = isTop && thresholdPassed && candidate.score_margin_to_next >= 0.15 && !candidate.ambiguity.reasons.includes('identical_person_passage_signature');
  }

  for (let i = 0; i < candidates.length; i += 1) {
    candidates[i].candidate_id = `cnc-${String(i + 1).padStart(4, '0')}`;
  }

  const ambiguityStats = candidates.reduce((acc, item) => {
    acc[item.ambiguity.level] = (acc[item.ambiguity.level] || 0) + 1;
    return acc;
  }, {});

  const coverageValues = candidates.map((row) => row.coverage);
  const precisionValues = candidates.map((row) => row.precision);
  notes.push({
    kind: 'summary',
    total_people_with_mentions: mentionsByPerson.size,
    total_people_with_candidates: new Set(candidates.map((c) => c.person_id)).size,
    candidate_count: candidates.length,
    high_confidence_count: candidates.filter((c) => c.high_confidence_candidate).length,
    people_with_high_confidence_count: new Set(candidates.filter((c) => c.high_confidence_candidate).map((c) => c.person_id)).size
  });

  const report = {
    generated_at: DATASET_TIMESTAMP,
    source_id: DEFAULT_SOURCE_ID,
    source_locator: `source:0003`,
    input_reference: {
      source: DEFAULT_SOURCE_ID,
      input_locator: 'CUV_USFM_DIR'
    },
    candidate_count: candidates.length,
    ambiguity_stats: ambiguityStats,
    coverage: {
      min: candidates.length ? Math.min(...coverageValues) : 0,
      max: candidates.length ? Math.max(...coverageValues) : 0,
      avg: candidates.length ? Number((coverageValues.reduce((s, n) => s + n, 0) / candidates.length).toFixed(4)) : 0
    },
    precision: {
      min: candidates.length ? Math.min(...precisionValues) : 0,
      max: candidates.length ? Math.max(...precisionValues) : 0,
      avg: candidates.length ? Number((precisionValues.reduce((s, n) => s + n, 0) / candidates.length).toFixed(4)) : 0
    },
    notes
  };
  report.checksum = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');

  return {
    candidates,
    report,
    usfmFiles: parsedFiles
  };
}

function validate(schema, items) {
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validateItem = ajv.compile(schema);
  for (const [idx, item] of items.entries()) {
    if (!validateItem(item)) {
      const details = (validateItem.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      throw new Error(`Schema validation failed at row ${idx + 1}: ${details}`);
    }
  }
}

function validateOnly({ peopleIndex }) {
  const candidates = readJsonl(OUTPUT_PATH);
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const { peopleBySignature } = buildMentionIndex();
  validate(schema, candidates);

  if (report.candidate_count !== candidates.length) {
    throw new Error(`report candidate_count mismatch: ${report.candidate_count} vs ${candidates.length}`);
  }

  const candidateIds = new Set();
  const peopleWithCandidate = new Set();
  const highConfidenceByPerson = new Map();
  const expectedByPerson = new Map();
  const candidatesByPerson = new Map();

  for (const candidate of candidates) {
    const list = expectedByPerson.get(candidate.person_id) ?? [];
    list.push(candidate);
    expectedByPerson.set(candidate.person_id, list);
    const personList = candidatesByPerson.get(candidate.person_id) ?? [];
    personList.push(candidate);
    candidatesByPerson.set(candidate.person_id, personList);
  }

  for (const [personId, rows] of expectedByPerson.entries()) {
    const sorted = rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate_chinese !== b.candidate_chinese) return a.candidate_chinese.localeCompare(b.candidate_chinese);
      return a.supporting_passages.length - b.supporting_passages.length;
    });
    for (let i = 0; i < sorted.length; i += 1) {
      const rank = (i > 0 && sorted[i].score === sorted[i - 1].score)
        ? sorted[i - 1].candidate_rank
        : i > 0
          ? (sorted[i - 1].candidate_rank || 0) + 1
          : 1;
      if (sorted[i].candidate_rank !== rank) {
        throw new Error(`invalid dense rank for ${personId}, candidate ${sorted[i].candidate_id}`);
      }
    }

    const uniqueScores = [];
    for (const row of sorted) {
      if (!uniqueScores.length || uniqueScores[uniqueScores.length - 1] !== row.score) {
        uniqueScores.push(row.score);
      }
    }
    const topScore = uniqueScores[0];
    const expectedMargin = uniqueScores.length >= 2 ? Number((uniqueScores[0] - uniqueScores[1]).toFixed(4)) : 0;
    const topRows = sorted.filter((row) => row.candidate_rank === 1);
    if (!topRows.length || topRows.some((row) => row.score !== topScore)) {
      throw new Error(`invalid top rank for ${personId}`);
    }
    if (topRows.length > 1 && topRows.some((row) => row.high_confidence_candidate)) {
      throw new Error(`high_confidence cannot exist for tied top rank1: ${personId}`);
    }

    for (const row of sorted) {
      if (!row.candidate_rank || !Number.isInteger(row.candidate_rank) || row.candidate_rank < 1) {
        throw new Error(`invalid candidate_rank: ${row.candidate_id}`);
      }

      if (row.candidate_rank === 1) {
        if (row.score_margin_to_next !== expectedMargin) {
          throw new Error(`invalid score_margin_to_next for ${row.candidate_id}`);
        }
      } else if (row.score_margin_to_next !== 0) {
        throw new Error(`non-top score_margin_to_next must be 0: ${row.candidate_id}`);
      }
    }
  }

  for (const [personId, personCandidates] of candidatesByPerson.entries()) {
    const sorted = [...personCandidates].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate_chinese !== b.candidate_chinese) return a.candidate_chinese.localeCompare(b.candidate_chinese);
      return a.supporting_passages.length - b.supporting_passages.length;
    });
    const topCount = sorted.filter((row) => row.candidate_rank === 1).length;
    const topHighCount = sorted.filter((row) => row.candidate_rank === 1 && row.high_confidence_candidate).length;
    if (topCount > 1 && topHighCount > 0) {
      throw new Error(`high_confidence cannot exist for tied top rank1: ${personId}`);
    }
  }

  for (const row of candidates) {
    if (!row.candidate_id) {
      throw new Error(`missing candidate_id: ${JSON.stringify(row)}`);
    }
    if (candidateIds.has(row.candidate_id)) {
      throw new Error(`duplicate candidate_id: ${row.candidate_id}`);
    }
    candidateIds.add(row.candidate_id);

    if (!row.candidate_rank || !Number.isInteger(row.candidate_rank) || row.candidate_rank < 1) {
      throw new Error(`invalid candidate_rank: ${row.candidate_id}`);
    }

    if (!peopleIndex.has(row.person_id)) {
      throw new Error(`candidate references missing person_id: ${row.person_id}`);
    }

    if (!Array.isArray(row.supporting_passages) || row.support_count !== row.supporting_passages.length) {
      throw new Error(`supporting_passages mismatch: ${row.candidate_id}`);
    }

    if (typeof row.score_margin_to_next !== 'number') {
      throw new Error(`missing/invalid score_margin_to_next: ${row.candidate_id}`);
    }

    if (row.high_confidence_candidate) {
      if (row.candidate_rank !== 1) {
        throw new Error(`high_confidence must be rank 1: ${row.candidate_id}`);
      }
      if (row.score_margin_to_next < 0.15) {
        throw new Error(`high_confidence margin below threshold: ${row.candidate_id}`);
      }
      if (row.support_count < 2 || row.score < 0.9 || row.precision < 0.9 || row.coverage < 0.9) {
        throw new Error(`high_confidence fails base threshold: ${row.candidate_id}`);
      }
      const current = highConfidenceByPerson.get(row.person_id) ?? 0;
      if (current >= 1) {
        throw new Error(`multiple high_confidence candidates for person: ${row.person_id}`);
      }
      highConfidenceByPerson.set(row.person_id, current + 1);
    }

    peopleWithCandidate.add(row.person_id);
  }

  const reportSummary = report.notes?.[0] || {};
  if (reportSummary.total_people_with_candidates !== peopleWithCandidate.size) {
    throw new Error(`total_people_with_candidates mismatch: ${reportSummary.total_people_with_candidates} vs ${peopleWithCandidate.size}`);
  }

  if (reportSummary.candidate_count !== candidates.length) {
    throw new Error(`report note candidate_count mismatch: ${reportSummary.candidate_count} vs ${candidates.length}`);
  }
  const highConfidenceTotal = candidates.filter((row) => row.high_confidence_candidate).length;
  if (reportSummary.people_with_high_confidence_count !== highConfidenceTotal) {
    throw new Error(`people_with_high_confidence_count mismatch: ${reportSummary.people_with_high_confidence_count} vs ${highConfidenceTotal}`);
  }

  const candidatesByPersonIds = new Map();
  for (const row of candidates) {
    const rows = candidatesByPersonIds.get(row.person_id) ?? [];
    rows.push(row);
    candidatesByPersonIds.set(row.person_id, rows);
  }

  for (const [signature, persons] of peopleBySignature.entries()) {
    if (persons.size <= 1) continue;
    for (const personId of persons) {
      const rows = candidatesByPersonIds.get(personId) ?? [];
      if (rows.length === 0) continue;
      for (const row of rows) {
        if (!row.ambiguity.reasons.includes('identical_person_passage_signature')) {
          throw new Error(`missing identical_person_passage_signature for person ${personId}: ${row.candidate_id}`);
        }
        if (row.high_confidence_candidate) {
          throw new Error(`high_confidence should be false for identical signature person: ${row.candidate_id}`);
        }
      }
    }
  }

  console.log('OK validate:chinese-name-candidates');
}

function finalizePersonGroup(candidates, start, end) {
  const uniqueScores = [];
  for (let i = start; i < end; i += 1) {
    const score = candidates[i].score;
    if (!uniqueScores.length || uniqueScores[uniqueScores.length - 1] !== score) {
      uniqueScores.push(score);
    }
  }

  for (let i = start; i < end; i += 1) {
    if (candidates[i].candidate_rank === 1) {
      const margin = uniqueScores.length >= 2 ? Number((uniqueScores[0] - uniqueScores[1]).toFixed(4)) : 0;
      candidates[i].score_margin_to_next = margin;
    } else {
      candidates[i].score_margin_to_next = 0;
    }
  }
}

function main() {
  const usfmDir = parseArg('cuv-usfm-dir', process.env.CUV_USFM_DIR || DEFAULT_CUV_USFM_DIR);
  const validateOnlyMode = process.argv.includes('--validate-only');

  const people = readJsonl(path.join(DATA_DIR, 'people.jsonl'));
  const peopleIndex = new Map(people.map((row) => [row.person_id, row]));
  if (validateOnlyMode) {
    validateOnly({ peopleIndex });
    return;
  }

  if (!usfmDir) {
    throw new Error('请通过 --cuv-usfm-dir 或 CUV_USFM_DIR 提供 CUV USFM 路径');
  }

  const { candidates, report, usfmFiles } = runCandidates({ usfmDir, peopleIndex });
  report.input_reference.input_checksum = computeContentHash(usfmFiles);
  if (process.env.CN_DEBUG === '1') {
    console.log(`candidates:${candidates.length}`);
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  validate(schema, candidates);

  ensureDir(EDITORIAL_DIR);
  fs.writeFileSync(OUTPUT_PATH, candidates.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

main();
