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
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'direct-relationship-discovery.schema.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const PEOPLE_PATH = path.join(DATA_DIR, 'people.jsonl');
const NAMES_PATH = path.join(DATA_DIR, 'names.jsonl');
const MENTIONS_PATH = path.join(DATA_DIR, 'mentions.jsonl');
const ASSERTIONS_PATH = path.join(DATA_DIR, 'assertions.jsonl');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.jsonl');
const DEFAULT_CUV_DIR = path.join(ROOT, '.sources', 'cmn-cu89s-usfm');
const OUTPUT_PATH = path.join(EDITORIAL_DIR, 'direct-relationship-discovery.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'direct-relationship-discovery-report.json');
const REVIEW_PATH = path.join(EDITORIAL_DIR, 'direct-relationship-review.jsonl');

const PATH_LIMIT = 5;
const RELATION_TYPES = [
  'kinship',
  'teacher_student',
  'collegial',
  'commission',
  'host',
  'political',
  'legal',
  'hostile',
  'succession',
  'alliance',
  'military',
  'prophetic_confrontation',
  'covenant'
];

const CUE_TERMS = {
  kinship: ['父', '母', '儿', '女', '子', '兄弟', '姊妹', '夫', '妻', '婆', '孙', '父亲', '母亲', '哥哥', '姐姐', '兄嫂', '儿子', '女儿'],
  teacher_student: ['教导', '教学', '门徒', '训蒙', '听从', '师', '门徒', '教师', '博士', '学习', '研读', '启示'],
  collegial: ['同工', '同伴', '同心', '同往', '共事', '联手', '协同', '合作'],
  commission: ['差遣', '托付', '委派', '命令', '吩咐', '指派', '使者', '交付'],
  host: ['接待', '收留', '宴请', '留在', '款待', '招待', '供应', '供养', '款留'],
  political: ['王', '君', '治理', '作王', '国', '宫', '朝廷', '执政', '统治', '政权', '领受', '任命'],
  legal: ['审判', '审理', '诉讼', '控告', '辩护', '审讯', '判决', '告密', '法庭', '律法', '证词', '审问'],
  hostile: ['仇', '敌', '攻击', '争战', '逼迫', '杀', '夺', '控告', '反对', '争论', '背叛', '被拿', '背敌'],
  succession: ['继承', '接位', '接续', '位', '王位', '继任', '接掌'],
  alliance: ['盟约', '同盟', '联盟', '誓言', '联军', '联合', '盟', '会盟'],
  military: ['率领', '军', '兵', '战斗', '战争', '战事', '征兵', '进攻', '围困', '围攻'],
  prophetic_confrontation: ['先知', '预言', '责备', '责问', '警告', '谴责', '申言', '预言', '宣告', '谴责'],
  covenant: ['立约', '契约', '盟', '约定', '誓', '发誓', '条约', '立誓', '新约', '订约']
};

const BOOK_ALIASES = { NAM: 'NAH', EZK: 'EZE' };
const BOOKS = new Set(['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAH', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'COL', 'THA', 'PHP', 'PHM', '1TH', '2TH', '1TI', '2TI', 'TIT', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV']);
const NT_BOOKS = new Set(['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'COL', 'THA', 'PHP', 'PHM', '1TH', '2TH', '1TI', '2TI', 'TIT', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV']);

const CHECK = process.argv.includes('--check');

function parseArg(name, fallback) {
  const args = process.argv.slice(2);
  const withEq = `--${name}=`;
  const exact = args.find((arg) => arg.startsWith(withEq));
  if (exact) return exact.slice(withEq.length);
  const pos = args.indexOf(`--${name}`);
  if (pos >= 0 && args[pos + 1] && !args[pos + 1].startsWith('--')) return args[pos + 1];
  return fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${path.relative(ROOT, file)}`);
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${path.relative(ROOT, file)}:${index + 1}: invalid JSON`);
    }
  });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeWord(value) {
  return String(value || '').normalize('NFKC').replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/[《》“”‘’`'"，。！？；：、\-—\(\)\[\]【】]/g, '').replace(/\s+/g, '').trim();
}

function normalizePerson(value) {
  return normalizeWord(value).toLowerCase();
}

function cleanText(value) {
  return String(value || '')
    .replace(/\\[a-z0-9*]+/giu, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safePair(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function readCuvUsfm(usfmDir) {
  if (!fs.existsSync(usfmDir)) throw new Error(`Missing CUV USFM directory: ${usfmDir}`);

  const chapterRe = /^\\c\s+(\d+)/;
  const verseRe = /\\v\s+(\d+(?:-\d+)?)/g;
  const idRe = /^\\id\s+([1-3]?[A-Z]{2,4})/;
  const pnRe = /\\\+?pn\s+(.+?)\\\+?pn\*/g;

  const files = fs
    .readdirSync(usfmDir)
    .filter((file) => /-([A-Z0-9]{2,4})cmn-cu89s\.usfm$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  const passageText = new Map();
  const pnByPassage = new Map();
  const fileList = [];

  for (const file of files) {
    const full = path.join(usfmDir, file);
    const raw = fs.readFileSync(full, 'utf8');
    const idMatch = raw.match(idRe);
    if (!idMatch) continue;
    const rawBook = idMatch[1].toUpperCase();
    const book = BOOK_ALIASES[rawBook] || rawBook;
    if (!BOOKS.has(book)) continue;

    fileList.push(path.relative(ROOT, full).split(path.sep).join('/'));
    let chapter = null;
    let currentPassage = null;

    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const bookMark = line.match(chapterRe);
      if (bookMark) {
        chapter = bookMark[1];
        currentPassage = null;
        continue;
      }

      const verses = [...line.matchAll(verseRe)];
      if (!verses.length) {
        if (currentPassage) {
          const appended = cleanText(line);
          if (appended) {
            passageText.set(currentPassage, `${passageText.get(currentPassage) || ''} ${appended}`.trim());
          }
        }
        continue;
      }

      for (let i = 0; i < verses.length; i += 1) {
        const verseMatch = verses[i];
        const verse = verseMatch[1];
        const from = verseMatch.index + verseMatch[0].length;
        const to = verses[i + 1]?.index ?? line.length;
        currentPassage = chapter ? `${book} ${chapter}:${verse}` : null;
        if (!currentPassage) continue;

        const segment = line.slice(from, to);
        const clean = cleanText(segment);
        if (!clean) continue;
        passageText.set(currentPassage, `${passageText.get(currentPassage) || ''} ${clean}`.trim());

        let tokenMatch;
        pnRe.lastIndex = 0;
        while ((tokenMatch = pnRe.exec(segment)) !== null) {
          const token = normalizePerson(tokenMatch[1]);
          if (!token) continue;
          const collection = pnByPassage.get(currentPassage) || [];
          collection.push(token);
          pnByPassage.set(currentPassage, collection);
        }
      }
    }
  }

  const fileInventories = fileList.map((relativePath) => {
    const absolute = path.join(ROOT, relativePath);
    const buffer = fs.readFileSync(absolute);
    return {
      source_id: 'source:0003',
      source_path: relativePath,
      sha256: sha256(buffer),
      bytes: buffer.length
    };
  });

  return { passageText, pnByPassage, fileInventories };
}

function buildNameIndex(names, acceptedPeople, people) {
  const map = new Map();
  for (const person of people) {
    if (!acceptedPeople.has(person.person_id)) continue;
    const norm = normalizePerson(person.canonical_chinese);
    if (!norm) continue;
    const ids = map.get(norm) || [];
    if (!ids.includes(person.person_id)) ids.push(person.person_id);
    map.set(norm, ids);
  }
  for (const row of names) {
    if (row.status !== 'accepted') continue;
    if (!acceptedPeople.has(row.person_id)) continue;
    const norm = normalizePerson(row.name_text);
    if (!norm) continue;
    const ids = map.get(norm) || [];
    if (!ids.includes(row.person_id)) ids.push(row.person_id);
    map.set(norm, ids);
  }
  return map;
}

function buildAcceptedMentionsByPassage(mentions, acceptedPeople) {
  const map = new Map();
  for (const row of mentions) {
    if (row.status !== 'accepted') continue;
    if (row.mention_sense !== 'person') continue;
    if (!acceptedPeople.has(row.person_id)) continue;
    const set = map.get(row.passage) || new Set();
    set.add(row.person_id);
    map.set(row.passage, set);
  }
  return map;
}

function acceptedMentionGateForPassage(passage, acceptedMentionsByPassage) {
  const exact = acceptedMentionsByPassage.get(passage);
  if (exact?.size) return exact;

  const range = /^([1-3]?[A-Z]{2,4}) (\d+):(\d+)-(\d+)$/.exec(String(passage));
  if (!range) return null;
  const [, book, chapter, firstRaw, lastRaw] = range;
  const first = Number(firstRaw);
  const last = Number(lastRaw);
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first || last - first > 20) return null;

  const merged = new Set();
  for (let verse = first; verse <= last; verse += 1) {
    for (const personId of acceptedMentionsByPassage.get(`${book} ${chapter}:${verse}`) || []) merged.add(personId);
  }
  return merged.size ? merged : null;
}

function matchPersonIdsByTokens(tokens, indexByToken) {
  const ids = new Set();
  for (const token of tokens) {
    const list = indexByToken.get(token);
    if (!list) continue;
    for (const personId of list) ids.add(personId);
  }
  return [...ids].sort();
}

function buildRelationsByPair(assertions) {
  const allByPair = new Map();
  const incomingByTo = new Map();
  const navigationByFrom = new Map();

  const addNavigation = (from, to, edge, traversalDirection) => {
    const neighbors = navigationByFrom.get(from) || new Map();
    const edges = neighbors.get(to) || [];
    edges.push({ ...edge, traversal_direction: traversalDirection });
    neighbors.set(to, edges);
    navigationByFrom.set(from, neighbors);
  };

  for (const row of assertions) {
    const subject = row.subject_person_id;
    const object = row.object_person_id;
    if (!subject || !object || subject === object) continue;

    const key = safePair(subject, object);
    const existing = allByPair.get(key) || [];
    existing.push({
      assertion_id: row.assertion_id,
      relation_type: row.relation_type || null,
      relation_subtype: row.relation_subtype || null,
      direction: row.direction || null,
      status: row.status || 'inactive'
    });
    allByPair.set(key, existing);

    if (String(row.status || '') !== 'active') continue;

    const edge = {
      from: subject,
      to: object,
      assertion_id: row.assertion_id,
      relation_type: row.relation_type || null,
      direction: row.direction || null
    };
    addNavigation(subject, object, edge, 'forward');
    addNavigation(object, subject, edge, 'reverse');
    const incoming = incomingByTo.get(edge.to) || new Map();
    const incomingFrom = incoming.get(edge.from) || [];
    incomingFrom.push(edge);
    incoming.set(edge.from, incomingFrom);
    incomingByTo.set(edge.to, incoming);

    if (row.direction === 'undirected') {
      const reverse = {
        from: object,
        to: subject,
        assertion_id: row.assertion_id,
        relation_type: row.relation_type || null,
        direction: row.direction || null
      };
      const incomingReverse = incomingByTo.get(reverse.to) || new Map();
      const incomingReverseFrom = incomingReverse.get(reverse.from) || [];
      incomingReverseFrom.push(reverse);
      incomingReverse.set(reverse.from, incomingReverseFrom);
      incomingByTo.set(reverse.to, incomingReverse);
    }
  }

  const summaries = new Map();
  for (const [pair, rows] of allByPair.entries()) {
    const statusSet = new Set(rows.map((row) => String(row.status || 'inactive')));
    const activeCount = rows.filter((row) => String(row.status || '') === 'active').length;
    let existingEdgeStatus = 'none';
    if (activeCount > 0) existingEdgeStatus = 'active_existing';
    else if (statusSet.has('inactive') || statusSet.has('superseded')) {
      existingEdgeStatus = statusSet.size > 1 ? 'mixed_inactive_states' : (statusSet.has('inactive') ? 'inactive_only' : 'superseded_only');
    }

    summaries.set(pair, {
      existing_edge_status: existingEdgeStatus,
      existing_edge_ids: rows.map((row) => row.assertion_id).sort(),
      active_count: activeCount,
      non_active_count: rows.length - activeCount,
      active_assertion_ids: rows.filter((row) => String(row.status || '') === 'active').map((row) => row.assertion_id).sort(),
      relation_types: [...new Set(rows.map((row) => row.relation_type).filter(Boolean))].sort(),
      statuses: [...statusSet].sort()
    });
  }

  return { summaries, incomingByTo, navigationByFrom };
}

function buildPathContextsForPair(subjectPersonId, objectPersonId, relationIndex, limit = PATH_LIMIT) {
  const a = subjectPersonId;
  const b = objectPersonId;
  const fromA = relationIndex.navigationByFrom.get(a);
  const fromB = relationIndex.navigationByFrom.get(b);
  if (!fromA || !fromB) return [];

  const seen = new Set();
  const rows = [];
  const reverseTraversal = (value) => value === 'forward' ? 'reverse' : 'forward';
  for (const [mid, firstEdges] of fromA.entries()) {
    if (mid === a || mid === b) continue;
    const bToMidEdges = fromB.get(mid);
    if (!bToMidEdges) continue;
    for (const first of firstEdges) {
      for (const bToMid of bToMidEdges) {
        const secondTraversal = reverseTraversal(bToMid.traversal_direction);
        const path = [a, mid, b];
        const pathKey = `${a}|${mid}|${b}|${first.assertion_id}|${first.traversal_direction}|${bToMid.assertion_id}|${secondTraversal}`;
        if (seen.has(pathKey)) continue;
        seen.add(pathKey);
        rows.push({
          path,
          path_length: 2,
          assertion_ids: [...new Set([first.assertion_id, bToMid.assertion_id])].sort(),
          relation_type_chain: [first.relation_type, bToMid.relation_type].filter(Boolean),
          via_assertions: {
            first: {
              assertion_id: first.assertion_id,
              relation_type: first.relation_type || null,
              direction: first.direction || null,
              traversal_direction: first.traversal_direction
            },
            second: {
              assertion_id: bToMid.assertion_id,
              relation_type: bToMid.relation_type || null,
              direction: bToMid.direction || null,
              traversal_direction: secondTraversal
            }
          }
        });
      }
    }
  }

  if (!rows.length) return [];

  return rows
    .sort((left, right) => left.path.join('|').localeCompare(right.path.join('|')))
    .slice(0, limit);
}

function detectRelationHints(text) {
  const normalized = normalizeWord(text).toLowerCase();
  const matched = [];
  for (const relationType of RELATION_TYPES) {
    const terms = CUE_TERMS[relationType] || [];
    const hasMatch = terms.some((term) => normalized.includes(normalizeWord(term).toLowerCase()));
    if (hasMatch) matched.push(relationType);
  }
  return matched;
}

function buildSnippet(text, maxLen = 300) {
  const clean = cleanText(text);
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function buildSourceSnapshot(manifest, people, names, mentions, assertions, fileInventories) {
  const stableRows = (rows) => [...rows].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  return {
    manifest_created_at: manifest.created_at,
    input_snapshot: {
      people_snapshot_sha256: sha256(stableRows(people).map(stableStringify).join('\n') + '\n'),
      names_snapshot_sha256: sha256(stableRows(names).map(stableStringify).join('\n') + '\n'),
      mentions_snapshot_sha256: sha256(stableRows(mentions).map(stableStringify).join('\n') + '\n'),
      assertions_snapshot_sha256: sha256(stableRows(assertions).map(stableStringify).join('\n') + '\n'),
      source_id: 'source:0003',
      source_text_license: 'public_domain',
      scope: 'bible_chinese_auxiliary',
      files: fileInventories
    }
  };
}

function buildReport(rows, manifest, candidatesByPairStats, outputPath, sourceSnapshot) {
  return {
    generated_at: manifest.created_at,
    manifest_created_at: manifest.created_at,
    dataset: 'direct-relationship-discovery',
    source_id: 'source:0003',
    source_snapshot: sourceSnapshot,
    snapshot_counts: {
      direct_candidate_rows: rows.length,
      direct_relation_rows: rows.reduce((sum, row) => sum + row.passages.length, 0),
      path_contexts_total: rows.reduce((sum, row) => sum + row.path_contexts.length, 0)
    },
    relation_type_counts: rows.reduce((acc, row) => {
      for (const relationType of row.relation_type_hypotheses) acc[relationType] = (acc[relationType] || 0) + 1;
      return acc;
    }, Object.fromEntries(RELATION_TYPES.map((type) => [type, 0]))),
    coverage: {
      cuv_passages: candidatesByPairStats.cuvPassages,
      passages_with_pn_tokens: candidatesByPairStats.passagesWithPnTokens,
      passages_with_accepted_persons: candidatesByPairStats.passagesWithAcceptedPersons,
      passages_with_hints: candidatesByPairStats.passagesWithHints,
      eligible_passages: candidatesByPairStats.eligiblePassages,
      candidate_covered_passages: candidatesByPairStats.candidateCoveredPassages,
      uncovered_eligible_passages: candidatesByPairStats.uncoveredEligiblePassages,
      mention_gate_blocked: candidatesByPairStats.mentionsGateBlocked,
      mention_gate_recovered: candidatesByPairStats.mentionGateRecovered,
      no_name_match: candidatesByPairStats.noNameMatch,
      total_hypotheses: candidatesByPairStats.totalHypotheses
    },
    invariant: {
      does_not_modify_assertions: true,
      does_not_publish_new_assertions: true,
      does_not_create_direct_edges: true,
      path_views_do_not_modify_graph: true,
      eligible_passage_coverage_complete: candidatesByPairStats.eligiblePassageCoverageComplete
    },
    output: {
      output_path: path.relative(ROOT, outputPath),
      row_snapshot_sha256: candidatesByPairStats.outputSnapshot
    },
    notes: [
      '路径条目（path_contexts）用于复核查看 A→B→C 结构，不做直接关系发布。',
      '候选边仅来自同一经文共现 + 关系触发词，不与现有 assertions 相加，不能直接入库。'
    ]
  };
}

function validateRows(rows, schema) {
  const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const errors = [];
  let previous = '';
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    if (!validate(row)) {
      for (const error of validate.errors || []) {
        errors.push(`row ${index + 1}: ${error.instancePath} ${error.message}`);
      }
    }
    const pair = `${row.subject_person_id}|${row.object_person_id}`;
    if (pair <= previous) errors.push(`rows not sorted at ${pair}`);
    if (seen.has(pair)) errors.push(`duplicate row ${pair}`);
    seen.add(pair);
    previous = pair;
  }

  if (errors.length) throw new Error(`direct relationship discovery validation failed (${errors.length}):\n${errors.slice(0, 100).join('\n')}`);
}

function main() {
  const cuvDir = parseArg('cuv-usfm-dir', DEFAULT_CUV_DIR);
  const outputPath = parseArg('output', OUTPUT_PATH);
  const reportPath = parseArg('report', REPORT_PATH);

  const manifest = readJson(MANIFEST_PATH);
  const people = readJsonl(PEOPLE_PATH);
  const names = readJsonl(NAMES_PATH);
  const mentions = readJsonl(MENTIONS_PATH);
  const assertions = readJsonl(ASSERTIONS_PATH);
  const sources = readJsonl(SOURCES_PATH);

  const sourceIds = new Set(sources.map((row) => row.source_id));
  if (!sourceIds.has('source:0003')) throw new Error('data/sources.jsonl 缺失 source:0003');

  const activePeople = new Set(people.filter((row) => row.status === 'accepted').map((row) => row.person_id));
  const nameIndex = buildNameIndex(names, activePeople, people);
  const acceptedMentionsByPassage = buildAcceptedMentionsByPassage(mentions, activePeople);
  const { passageText, pnByPassage, fileInventories } = readCuvUsfm(cuvDir);
  const relationIndex = buildRelationsByPair(assertions);
  const existingCandidateIdsByPair = new Map();
  let nextCandidateNumber = 1;
  if (fs.existsSync(REVIEW_PATH)) {
    for (const row of readJsonl(REVIEW_PATH)) {
      const pair = safePair(row.subject_person_id, row.object_person_id);
      const existingId = existingCandidateIdsByPair.get(pair);
      if (existingId && existingId !== row.candidate_relation_id) {
        throw new Error(`conflicting reviewed candidate ids for ${pair}: ${existingId}, ${row.candidate_relation_id}`);
      }
      existingCandidateIdsByPair.set(pair, row.candidate_relation_id);
      const match = /^drd-(\d+)$/.exec(String(row.candidate_relation_id || ''));
      if (match) nextCandidateNumber = Math.max(nextCandidateNumber, Number(match[1]) + 1);
    }
  }
  if (fs.existsSync(outputPath)) {
    for (const row of readJsonl(outputPath)) {
      const pair = safePair(row.subject_person_id, row.object_person_id);
      if (!existingCandidateIdsByPair.has(pair)) {
        existingCandidateIdsByPair.set(pair, row.candidate_relation_id);
      }
      const match = /^drd-(\d+)$/.exec(String(row.candidate_relation_id || ''));
      if (match) nextCandidateNumber = Math.max(nextCandidateNumber, Number(match[1]) + 1);
    }
  }

  const stats = {
    cuvPassages: 0,
    passagesWithPnTokens: 0,
    passagesWithAcceptedPersons: 0,
    passagesWithHints: 0,
    eligiblePassages: 0,
    candidateCoveredPassages: 0,
    uncoveredEligiblePassages: 0,
    eligiblePassageCoverageComplete: true,
    mentionGateBlocked: 0,
    mentionGateRecovered: 0,
    noNameMatch: 0,
    totalHypotheses: 0,
    outputSnapshot: ''
  };

  const buckets = new Map();
  const eligiblePassageCovered = new Set();
  for (const [passage, rawTokens] of pnByPassage.entries()) {
    stats.cuvPassages += 1;
    const gate = acceptedMentionGateForPassage(passage, acceptedMentionsByPassage);
    const passageTokens = [...new Set(rawTokens)];

    if (!passageTokens.length) continue;
    stats.passagesWithPnTokens += 1;

    const persons = matchPersonIdsByTokens(passageTokens, nameIndex);
    if (!persons.length) {
      stats.noNameMatch += 1;
      continue;
    }

    if (!gate?.size) {
      stats.mentionsGateBlocked += persons.length;
      continue;
    }

    const matchedPersonIds = new Set(persons);
    const acceptedInPassage = [...gate].sort();
    for (const personId of acceptedInPassage) {
      if (!matchedPersonIds.has(personId)) stats.mentionGateRecovered += 1;
    }

    if (acceptedInPassage.length < 2) continue;
    stats.passagesWithAcceptedPersons += 1;

    const passageTextRaw = cleanText(passageText.get(passage) || '');
    const clueTypes = detectRelationHints(passageTextRaw);
    const isEligiblePassage = gate.size >= 2 && clueTypes.length > 0;
    if (isEligiblePassage) {
      stats.eligiblePassages += 1;
    }
    if (!clueTypes.length) continue;
    stats.passagesWithHints += 1;
    stats.totalHypotheses += clueTypes.length;

    const snippet = buildSnippet(passageTextRaw);
    const passageHash = sha256(snippet);

    const normalizedPersonList = [...new Set(acceptedInPassage)].sort();
    for (let i = 0; i < normalizedPersonList.length; i += 1) {
      for (let j = i + 1; j < normalizedPersonList.length; j += 1) {
        const subject = normalizedPersonList[i];
        const object = normalizedPersonList[j];
        if (subject === object) continue;

        const pair = safePair(subject, object);
        const bucket = buckets.get(pair) || {
          subject_person_id: subject,
          object_person_id: object,
          relation_type_hypotheses: new Set(),
          passages: new Map(),
          path_contexts: []
        };
        clueTypes.forEach((type) => bucket.relation_type_hypotheses.add(type));

        if (!bucket.passages.has(passage)) {
          if (isEligiblePassage) {
            eligiblePassageCovered.add(passage);
          }
          bucket.passages.set(passage, {
            source_id: 'source:0003',
            passage,
            snippet,
            excerpt_hash: passageHash,
            matched_relation_hints: clueTypes.sort()
          });
        }

        buckets.set(pair, bucket);
      }
    }
  }

  const sourceSnapshot = buildSourceSnapshot(manifest, people, names, mentions, assertions, fileInventories);

  const rows = [...buckets.entries()]
    .map(([pair, bucket]) => {
      const relationSummary = relationIndex.summaries.get(pair) || {
        existing_edge_status: 'none',
        existing_edge_ids: [],
        active_count: 0,
        non_active_count: 0,
        active_assertion_ids: [],
        relation_types: [],
        statuses: []
      };

      const passages = [...bucket.passages.values()]
        .sort((a, b) => a.passage.localeCompare(b.passage))
        .map((passageRow) => ({
          source_id: passageRow.source_id,
          passage: passageRow.passage,
          snippet: passageRow.snippet,
          excerpt_hash: passageRow.excerpt_hash,
          evidence_level: NT_BOOKS.has(String(passageRow.passage).split(/\s+/)[0]) ? 'nt_text' : 'ot_text',
          matched_relation_hints: passageRow.matched_relation_hints,
          source_snapshot: 'source:0003-cuv-usfm'
        }));

        const pathContexts = buildPathContextsForPair(bucket.subject_person_id, bucket.object_person_id, relationIndex, PATH_LIMIT);

      let candidateRelationId = existingCandidateIdsByPair.get(pair);
      if (!candidateRelationId) {
        candidateRelationId = `drd-${String(nextCandidateNumber).padStart(6, '0')}`;
        nextCandidateNumber += 1;
      }
      return {
        candidate_relation_id: candidateRelationId,
        subject_person_id: bucket.subject_person_id,
        object_person_id: bucket.object_person_id,
        relation_type_hypotheses: [...bucket.relation_type_hypotheses].sort(),
        selected_relation_type: null,
        selected_relation_direction: null,
        passages,
        path_contexts: pathContexts,
        existing_edge_status: relationSummary.existing_edge_status,
        existing_edge_ids: relationSummary.existing_edge_ids,
        status: 'pending',
        created_at: manifest.created_at,
        source_snapshot: sourceSnapshot
      };
    })
    .sort((a, b) => `${a.subject_person_id}|${a.object_person_id}`.localeCompare(`${b.subject_person_id}|${b.object_person_id}`));

  const snapshot = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const rowSnapshotHash = sha256(snapshot);
  stats.outputSnapshot = rowSnapshotHash;
  stats.candidateCoveredPassages = eligiblePassageCovered.size;
  stats.uncoveredEligiblePassages = Math.max(0, stats.eligiblePassages - stats.candidateCoveredPassages);
  stats.eligiblePassageCoverageComplete = stats.uncoveredEligiblePassages === 0;

  const schema = readJson(SCHEMA_PATH);
  validateRows(rows, schema);

  const report = buildReport(rows, manifest, {
    ...stats,
    cuvPassages: stats.cuvPassages,
    passagesWithPnTokens: stats.passagesWithPnTokens,
    passagesWithAcceptedPersons: stats.passagesWithAcceptedPersons,
    passagesWithHints: stats.passagesWithHints,
    mention_gate_blocked: stats.mentionGateBlocked,
    mention_gate_recovered: stats.mentionGateRecovered,
    no_name_match: stats.noNameMatch,
    candidateCoveredPassages: stats.candidateCoveredPassages,
    uncoveredEligiblePassages: stats.uncoveredEligiblePassages,
    eligiblePassageCoverageComplete: stats.eligiblePassageCoverageComplete,
    mentionsGateBlocked: stats.mentionGateBlocked,
    mentionGateRecovered: stats.mentionGateRecovered,
    noNameMatch: stats.noNameMatch,
    totalHypotheses: stats.totalHypotheses,
    outputSnapshot: rowSnapshotHash
  }, outputPath, sourceSnapshot);
  if (!report.invariant.eligible_passage_coverage_complete) {
    throw new Error(`direct relationship discovery coverage invariant failed: ${stats.uncoveredEligiblePassages} uncovered eligible passages`);
  }

  if (CHECK) {
    if (!fs.existsSync(outputPath)) throw new Error(`missing output file: ${path.relative(ROOT, outputPath)}`);
    if (!fs.existsSync(reportPath)) throw new Error(`missing report file: ${path.relative(ROOT, reportPath)}`);

    const existingRows = fs.readFileSync(outputPath, 'utf8');
    if (existingRows !== snapshot) throw new Error('direct relationship discovery snapshot drift');

    const existingReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (existingReport.output?.row_snapshot_sha256 !== rowSnapshotHash) {
      throw new Error('direct relationship discovery report snapshot mismatch');
    }

    if (existingReport.snapshot_counts?.direct_candidate_rows !== rows.length) {
      throw new Error('direct relationship discovery report count mismatch');
    }

    if (String(existingReport.generated_at) !== String(manifest.created_at)) {
      throw new Error('direct relationship discovery report generated_at mismatch');
    }

    console.log(JSON.stringify({ status: 'ok', mode: 'check', direct_candidate_rows: rows.length, path_contexts: report.snapshot_counts.path_contexts_total }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, snapshot);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'ok', mode: 'generate', direct_candidate_rows: rows.length, path_contexts: report.snapshot_counts.path_contexts_total }, null, 2));
}

main();
