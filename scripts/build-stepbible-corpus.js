#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const argv = process.argv.slice(2);
const args = Object.create(null);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) {
    args[key] = next;
    i += 1;
  } else {
    args[key] = 'true';
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STEP_DIR = path.join(ROOT, '.sources', 'stepbible-data');
const DEFAULT_SBL_DIR = path.join(ROOT, '.sources', 'sblgnt');
const DEFAULT_OUT_DIR = path.join(ROOT, 'data');
const SEED_PATH = path.join(ROOT, 'editorial', 'relationship-seeds.jsonl');
const SEED_SCHEMA_PATH = path.join(ROOT, 'schemas', 'relationship-seeds.schema.json');
const SCOPE_OVERRIDE_PATH = path.join(ROOT, 'editorial', 'person-scope-overrides.jsonl');
const SCOPE_OVERRIDE_SCHEMA_PATH = path.join(ROOT, 'schemas', 'person-scope-overrides.schema.json');
const SPLIT_OVERRIDE_PATH = path.join(ROOT, 'editorial', 'person-split-overrides.jsonl');
const SPLIT_OVERRIDE_SCHEMA_PATH = path.join(ROOT, 'schemas', 'person-split-overrides.schema.json');
const NAME_OVERRIDE_PATH = path.join(ROOT, 'editorial', 'person-name-overrides.jsonl');
const NAME_OVERRIDE_SCHEMA_PATH = path.join(ROOT, 'schemas', 'person-name-overrides.schema.json');
const MENTION_OVERRIDE_PATH = path.join(ROOT, 'editorial', 'mention-verification-overrides.jsonl');
const MENTION_OVERRIDE_SCHEMA_PATH = path.join(ROOT, 'schemas', 'mention-verification-overrides.schema.json');
const SBL_AUDIT_REVIEW_PATH = path.join(ROOT, 'editorial', 'sblgnt-name-review.jsonl');
const SBL_AUDIT_REVIEW_SCHEMA_PATH = path.join(ROOT, 'schemas', 'sblgnt-name-review.schema.json');

const SOURCE_ID_STEP = 'source:0002';
const SOURCE_ID_SBL = 'source:0001';
const SOURCE_DIR = args['step-data-dir'] || args['step_data_dir'] || DEFAULT_STEP_DIR;
const SBL_DIR = args['sblgnt-dir'] || args['sblgnt_dir'] || DEFAULT_SBL_DIR;
const DATA_DIR = args['output-dir'] || args['output_dir'] || args.output || DEFAULT_OUT_DIR;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const manifestSnapshot = String(manifest.created_at || '').slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(manifestSnapshot)) {
  throw new Error('data/manifest.json must provide a deterministic created_at date');
}
const snapshot = args.snapshot || manifestSnapshot;
const includeNonNt = args['include-non-nt'] === 'true';
const includeNonHuman = args['include-non-human'] === 'true';
const ignoreRelationshipSeeds = args['ignore-relationship-seeds'] === 'true';
const seedSchema = JSON.parse(fs.readFileSync(SEED_SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
const seedValidator = ajv.compile(seedSchema);
const scopeOverrideValidator = ajv.compile(JSON.parse(fs.readFileSync(SCOPE_OVERRIDE_SCHEMA_PATH, 'utf8')));
const splitOverrideValidator = ajv.compile(JSON.parse(fs.readFileSync(SPLIT_OVERRIDE_SCHEMA_PATH, 'utf8')));
const nameOverrideValidator = ajv.compile(JSON.parse(fs.readFileSync(NAME_OVERRIDE_SCHEMA_PATH, 'utf8')));
const mentionOverrideValidator = ajv.compile(JSON.parse(fs.readFileSync(MENTION_OVERRIDE_SCHEMA_PATH, 'utf8')));
const sblAuditReviewValidator = ajv.compile(JSON.parse(fs.readFileSync(SBL_AUDIT_REVIEW_SCHEMA_PATH, 'utf8')));

const NT_BOOK_MAP = new Map([
  ['Mat', 'MAT'], ['Matt', 'MAT'], ['Mt', 'MAT'], ['Matthew', 'MAT'],
  ['Mark', 'MRK'], ['Mk', 'MRK'], ['Mc', 'MRK'], ['Mrk', 'MRK'], ['Ac', 'ACT'], ['Act', 'ACT'], ['Acts', 'ACT'],
  ['Luke', 'LUK'], ['Luk', 'LUK'], ['Lk', 'LUK'], ['Lu', 'LUK'], ['Joh', 'JHN'], ['Jn', 'JHN'], ['Jo', 'JHN'], ['Jhn', 'JHN'], ['John', 'JHN'],
  ['Rom', 'ROM'], ['Ro', 'ROM'], ['1Cor', '1CO'], ['2Cor', '2CO'], ['1Co', '1CO'], ['2Co', '2CO'],
  ['Gal', 'GAL'], ['Ga', 'GAL'], ['Eph', 'EPH'], ['Ep', 'EPH'], ['Php', 'PHP'], ['Phi', 'PHP'], ['Col', 'COL'],
  ['1Th', '1TH'], ['2Th', '2TH'], ['1Ti', '1TI'], ['2Ti', '2TI'], ['Tit', 'TIT'], ['Phm', 'PHM'],
  ['Heb', 'HEB'], ['He', 'HEB'], ['Jas', 'JAS'], ['Jam', 'JAS'], ['James', 'JAS'],
  ['1Pet', '1PE'], ['2Pet', '2PE'], ['1Pe', '1PE'], ['2Pe', '2PE'], ['Pe', '1PE'],
  ['1Jn', '1JN'], ['2Jn', '2JN'], ['3Jn', '3JN'], ['Jo1', '1JN'], ['Jo2', '2JN'], ['Jo3', '3JN'],
  ['Jude', 'JUD'], ['Jud', 'JUD'], ['Rev', 'REV'], ['Re', 'REV'], ['Rv', 'REV']
]);

const SBL_BOOK_ID_MAP = new Map([
  ['Matt', 'MAT'], ['Mark', 'MRK'], ['Luke', 'LUK'], ['John', 'JHN'], ['Acts', 'ACT'],
  ['Rom', 'ROM'], ['Cor', '1CO'], ['1Co', '1CO'], ['2Co', '2CO'], ['Gal', 'GAL'],
  ['Eph', 'EPH'], ['Php', 'PHP'], ['Col', 'COL'], ['Th', '1TH'], ['Ti', '1TI'],
  ['Tit', 'TIT'], ['Phm', 'PHM'], ['Heb', 'HEB'], ['Jas', 'JAS'], ['Pe', '1PE'],
  ['Jn', '1JN'], ['Jud', 'JUD'], ['Rev', 'REV'], ['1Corinthians', '1CO'], ['2Corinthians', '2CO'],
  ['1Cor', '1CO'], ['2Cor', '2CO'], ['Philippians', 'PHP'], ['Colossians', 'COL'],
  ['1Thessalonians', '1TH'], ['2Thessalonians', '2TH'], ['1Timothy', '1TI'], ['2Timothy', '2TI'],
  ['Philemon', 'PHM'], ['James', 'JAS'], ['1Peter', '1PE'], ['2Peter', '2PE'],
  ['1John', '1JN'], ['2John', '2JN'], ['3John', '3JN'], ['Revelation', 'REV']
]);
const NT_BOOK_SET = new Set([...NT_BOOK_MAP.values()]);

const EXCLUDED_TOP_LEVEL_KEYS = new Set([
  'queen_of_sheba',
  'pharaoh'
]);

const EXPLICIT_NON_PERSON_KEYS = new Set([
  'michael'
]);

const PLACEHOLDER_RELATION_PREFIXES = new Set([
  'father',
  'mother',
  'daughter',
  'son',
  'husband',
  'wife',
  'a_wife',
  'brother',
  'sister',
  'child',
  'parent',
  'spouse',
  'relative',
  'mother_in_law',
  'father_in_law',
  'son_in_law',
  'daughter_in_law'
]);

const SBL_GREEK_SCAN = 'step_lexicon_sbl_token_scan';
const SBL_FILE_STEM_MAP = new Map([
  ['Matt', 'MAT'], ['Mark', 'MRK'], ['Luke', 'LUK'], ['John', 'JHN'], ['Acts', 'ACT'],
  ['Rom', 'ROM'], ['1Cor', '1CO'], ['2Cor', '2CO'], ['Gal', 'GAL'], ['Eph', 'EPH'],
  ['Phil', 'PHP'], ['Col', 'COL'], ['1Thess', '1TH'], ['2Thess', '2TH'],
  ['1Tim', '1TI'], ['2Tim', '2TI'], ['Titus', 'TIT'], ['Phlm', 'PHM'],
  ['Philemon', 'PHM'], ['Heb', 'HEB'], ['Jas', 'JAS'], ['James', 'JAS'],
  ['1Pet', '1PE'], ['2Pet', '2PE'], ['1John', '1JN'], ['2John', '2JN'], ['3John', '3JN'],
  ['Jude', 'JUD'], ['Rev', 'REV']
]);
function unifiedBaseName(rawUnified) {
  const raw = String(rawUnified || '').trim();
  return normalizePersonName(raw).split('|')[0].split('@')[0].split('=')[0]
    .replace(/^[\d.\-]+\s*/, '')
    .trim();
}

function listFiles(dir, basenameMatch) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) continue;
    if (!basenameMatch || basenameMatch.test(file)) out.push(full);
  }
  return out;
}

function readFileText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeJsonl(filePath, rows) {
  const data = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${data}${rows.length > 0 ? '\n' : ''}`);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Failed to parse existing JSONL ${path.basename(filePath)}:${idx + 1}`);
    }
  });
}

function parseSeedPassage(passage) {
  if (typeof passage !== 'string') return null;
  const p = passage.trim();
  if (!/^[A-Z0-9]{3} \d+:\d+(?:-\d+)?$/.test(p)) return null;
  const [book] = p.split(' ');
  if (!NT_BOOK_SET.has(book)) return null;
  const [, bookNorm, chapter, verseRange] = p.match(/^([A-Z0-9]{3}) (\d+):(\d+(?:-\d+)?)$/);
  if (!bookNorm || !NT_BOOK_SET.has(bookNorm)) return null;
  if (!chapter || Number.isNaN(Number(chapter))) return null;
  const endChapter = Number(verseRange.split('-')[0]);
  if (!Number.isFinite(endChapter) || endChapter <= 0) return null;
  return p;
}

function parseSeedEvidence(evidenceRow) {
  if (!Array.isArray(evidenceRow) || evidenceRow.length < 1) {
    throw new Error('seed evidence must be a non-empty array');
  }
  return evidenceRow.map((item) => {
    const evidence = { ...item };
    if (!evidence || typeof evidence !== 'object') {
      throw new Error('seed evidence item must be an object');
    }
    if (evidence.evidence_level === 'nt_text') {
      const normalizedPassage = parseSeedPassage(evidence.passage);
      if (!normalizedPassage) throw new Error(`seed passage invalid: ${evidence.passage}`);
      evidence.passage = normalizedPassage;
    } else if (evidence.evidence_level === 'ancient_text') {
      if (evidence.source_id !== 'source:0004' || !/^Josephus, Antiquities 18\.116-119$/.test(evidence.passage)) {
        throw new Error(`ancient seed locator invalid: ${evidence.passage}`);
      }
    } else {
      throw new Error(`unsupported seed evidence level: ${evidence.evidence_level}`);
    }
    return evidence;
  });
}

function parseSeedRows(seedPath) {
  const raw = fs.readFileSync(seedPath, 'utf8');
  if (!raw.trim()) return [];
  const lines = raw.split('\n');
  const seen = new Set();
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let seed;
    try {
      seed = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid relationship seed JSON at line ${i + 1}: ${err.message}`);
    }
    if (!seedValidator(seed)) {
      const detail = (seedValidator.errors || [])
        .map((e) => `${e.instancePath || '/'} ${e.message || e.keyword}`)
        .join('; ');
      throw new Error(`Invalid relationship seed at line ${i + 1}: ${detail || 'schema validation failed'}`);
    }
    const sid = String(seed.seed_id || '').trim();
    if (!/^seed-rs-\d{4}$/.test(sid)) {
      throw new Error(`Invalid seed_id ${sid || '(missing)'}`);
    }
    if (seen.has(sid)) {
      throw new Error(`Duplicate seed_id ${sid}`);
    }
    seen.add(sid);
    const subjectPerson = String(seed.subject_person_id || '');
    const objectPerson = String(seed.object_person_id || '');
    const validPersonId = (value) => /^(?:person-\d{6}|nt-people-\d{4})$/.test(value);
    if (!validPersonId(subjectPerson) || !validPersonId(objectPerson)) {
      throw new Error(`Invalid person ids in seed ${sid}`);
    }
    if (subjectPerson === objectPerson) {
      throw new Error(`Seed self-loop detected in ${sid}`);
    }
    const evidence = parseSeedEvidence(seed.evidence);
    out.push({
      ...seed,
      evidence
    });
  }
  return out;
}

function parseScopeOverrides() {
  const rows = readJsonl(SCOPE_OVERRIDE_PATH);
  const byKey = new Map();
  for (const [index, row] of rows.entries()) {
    if (!scopeOverrideValidator(row)) {
      const detail = (scopeOverrideValidator.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      throw new Error(`Invalid person scope override at row ${index + 1}: ${detail}`);
    }
    if (byKey.has(row.person_key)) throw new Error(`Duplicate person scope override: ${row.person_key}`);
    byKey.set(row.person_key, row);
  }
  return byKey;
}

function parsePersonSplitOverrides() {
  const rows = readJsonl(SPLIT_OVERRIDE_PATH);
  const byKey = new Map();
  for (const [index, row] of rows.entries()) {
    if (!splitOverrideValidator(row)) {
      const detail = (splitOverrideValidator.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      throw new Error(`Invalid person split override at row ${index + 1}: ${detail}`);
    }
    if (byKey.has(row.person_key)) throw new Error(`Duplicate person split override: ${row.person_key}`);
    byKey.set(row.person_key, row);
  }
  return byKey;
}

function parsePersonNameOverrides() {
  const rows = readJsonl(NAME_OVERRIDE_PATH);
  const byKey = new Map();
  for (const [index, row] of rows.entries()) {
    if (!nameOverrideValidator(row)) {
      const detail = (nameOverrideValidator.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      throw new Error(`Invalid person name override at row ${index + 1}: ${detail}`);
    }
    if (byKey.has(row.person_key)) throw new Error(`Duplicate person name override: ${row.person_key}`);
    byKey.set(row.person_key, row);
  }
  return byKey;
}

function parseMentionVerificationOverrides() {
  const rows = readJsonl(MENTION_OVERRIDE_PATH);
  const byKey = new Map();
  for (const [index, row] of rows.entries()) {
    if (!mentionOverrideValidator(row)) {
      const detail = (mentionOverrideValidator.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      throw new Error(`Invalid mention verification override at row ${index + 1}: ${detail}`);
    }
    const key = `${row.person_key}\u0000${row.passage}`;
    if (byKey.has(key)) throw new Error(`Duplicate mention verification override: ${row.person_key} ${row.passage}`);
    byKey.set(key, row);
  }
  return byKey;
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function padNum(i) {
  return String(i).padStart(4, '0');
}

function normalizeToken(token) {
  return String(token || '')
    .replace(/^\uFEFF/, '')
    .replace(/[()\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUnicodeText(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/\u200d/g, '')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function normalizePersonName(raw) {
  return String(raw || '')
    .replace(/\(.*?\)/g, '')
    .replace(/^\s*>\s*/, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBook(abbr) {
  const token = String(abbr || '').replace('.', '').trim();
  const direct = NT_BOOK_MAP.get(token);
  return direct || NT_BOOK_MAP.get(`${token}.`) || null;
}

function parseReference(rawRef) {
  if (!rawRef) return null;
  let token = normalizeBookRef(rawRef).replace(/[\s,;]+/g, '');
  if (!token.includes('.')) return null;
  token = token.replace(/-[·•\d]$/g, '');
  const m = token.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+[a-z]?)$/i);
  if (!m) return null;
  const verseWithSuffix = m[3];
  const bookNorm = normalizeBook(m[1]);
  if (!bookNorm || !NT_BOOK_SET.has(bookNorm)) return null;
  const verseNum = Number(verseWithSuffix.replace(/[a-z]$/i, ''));
  if (!Number.isFinite(verseNum) || verseNum <= 0) return null;
  return {
    raw: token,
    book: bookNorm,
    passage: `${bookNorm} ${Number(m[2])}:${verseNum}`,
    key: `${bookNorm} ${Number(m[2])}:${verseNum}`
  };
}

function normalizeBookRef(rawRef) {
  return String(rawRef || '')
    .replace(/^LXX\s*/i, '')
    .replace(/[\s]+/g, '')
    .replace(/ff$/i, '')
    .replace(/-[A-Za-z]+$/i, '')
    .replace(/[\u200b-\u200d]/g, '')
    .trim();
}

function parseTopRecordRef(rawRef) {
  const token = normalizeBookRef(rawRef);
  const m = token.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)([a-z]?)$/i);
  if (!m) return null;
  const bookNorm = normalizeBook(m[1]);
  if (!bookNorm || !NT_BOOK_SET.has(bookNorm)) return null;
  return {
    raw: token,
    book: bookNorm,
    passage: `${bookNorm} ${Number(m[2])}:${Number(m[3])}`,
    key: `${bookNorm} ${Number(m[2])}:${Number(m[3])}`
  };
}

function parseSblVerseRefFromLine(raw, defaultBook) {
  const line = String(raw || '').trim().replace(/[\u200d]/g, '');
  if (!line) return null;
  const mWithBook = line.match(/^(.+?)\s+(\d+):(\d+[a-z]?)$/);
  if (mWithBook) {
    const bookNorm = normalizeBook(mWithBook[1]) || defaultBook;
    if (bookNorm) {
      return {
        book: bookNorm,
        passage: `${bookNorm} ${Number(mWithBook[2])}:${Number(mWithBook[3].replace(/[a-z]$/i, ''))}`,
        key: `${bookNorm} ${Number(mWithBook[2])}:${Number(mWithBook[3].replace(/[a-z]$/i, ''))}`
      };
    }
  }
  const mNoBook = line.match(/^(\d+):(\d+[a-z]?)$/);
  if (!mNoBook || !defaultBook) return null;
  return {
    book: defaultBook,
    passage: `${defaultBook} ${Number(mNoBook[1])}:${Number(mNoBook[2].replace(/[a-z]$/i, ''))}`,
    key: `${defaultBook} ${Number(mNoBook[1])}:${Number(mNoBook[2].replace(/[a-z]$/i, ''))}`
  };
}

function isPlaceholderTopLevel(rawUnified) {
  const base = String(rawUnified || '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .trim()
    .toLowerCase();
  if (!base) return false;
  const normalizedBase = base.replace(/\s+/g, '_');
  if (normalizedBase.startsWith('unnamed#')) return true;
  if (!/_of_/.test(normalizedBase)) return false;
  const relBase = normalizedBase
    .split('_of_')[0]
    .replace(/^the_/, '')
    .replace(/\d+$/g, '');
  return PLACEHOLDER_RELATION_PREFIXES.has(relBase);
}

function isPlaceholderTopLevelDescription(rawUnified) {
  return isPlaceholderTopLevel(rawUnified);
}

function isExplicitTopLevelName(rawUnified) {
  if (!rawUnified || rawUnified.startsWith('@')) return false;
  const atIndex = String(rawUnified).indexOf('@');
  if (atIndex <= 0) return false;
  const nameKey = normalizePersonName(rawUnified.slice(0, atIndex)).toLowerCase().trim();
  if (!nameKey) return false;
  const canonicalBase = nameKey.split('|')[0].trim();
  const normalizedBase = canonicalBase.replace(/\s+/g, '_');
  if (normalizedBase === 'pharaoh' || normalizedBase.startsWith('pharaoh_') || normalizedBase === 'queen_of_sheba') {
    return false;
  }
  if (isPlaceholderTopLevel(rawUnified)) return false;
  if (EXCLUDED_TOP_LEVEL_KEYS.has(canonicalBase.replace(/\s+/g, '_'))) return false;
  if (EXPLICIT_NON_PERSON_KEYS.has(canonicalBase)) return false;
  return true;
}

function parseRefsFromText(raw) {
  if (!raw) return [];
  const out = [];
  for (const p of String(raw).split(/[;,\n]/)) {
    for (const item of p.split(/\s+[-–]\s*/).map((x) => x.trim()).filter(Boolean)) {
      const ref = parseReference(item);
      if (ref) out.push(ref);
    }
  }
  return out;
}

function splitRelationItems(raw) {
  if (!raw) return [];
  return String(raw).split(/\s+\+\s*|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
}

function parseSubrecord(line) {
  if (!line.startsWith('–')) return null;
  const cols = line.split('\t');
  if (cols.length < 3) return null;
  const significance = normalizeToken(cols[0].replace(/^–\s*/, ''));
  if (significance.toLowerCase() === 'total') return null;
  const rawName = normalizeToken(cols[1] || '');
  const translated = normalizeToken(cols[3] || '');
  const formText = normalizeToken(cols[2] || '');
  const formMatch = /«[^=]*=(.+)$/.exec(formText);
  const formName = formMatch ? normalizeToken(formMatch[1]) : '';
  const canonicalBase = normalizePersonName(formName || translated || rawName);
  if (!canonicalBase) return null;
  const nameText = canonicalBase;
  if (!significance || !nameText) return null;
  const allRefs = normalizeToken(cols[5] || '');
  const refs = parseRefsFromText(allRefs).filter((r) => r && r.book);
  let language = 'en';
  let scope = 'alias';
  let status = 'accepted';
  const sig = significance.toLowerCase();
  if (isGreekLike(formName)) language = 'grc';
  if (isHebrewLike(formName) || isHebrewLike(rawName) || isHebrewLike(translated)) language = 'hbo';
  if (sig === 'named') {
    scope = 'canonical';
  } else if (sig === 'greek') {
    language = 'grc';
    scope = 'alias';
  } else if (sig.includes('archaic') || sig.includes('hebrew')) {
    language = 'en';
    scope = 'variant';
  } else if (sig.includes('spelled') || sig.includes('variant')) {
    scope = 'variant';
  }
  if (!refs.length) status = 'pending';
  return {
    significance: sig,
    rawName,
    aliasKey: canonicalPersonLabel(rawName).toLowerCase(),
    text: nameText,
    language,
    sourceScope: scope,
    status,
    refs,
    ntRefCount: refs.length
  };
}

function parsePersonRelationship(raw) {
  const out = [];
  if (!raw) return out;
  for (const item of splitRelationItems(raw)) {
    const uncertain = /\(\?\)/.test(item);
    const normalized = normalizePersonName(item);
    if (!normalized) continue;
    const nameRef = normalized.split('@')[0].trim();
    const relTail = normalized.includes('@') ? normalized.split('@').slice(1).join('@') : '';
    const relationRefs = parseRefsFromText(relTail);
    out.push({
      key: normalizePersonName(nameRef),
      uncertain,
      raw: item,
      refs: relationRefs
    });
  }
  return out;
}

function stepIdentityKey(raw) {
  return normalizePersonName(raw)
    .replace(/=\S+$/, '')
    .replace(/\?+$/, '')
    .trim()
    .toLowerCase();
}

function canonicalPersonLabel(raw) {
  return String(raw || '')
    .split('@')[0]
    .split('=')[0]
    .split('|')[0]
    .replace(/=[A-Za-z]+\d+[a-zA-Z]?/g, '')
    .replace(/«[^=]*=[^«»]*»/g, '')
    .replace(/^[\s\-\d]+/, '')
    .replace(/^[\u200d\ufeff]/g, '')
    .trim();
}

function isGreekLike(raw) {
  return /\p{Script=Greek}/u.test(String(raw || ''));
}

function isHebrewLike(raw) {
  return /\p{Script=Hebrew}/u.test(String(raw || ''));
}

function extractGreekNameForms(raw) {
  return [...new Set((String(raw || '').match(/\p{Script=Greek}[\p{Script=Greek}\p{M}]*/gu) || [])
    .map((x) => normalizeUnicodeText(x))
    .filter((x) => x.length > 1))];
}

function greekNameStem(raw) {
  const token = normalizeUnicodeText(raw).replace(/\s+/g, '');
  if (!token || !/^\p{Script=Greek}+$/u.test(token)) return token;
  const endings = ['ους', 'εως', 'ιος', 'αιος', 'ου', 'ος', 'ον', 'ω', 'ης', 'ην', 'ας', 'αν', 'ια', 'ις', 'ιν', 'α', 'η', 'ι', 'ε'];
  for (const ending of endings) {
    if (token.endsWith(ending) && token.length - ending.length >= 3) {
      return token.slice(0, -ending.length);
    }
  }
  return token;
}

function greekNameMatchesVerse(token, verseText) {
  if (!token || !verseText) return false;
  const words = String(verseText)
    .match(/\p{Script=Greek}[\p{Script=Greek}\p{M}]*/gu)
    ?.map((word) => normalizeUnicodeText(word)) || [];
  const tokenStem = greekNameStem(token);
  return words.some((word) => {
    if (word === token) return true;
    const wordStem = greekNameStem(word);
    if (!tokenStem || !wordStem || tokenStem.length < 3 || wordStem.length < 3) return false;
    if (tokenStem === wordStem) return true;
    const shorter = tokenStem.length <= wordStem.length ? tokenStem : wordStem;
    const longer = tokenStem.length > wordStem.length ? tokenStem : wordStem;
    return shorter.length >= 4 && longer.startsWith(shorter) && longer.length - shorter.length <= 2;
  });
}

function inferSex(typeField) {
  if (!typeField) return 'unknown';
  const t = String(typeField).toLowerCase();
  if (t === 'male') return 'male';
  if (t === 'female') return 'female';
  return 'unknown';
}

function humanLikeType(typeField) {
  if (!typeField) return true;
  const t = String(typeField).toLowerCase();
  return t === 'male' || t === 'female';
}

function findStepFile(dir) {
  const targetDir = path.join(dir, 'Proper Nouns');
  if (!fs.existsSync(targetDir)) return null;
  const candidates = listFiles(targetDir, /TIPNR.*Proper Names/i);
  return candidates.sort((a, b) => a.localeCompare(b))[0] || null;
}

function buildSblReferenceSet(sblDir) {
  const textDirs = [path.join(sblDir, 'data', 'sblgnt', 'text')];
  const xmlDirs = [
    path.join(sblDir, 'data', 'sblgntapp', 'xml'),
    path.join(sblDir, 'data', 'sblgnt', 'xml')
  ];
  const refs = new Set();
  const bookOrder = new Set();
  const verseTextByRef = new Map();
  const files = [];
  const textFiles = [];
  for (const textDir of textDirs) {
    if (!fs.existsSync(textDir)) continue;
    for (const file of fs.readdirSync(textDir).filter((f) => f.toLowerCase().endsWith('.txt') && !f.startsWith('.'))) {
      textFiles.push(path.join(textDir, file));
    }
  }
  for (const file of textFiles) {
    const stem = path.parse(file).name;
    const defaultBook = SBL_FILE_STEM_MAP.get(stem);
    if (!defaultBook || !NT_BOOK_SET.has(defaultBook)) continue;
    bookOrder.add(defaultBook);
    for (const rawLine of readFileText(file).split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, '').trim();
      if (!line.includes('\t')) continue;
      const tab = line.indexOf('\t');
      const verseRef = parseSblVerseRefFromLine(line.slice(0, tab), defaultBook);
      if (!verseRef) continue;
      refs.add(verseRef.key);
      verseTextByRef.set(verseRef.key, normalizeUnicodeText(line.slice(tab + 1)));
    }
  }
  if (textFiles.length) return { refs, bookOrder, verseTextByRef };

  for (const xmlDir of xmlDirs) {
    if (!fs.existsSync(xmlDir)) continue;
    for (const file of fs.readdirSync(xmlDir).filter((f) => f.toLowerCase().endsWith('.xml') && !f.startsWith('.'))) {
      files.push(path.join(xmlDir, file));
    }
  }
  if (!files.length) return { refs, bookOrder, verseTextByRef };

  for (const file of files) {
    const text = readFileText(file);
    const stem = path.parse(file).name;
    let osis = SBL_FILE_STEM_MAP.get(stem);
    if (!osis) {
      const bookNameMatch = text.match(/<book-name>\s*([^<]+?)\s*<\/book-name>/i);
      if (bookNameMatch) {
        osis = NT_BOOK_MAP.get(normalizePersonName(bookNameMatch[1]).replace(/\s+/g, ''));
      }
    }
    if (!NT_BOOK_SET.has(osis)) continue;
    bookOrder.add(osis);

    const verseTagRe = /<verse>(.*?)<\/verse>/g;
    const verseTags = [];
    let hit;
    while ((hit = verseTagRe.exec(text))) {
      verseTags.push({ raw: hit[1], start: hit.index + hit[0].length });
    }
    for (let i = 0; i < verseTags.length; i += 1) {
      const verseRef = parseSblVerseRefFromLine(verseTags[i].raw, osis);
      if (!verseRef || !verseRef.book) continue;
      const key = verseRef.key;
      refs.add(key);
      const end = i + 1 < verseTags.length ? verseTags[i + 1].start : text.length;
      const rawChunk = text.slice(verseTags[i].start, end);
      const verseText = normalizeUnicodeText((rawChunk || '').replace(/<[^>]+>/g, ' '));
      const previous = verseTextByRef.get(key);
      verseTextByRef.set(key, previous ? `${previous} ${verseText}` : verseText);
    }
  }
  return { refs, bookOrder, verseTextByRef };
}

function buildSblLexiconScan(records, sbl) {
  const buildTimestamp = snapshot.includes('T') ? snapshot : `${snapshot}T00:00:00Z`;
  const report = {
    method: SBL_GREEK_SCAN,
    generatedAt: buildTimestamp,
    total_records: records.length,
    checked_refs: 0,
    matched_refs: 0,
    unmatched_refs: 0,
    uncheckable_refs: 0,
    ambiguous_refs: 0,
    person_status: {
      matched: 0,
      partial: 0,
      pending: 0
    },
    ambiguous_examples: []
  };

  const tokenToPersons = new Map();
  const stemToPersons = new Map();
  const personToTokens = new Map();
  for (const person of records) {
    const tokens = [];
    for (const sr of person.subrecords) {
      if (sr.entityKind !== 'person' || sr.language !== 'grc' || !sr.text) continue;
      for (const token of extractGreekNameForms(sr.text)) {
        tokens.push(token);
        if (!tokenToPersons.has(token)) tokenToPersons.set(token, []);
        if (!tokenToPersons.get(token).includes(person.unifiedRaw)) tokenToPersons.get(token).push(person.unifiedRaw);
        const stem = greekNameStem(token);
        if (!stemToPersons.has(stem)) stemToPersons.set(stem, []);
        if (!stemToPersons.get(stem).includes(person.unifiedRaw)) stemToPersons.get(stem).push(person.unifiedRaw);
      }
    }
    if (tokens.length) {
      personToTokens.set(person, [...new Set(tokens)]);
    }
  }

  const sblPersons = [];
  const seenPerson = new Set();
  const entries = [];

  for (const person of records) {
    const tokens = personToTokens.get(person) || [];
    const refs = collectRefs(person).filter((r) => r && r.book);
    const matchedPassages = [];
    const unmatchedPassages = [];
    const uncheckablePassages = [];

    if (!tokens.length || !refs.length) {
      report.person_status.pending += 1;
      entries.push({
        person_key: person.unifiedRaw,
        latinized: person.unifiedName,
        greek_tokens: tokens,
        checked_passages: [],
        matched_passages: [],
        unmatched_passages: [],
        uncheckable_passages: refs.map((ref) => ref.key),
        status: 'pending',
        classification: tokens.length ? 'no_checkable_reference' : 'no_greek_name_form',
        notes: tokens.length ? 'No SBLGNT verse text was available for the STEP references.' : 'STEP supplies no Greek person-name form for automated SBLGNT matching.'
      });
      continue;
    }

    let matchedAny = false;
    let ambiguousCount = 0;

    for (const ref of refs) {
      const verseText = sbl.verseTextByRef.get(ref.key);
      if (!verseText) {
        report.uncheckable_refs += 1;
        uncheckablePassages.push(ref.key);
        continue;
      }

      report.checked_refs += 1;
      const hitTokens = tokens.filter((token) => greekNameMatchesVerse(token, verseText));
      if (!hitTokens.length) {
        report.unmatched_refs += 1;
        unmatchedPassages.push(ref.key);
        continue;
      }

      matchedAny = true;
      report.matched_refs += 1;
      matchedPassages.push(ref.key);
      const hitPersonSet = new Set();
      for (const token of hitTokens) {
        const names = [
          ...(tokenToPersons.get(token) || []),
          ...(stemToPersons.get(greekNameStem(token)) || [])
        ];
        for (const n of names) hitPersonSet.add(n);
      }
      if (hitPersonSet.size > 1) {
        ambiguousCount += 1;
        report.ambiguous_refs += 1;
        report.ambiguous_examples.push({
          passage: ref.key,
          persons: Array.from(hitPersonSet).sort(),
          token: hitTokens.join(' | ')
        });
      }
    }

    if (matchedAny && ambiguousCount === 0) {
      report.person_status.matched += 1;
    } else if (matchedAny) {
      report.person_status.partial += 1;
    } else {
      report.person_status.pending += 1;
    }

    entries.push({
      person_key: person.unifiedRaw,
      latinized: person.unifiedName,
      greek_tokens: tokens,
      checked_passages: [...new Set([...matchedPassages, ...unmatchedPassages])],
      matched_passages: [...new Set(matchedPassages)],
      unmatched_passages: [...new Set(unmatchedPassages)],
      uncheckable_passages: [...new Set(uncheckablePassages)],
      status: matchedAny ? 'accepted' : 'pending',
      classification: matchedAny ? (ambiguousCount ? 'matched_with_lexical_ambiguity' : 'matched') : 'unmatched',
      notes: matchedAny
        ? 'At least one STEP-attributed occurrence matches a Greek person-name form in the locked SBLGNT verse text.'
        : 'No supplied Greek person-name form matched at the STEP-attributed SBLGNT passages; retained for explicit editorial follow-up.'
    });

    if (matchedAny && !seenPerson.has(person.unifiedName)) {
      sblPersons.push(person.unifiedName);
      seenPerson.add(person.unifiedName);
    }
  }

  return {
    sblPersons,
    entries,
    report: {
      ...report,
      ambiguous_examples: report.ambiguous_examples.slice(0, 30),
      notes: 'Conservative, STEP-lexicon-assisted scan over the NT-scoped person records. This is not independent full NER; every record receives an explicit accepted or pending audit row.'
    }
  };
}

function loadSblAuditReview() {
  if (!fs.existsSync(SBL_AUDIT_REVIEW_PATH)) return null;
  const raw = readJsonl(SBL_AUDIT_REVIEW_PATH);
  if (!raw.length) return null;
  const map = new Map();
  for (const [index, row] of raw.entries()) {
    if (!sblAuditReviewValidator(row)) {
      const detail = (sblAuditReviewValidator.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      throw new Error(`Invalid SBL audit review row ${index + 1}: ${detail}`);
    }
    const key = row.person_key;
    if (!key || map.has(key)) throw new Error(`Invalid or duplicate SBL audit review row for ${key || 'unknown'}`);
    if (typeof row.final_status !== 'string' || !['accepted', 'pending', 'excluded'].includes(row.final_status)) {
      throw new Error(`Invalid final_status in SBL audit review row for ${key}`);
    }
    map.set(key, row);
  }
  return map;
}

function applySblAuditToScanEntries(scanEntries, auditReviewMap) {
  if (!auditReviewMap) return scanEntries;
  const scanKeys = new Set(scanEntries.map((entry) => String(entry.person_key || '').trim()).filter(Boolean));
  const reviewedEntries = scanEntries.filter((entry) => auditReviewMap.has(entry.person_key));
  const reviewKeys = [...auditReviewMap.keys()].filter((key) => scanKeys.has(key)).sort();
  const unresolvedKeys = [...new Set(reviewedEntries
    .map((entry) => String(entry.person_key || '').trim())
    .filter(Boolean))].sort();
  if (unresolvedKeys.length !== reviewKeys.length || unresolvedKeys.join('\u0000') !== reviewKeys.join('\u0000')) {
    const missingFromEntries = reviewKeys.filter((k) => !unresolvedKeys.includes(k));
    const extraEntries = unresolvedKeys.filter((k) => !reviewKeys.includes(k));
    const reviewedCount = reviewedEntries.length;
    const uniqueReviewedCount = unresolvedKeys.length;
    throw new Error([
      'SBL audit review must exactly cover the externally reviewed SBL rows',
      `review map rows: ${reviewKeys.length} (size ${reviewKeys.length})`,
      `reviewed scan rows total: ${reviewedCount}, unique keys: ${uniqueReviewedCount}`,
      `missing in scan: ${missingFromEntries.join(', ') || '(none)'}`,
      `extra in scan: ${extraEntries.join(', ') || '(none)'}`,
    ].join('\n'));
  }
  return scanEntries.map((entry) => {
    const row = auditReviewMap.get(entry.person_key);
    if (!row) return entry;
    const mappedStatus = row.final_status === 'excluded' ? 'excluded' : row.final_status;
    const reviewedPassage = row.sbl_passage;
    const matchedPassages = mappedStatus === 'accepted'
      ? [...new Set([...(entry.matched_passages || []), reviewedPassage])]
      : [...new Set(entry.matched_passages || [])];
    const unmatchedPassages = mappedStatus === 'accepted'
      ? [...new Set(entry.unmatched_passages || [])].filter((passage) => passage !== reviewedPassage)
      : [...new Set(entry.unmatched_passages || [])];
    return {
      ...entry,
      status: mappedStatus,
      classification: mappedStatus === 'accepted'
        ? 'independently_verified_surface_identity'
        : mappedStatus === 'excluded'
          ? 'independently_rejected_identity'
          : entry.classification,
      notes: row.final_decision_note ? `${entry.notes} | SBL review: ${row.final_decision_note}` : entry.notes,
      checked_passages: [...new Set([...(entry.checked_passages || []), ...(row.scan_checked_passages || [])])],
      matched_passages: matchedPassages,
      unmatched_passages: unmatchedPassages,
      uncheckable_passages: [...new Set([...(entry.uncheckable_passages || []), ...(row.scan_uncheckable_passages || [])])]
    };
  });
}

function applyConservativeReplacementAudit(scanEntries, splitOverrides, auditReviewMap, sbl) {
  if (!auditReviewMap) return scanEntries;
  const replacementByKey = new Map();
  for (const override of splitOverrides.values()) {
    for (const partition of override.partitions || []) {
      if (!partition.unified_raw) continue;
      const rejectedIdentity = auditReviewMap.get(override.person_key);
      if (rejectedIdentity?.final_status !== 'excluded') continue;
      const passage = rejectedIdentity.sbl_passage;
      if (!partition.refs.includes(passage)) continue;
      const verse = normalizeUnicodeText(sbl.verseTextByRef.get(passage) || '');
      const surface = normalizeUnicodeText(rejectedIdentity.sbl_surface_form || '');
      if (!surface || !verse.includes(surface)) continue;
      replacementByKey.set(partition.unified_raw, { passage, sourceKey: override.person_key });
    }
  }
  return scanEntries.map((entry) => {
    const replacement = replacementByKey.get(entry.person_key);
    if (!replacement) return entry;
    return {
      ...entry,
      status: 'accepted',
      classification: 'identity_replacement_from_rejected_equivalence',
      matched_passages: [...new Set([...(entry.matched_passages || []), replacement.passage])],
      unmatched_passages: [...new Set(entry.unmatched_passages || [])].filter((passage) => passage !== replacement.passage),
      notes: `${entry.notes} | Conservative replacement: ${replacement.sourceKey} was independently rejected as the historical identity, while the locked SBLGNT explicitly names the distinct NT person at ${replacement.passage}.`
    };
  });
}

function parseStepPersons(filePath) {
  const text = readFileText(filePath);
  const lines = text.split(/\r?\n/);
  const people = [];
  let mode = false;
  let current = null;
  const skipTopLevel = (raw, reason, type) => {
    if (!raw) {
      current = null;
      return;
    }
    const unified = unifiedBaseName(raw);
    const skipped = {
      unifiedRaw: raw,
      unifiedName: unified || raw,
      unifiedKey: canonicalPersonLabel(unified || raw).toLowerCase(),
      type: type || 'Male',
      skip_reason: reason,
      subrecords: [],
      _skipForType: true
    };
    people.push(skipped);
    current = skipped;
  };

  for (const line of lines) {
    const l = normalizeToken(line);
    if (!l) continue;
    if (l.startsWith('$========== PERSON')) {
      mode = true;
      current = null;
      continue;
    }
    if (!mode) continue;
    if (l.startsWith('$========== PLACE') || l.startsWith('$========== OTHER')) {
      break;
    }
    if (l.startsWith('–')) {
      if (!current) continue;
      const parsed = parseSubrecord(line);
      if (parsed) {
        const previous = current.subrecords[current.subrecords.length - 1];
        if (parsed.significance === 'group') {
          parsed.entityKind = 'group';
        } else if (parsed.significance === 'mentioned') {
          parsed.entityKind = 'non_name_mention';
        } else if (parsed.significance.includes('form (')) {
          parsed.entityKind = 'non_person_form';
        } else if (parsed.significance.includes('same form as previous')) {
          parsed.entityKind = previous?.entityKind || 'person';
        } else if (
          previous
          && previous.entityKind !== 'person'
          && previous.aliasKey
          && previous.aliasKey === parsed.aliasKey
        ) {
          parsed.entityKind = previous.entityKind;
        } else {
          parsed.entityKind = 'person';
        }
        current.subrecords.push(parsed);
      }
      continue;
    }
    if (!line.includes('\t')) continue;
    const cols = line.split('\t');
    if (cols[0].startsWith('$==========')) continue;

    if (!isExplicitTopLevelName(cols[0])) {
      const typeField = normalizeToken(cols[8] || '');
      const canonicalBase = canonicalPersonLabel(cols[0]).toLowerCase().replace(/\s+/g, '_');
      const placeholderReason = isPlaceholderTopLevel(cols[0]) ? 'placeholder_entity' : null;
      if (placeholderReason) {
        skipTopLevel(cols[0], placeholderReason, typeField || 'Male');
      } else if (EXPLICIT_NON_PERSON_KEYS.has(canonicalBase) || EXCLUDED_TOP_LEVEL_KEYS.has(canonicalBase) || cols[0].startsWith('@')) {
        skipTopLevel(cols[0], 'non_human_or_non_person', typeField || 'Male');
      }
      continue;
    }

    const unified = unifiedBaseName(cols[0]);
    if (!unified) continue;
    const typeField = normalizeToken(cols[8] || '');
    const unifiedBase = canonicalPersonLabel(unified).toLowerCase();
    const isHuman = (includeNonHuman || humanLikeType(typeField) || !typeField)
      && !EXCLUDED_TOP_LEVEL_KEYS.has(unifiedBase.replace(/\s+/g, '_'))
      && !EXPLICIT_NON_PERSON_KEYS.has(unifiedBase);

    const person = {
      unifiedRaw: cols[0],
      unifiedName: unified,
      unifiedKey: normalizePersonName(unified),
      dStrong: normalizeToken((cols[0].split('@')[1] || '').split('=')[1] || ''),
      description: normalizeToken(cols[1] || ''),
      parentsRaw: normalizeToken(cols[2] || ''),
      siblingsRaw: normalizeToken(cols[3] || ''),
      partnersRaw: normalizeToken(cols[4] || ''),
      offspringRaw: normalizeToken(cols[5] || ''),
      tribe: normalizeToken(cols[6] || ''),
      summary: normalizeToken(cols[7] || ''),
      type: typeField || 'Male',
      sex: inferSex(typeField),
      isHuman,
      subrecords: []
    };

    if (!isHuman) {
      people.push({
        ...person,
        _skipForType: true,
        skip_reason: 'non_human_or_non_person'
      });
      current = null;
      continue;
    }

    people.push(person);
    current = person;
  }
  return people;
}

function collectRefs(person) {
  const out = [];
  for (const sr of person.subrecords) {
    if (sr?.entityKind === 'person' && Array.isArray(sr.refs)) out.push(...sr.refs);
  }
  return out.filter((x) => x && x.book);
}

function applyPersonSplitOverrides(records, splitOverrides, requireAllOverrides = false) {
  if (!splitOverrides.size) return records;
  const seenOverrides = new Set();
  const output = [];
  for (const person of records) {
    const override = splitOverrides.get(person.unifiedRaw);
    if (!override) {
      output.push(person);
      continue;
    }
    seenOverrides.add(person.unifiedRaw);
    const originalRefs = new Set(collectRefs(person).map((ref) => ref.key));
    const assignedRefs = new Set();
    for (const [partitionIndex, partition] of override.partitions.entries()) {
      const partitionRefs = new Set(partition.refs);
      for (const ref of partitionRefs) {
        if (!originalRefs.has(ref)) throw new Error(`${override.split_id}: split ref not present in source record: ${ref}`);
        if (assignedRefs.has(ref)) throw new Error(`${override.split_id}: split ref assigned more than once: ${ref}`);
        assignedRefs.add(ref);
      }
      const subrecords = person.subrecords
        .map((subrecord) => ({
          ...subrecord,
          refs: (subrecord.refs || []).filter((ref) => partitionRefs.has(ref.key))
        }))
        .filter((subrecord) => subrecord.refs.length > 0);
      if (!subrecords.length) throw new Error(`${override.split_id}: partition has no matching person-name subrecords: ${partition.partition_id}`);
      const replacementRaw = partition.unified_raw ? String(partition.unified_raw).trim() : null;
      output.push({
        ...person,
        unifiedRaw: replacementRaw
          ? replacementRaw
          : partitionIndex === 0
            ? person.unifiedRaw
            : `${person.unifiedRaw}#split:${partition.partition_id}`,
        unifiedName: partition.unified_name,
        unifiedKey: normalizePersonName(partition.unified_name),
        description: partition.editor_note,
        summary: partition.editor_note,
        parentsRaw: partition.keep_relation_fields ? person.parentsRaw : '',
        siblingsRaw: partition.keep_relation_fields ? person.siblingsRaw : '',
        partnersRaw: partition.keep_relation_fields ? person.partnersRaw : '',
        offspringRaw: partition.keep_relation_fields ? person.offspringRaw : '',
        subrecords,
        split_id: override.split_id,
        split_partition_id: partition.partition_id
      });
    }
    if (assignedRefs.size !== originalRefs.size) {
      const missing = [...originalRefs].filter((ref) => !assignedRefs.has(ref));
      throw new Error(`${override.split_id}: source refs missing from partitions: ${missing.join(', ')}`);
    }
  }
  const missingOverrides = [...splitOverrides.keys()].filter((key) => !seenOverrides.has(key));
  if (requireAllOverrides && missingOverrides.length) {
    throw new Error(`Person split overrides did not match STEP records: ${missingOverrides.join(', ')}`);
  }
  return output;
}

function applyPersonNameOverrides(records, nameOverrides, requireAllOverrides = false) {
  const seen = new Set();
  const output = records.map((person) => {
    const override = nameOverrides.get(person.unifiedRaw);
    if (!override) return person;
    seen.add(person.unifiedRaw);
    return {
      ...person,
      unifiedName: override.unified_name,
      unifiedKey: normalizePersonName(override.unified_name),
      summary: `${person.summary || person.description || ''} Editorial canonical-name correction: ${override.rationale}`.trim()
    };
  });
  const missing = [...nameOverrides.keys()].filter((key) => !seen.has(key));
  if (requireAllOverrides && missing.length) {
    throw new Error(`Person name overrides did not match STEP records: ${missing.join(', ')}`);
  }
  return output;
}

function buildCorpus() {
  const scopeOverrides = parseScopeOverrides();
  const splitOverrides = parsePersonSplitOverrides();
  const nameOverrides = parsePersonNameOverrides();
  const mentionOverrides = parseMentionVerificationOverrides();
  const identitySeedPath = path.join(DATA_DIR, 'identity-options.jsonl');
  const existingIdentityOptions = readJsonl(identitySeedPath);
  const identitySeed = existingIdentityOptions.filter((opt) => {
    const status = String(opt?.status || '').toLowerCase();
    const scope = String(opt?.identity_scope || '').toLowerCase();
    return status !== 'independent' || scope !== 'default';
  });

  const stepPath = findStepFile(SOURCE_DIR);
  if (!stepPath) throw new Error(`Cannot find TIPNR file in ${SOURCE_DIR}`);
  const sbl = buildSblReferenceSet(SBL_DIR);
  const strictEditorialOverrides = path.resolve(SOURCE_DIR) === path.resolve(DEFAULT_STEP_DIR);
  const records = applyPersonNameOverrides(
    applyPersonSplitOverrides(parseStepPersons(stepPath), splitOverrides, strictEditorialOverrides),
    nameOverrides,
    strictEditorialOverrides
  );
  const sblAuditReview = strictEditorialOverrides ? loadSblAuditReview() : null;
  const sblLexiconScan = {
    ...buildSblLexiconScan(
      records.filter((person) => !person._skipForType
        && scopeOverrides.get(person.unifiedRaw)?.decision !== 'exclude'
        && collectRefs(person).some((ref) => ref?.book)),
      sbl
    )
  };
  sblLexiconScan.entries = applyConservativeReplacementAudit(
    applySblAuditToScanEntries(sblLexiconScan.entries, sblAuditReview),
    splitOverrides,
    sblAuditReview,
    sbl
  );
  sblLexiconScan.sblPersons = sblLexiconScan.entries
    .filter((entry) => entry.status === 'accepted')
    .map((entry) => entry.latinized);
  sblLexiconScan.report.person_status = {
    accepted: sblLexiconScan.entries.filter((entry) => entry.status === 'accepted').length,
    pending: sblLexiconScan.entries.filter((entry) => entry.status === 'pending').length,
    excluded: sblLexiconScan.entries.filter((entry) => entry.status === 'excluded').length
  };

  const scanStatus = sblAuditReview ? 'implemented_independent_review' : 'implemented_lexicon_assisted';
  sblLexiconScan.report = {
    ...sblLexiconScan.report,
    method: sblAuditReview ? 'independent_reviewer_merge_sbl_surface_match' : sblLexiconScan.report.method,
    review_rows: sblAuditReview ? sblAuditReview.size : 0,
    review_method: sblAuditReview ? 'reviewer-a+reviewer-b pairwise consensus' : null
  };
  const sblPersonScan = {
    method: sblLexiconScan.report.method,
    status: scanStatus,
    total_audit_rows: sblLexiconScan.entries.length,
    accepted_audit_rows: sblLexiconScan.entries.filter((entry) => entry.status === 'accepted').length,
    pending_audit_rows: sblLexiconScan.entries.filter((entry) => entry.status === 'pending').length,
    excluded_audit_rows: sblLexiconScan.entries.filter((entry) => entry.status === 'excluded').length,
    total_sbl_scan_persons: sblLexiconScan.sblPersons.length
  };

  const ledger = [];
  const people = [];
  const names = [];
  const mentions = [];
  const assertions = [];
  const identityOptions = [];
  const seenMentionOverrides = new Set();

  let nNo = 1;
  let mNo = 1;
  let aNo = 1;
  let idNo = 1;
  let excludedNoNt = 0;
  let excludedNonHuman = 0;
  let excludedPlaceholder = 0;
  const buildTimestamp = snapshot.includes('T') ? snapshot : `${snapshot}T00:00:00Z`;
  const now = buildTimestamp;

  const personIdByRecord = new Map();
  const personIdByStepIdentity = new Map();
  const personCandidatesByLabel = new Map();
  const ntPeople = [];
  const existingPeople = readJsonl(path.join(DATA_DIR, 'people.jsonl'));
  const existingNames = readJsonl(path.join(DATA_DIR, 'names.jsonl'));
  const existingPersonIds = new Set(existingPeople.map((person) => person.person_id));
  const usedPersonIds = new Set();
  const personIdByStepKey = new Map();
  for (const name of existingNames) {
    const match = String(name.notes || '').match(/^Unified name from STEP: (.+)$/);
    if (match && existingPersonIds.has(name.person_id)) personIdByStepKey.set(match[1], name.person_id);
  }
  let nextPersonNo = Math.max(0, ...Array.from(existingPersonIds, (id) => Number(String(id).match(/(\d+)$/)?.[1] || 0))) + 1;
  const existingDefaultOptionByPerson = new Map(
    existingIdentityOptions
      .filter((opt) => opt?.status === 'independent' && opt?.identity_scope === 'default')
      .map((opt) => [opt.person_id, opt.option_id])
  );
  const existingOptionIds = new Set(existingIdentityOptions.map((opt) => opt.option_id));
  let nextOptionNo = Math.max(0, ...Array.from(existingOptionIds, (id) => Number(String(id).match(/(\d+)$/)?.[1] || 0))) + 1;

  const allocatePersonId = (stepKey) => {
    const existing = personIdByStepKey.get(stepKey);
    if (existing && !usedPersonIds.has(existing)) {
      usedPersonIds.add(existing);
      return existing;
    }
    let candidate;
    do {
      candidate = `person-${String(nextPersonNo++).padStart(6, '0')}`;
    } while (existingPersonIds.has(candidate) || usedPersonIds.has(candidate));
    usedPersonIds.add(candidate);
    return candidate;
  };
  const allocateNameId = () => `name-${padNum(nNo++)}`;
  const allocateMentionId = () => `mnt-${padNum(mNo++)}`;
  const allocateAssertionId = () => `asrt-${padNum(aNo++)}`;
  const allocateOptionId = () => `idopt-${padNum(idNo++)}`;
  const allocateDefaultOptionId = (personId) => {
    const existing = existingDefaultOptionByPerson.get(personId);
    if (existing) return existing;
    let candidate;
    do {
      candidate = `idopt-${padNum(nextOptionNo++)}`;
    } while (existingOptionIds.has(candidate));
    existingOptionIds.add(candidate);
    return candidate;
  };

  for (const person of records) {
    if (person._skipForType) {
      if (person.skip_reason === 'placeholder_entity') excludedPlaceholder += 1;
      else excludedNonHuman += 1;
      ledger.push({
        kind: 'exclusion',
        reason: person.skip_reason || 'non_human_or_non_person',
        person: person.unifiedRaw,
        source: SOURCE_ID_STEP,
        note: `Type=${person.type}`
      });
      continue;
    }

    const scopeOverride = scopeOverrides.get(person.unifiedRaw);
    if (scopeOverride?.decision === 'exclude') {
      excludedNoNt += 1;
      ledger.push({
        kind: 'exclusion',
        reason: scopeOverride.reason,
        person: person.unifiedRaw,
        source: SOURCE_ID_SBL,
        passages: scopeOverride.evidence_passages,
        note: scopeOverride.editor_note
      });
      continue;
    }

    const ntRefs = collectRefs(person).filter((r) => r && r.book);
    const uniqueNtRefs = [...new Set(ntRefs.map((r) => r.key))];
    if (!uniqueNtRefs.length) {
      excludedNoNt += 1;
      ledger.push({
        kind: 'exclusion',
        reason: 'no_nt_reference',
        person: person.unifiedRaw,
        source: SOURCE_ID_STEP,
        note: person.summary || person.description || ''
      });
      continue;
    }

    const personId = allocatePersonId(person.unifiedRaw);
    const canonicalName = person.unifiedName;
    const greekName = person.subrecords.find((sr) => sr.entityKind === 'person' && sr.language === 'grc')?.text || null;
    const latinized = canonicalPersonLabel(canonicalName);

    const personRow = {
      person_id: personId,
      canonical_chinese: null,
      canonical_greek: greekName,
      latinized,
      sex: person.sex,
      status: 'pending',
      identity_group: `nt-idgrp-${String(personId).match(/(\d+)$/)?.[1]}`,
      editor_note: person.summary || person.description || '',
      source_decisions: [SOURCE_ID_STEP, SOURCE_ID_SBL],
      nt_ref_count: uniqueNtRefs.length,
      review_status: {
        chinese_label_status: 'pending',
        chinese_label_note: '和合本中文标签未建权威映射，暂不编造；需人工映射审核。'
      },
      source_snapshot: snapshot,
      created_at: now,
      updated_at: now
    };
    people.push(personRow);
    ntPeople.push(person);
    personIdByRecord.set(person, personId);
    personIdByStepIdentity.set(stepIdentityKey(person.unifiedRaw), personId);
    const labelKey = canonicalPersonLabel(person.unifiedName).toLowerCase();
    const candidates = personCandidatesByLabel.get(labelKey) ?? [];
    candidates.push({ person, personId });
    personCandidatesByLabel.set(labelKey, candidates);

    names.push({
      name_id: allocateNameId(),
      person_id: personId,
      name_text: person.unifiedName,
      language: 'en',
      source_scope: 'canonical',
      status: 'accepted',
      notes: `Unified name from STEP: ${person.unifiedRaw}`,
      created_at: now,
      updated_at: now
    });

    for (const sr of person.subrecords) {
      if (sr.entityKind !== 'person') {
        ledger.push({
          kind: 'exclusion',
          reason: sr.entityKind === 'group'
            ? 'group_name_variant'
            : sr.entityKind === 'non_name_mention'
              ? 'unnamed_mention_variant'
              : 'non_person_name_form',
          person_id: personId,
          name: sr.text,
          source: SOURCE_ID_STEP
        });
        continue;
      }
      if (isPlaceholderTopLevel(sr.text)) {
        ledger.push({
          kind: 'exclusion',
          reason: 'placeholder_name_variant',
          person_id: personId,
          name: sr.text,
          source: SOURCE_ID_STEP
        });
        continue;
      }
      const key = `${sr.language}|${sr.text.toLowerCase()}`;
      if (!names.some((x) => x.person_id === personId && `${x.language}|${x.name_text.toLowerCase()}` === key)) {
        names.push({
          name_id: allocateNameId(),
          person_id: personId,
          name_text: sr.text,
          language: sr.language,
          source_scope: sr.sourceScope,
          status: sr.status || 'accepted',
          notes: sr.significance || '',
          created_at: now,
          updated_at: now
        });
      }
    }

    for (const ref of uniqueNtRefs) {
      const verified = sbl.refs.has(ref);
      const mentionOverrideKey = `${person.unifiedRaw}\u0000${ref}`;
      const mentionOverride = mentionOverrides.get(mentionOverrideKey);
      if (mentionOverride) seenMentionOverrides.add(mentionOverrideKey);
      const mentionStatus = mentionOverride?.decision === 'exclude'
        ? 'excluded'
        : verified
          ? 'accepted'
          : 'pending';
      mentions.push({
        mention_id: allocateMentionId(),
        person_id: personId,
        source_id: SOURCE_ID_STEP,
        passage: ref,
        location: 'STEP Proper Names',
        status: mentionStatus,
        notes: mentionOverride?.editor_note || (verified ? '' : 'Reference not verified in SBLGNT verse map'),
        editorial_rationale: mentionOverride
          ? `Editorial verification override ${mentionOverride.override_id}: ${mentionOverride.reason}`
          : 'Automated extraction from STEP Proper Names PERSON record.',
        created_at: now,
        updated_at: now
      });
      if (mentionOverride) {
        ledger.push({
          kind: 'reconcile',
          reason: mentionOverride.reason,
          person_id: personId,
          passage: ref,
          decision: mentionOverride.decision,
          source: SOURCE_ID_STEP,
          evidence_location: mentionOverride.evidence_location,
          note: mentionOverride.editor_note
        });
      } else if (!verified) {
        ledger.push({
          kind: 'reconcile',
          reason: 'missing_in_sblgnt',
          person_id: personId,
          passage: ref,
          source: SOURCE_ID_STEP
        });
      }
    }

    const defaultIdentityOption = {
      option_id: allocateDefaultOptionId(personId),
      person_id: personId,
      identity_key: person.unifiedRaw,
      status: 'independent',
      identity_scope: 'default',
      rationale: 'Default conservative identity, no merges applied.',
      editor_note: `Auto-import from ${SOURCE_ID_STEP} (${path.basename(stepPath)})`,
      created_at: now,
      updated_at: now
    };
    identityOptions.push(defaultIdentityOption);
  }

  if (strictEditorialOverrides) {
    const unmatchedMentionOverrides = [...mentionOverrides.keys()].filter((key) => !seenMentionOverrides.has(key));
    if (unmatchedMentionOverrides.length) {
      throw new Error(`Mention verification overrides did not match STEP records: ${unmatchedMentionOverrides.join(', ')}`);
    }
  }

  const personIds = new Set(identityOptions.map((item) => item.person_id));
  const usedOptionIds = new Set(identityOptions.map((item) => item.option_id));
  for (const seed of identitySeed) {
    if (!seed.person_id) {
      throw new Error('seed identity option missing person_id');
    }
    if (!personIds.has(seed.person_id)) {
      throw new Error(`seed identity option references missing person ${seed.person_id}`);
    }
    const sid = String(seed?.option_id || '').trim();
    const optionId = sid || allocateOptionId();
    if (usedOptionIds.has(optionId)) {
      throw new Error(`duplicate option_id in merged identity options: ${optionId}`);
    }
    if (seed.merge_target_person_id && !personIds.has(seed.merge_target_person_id)) {
      throw new Error(`seed identity option ${optionId} targets missing person ${seed.merge_target_person_id}`);
    }
    identityOptions.push({
      ...seed,
      option_id: optionId,
      created_at: now,
      updated_at: now
    });
    usedOptionIds.add(optionId);
  }

  identityOptions.sort((a, b) => {
    const aIsDefault = a.identity_scope === 'default' && a.status === 'independent';
    const bIsDefault = b.identity_scope === 'default' && b.status === 'independent';
    if (aIsDefault !== bIsDefault) return aIsDefault ? -1 : 1;
    const aId = Number(String(a.option_id || '').match(/idopt-(\d+)/)?.[1] || 0);
    const bId = Number(String(b.option_id || '').match(/idopt-(\d+)/)?.[1] || 0);
    if (aId !== bId) return aId - bId;
    return String(a.option_id || '').localeCompare(String(b.option_id || ''));
  });

  const resolveRelationshipTarget = (item) => {
    const exact = personIdByStepIdentity.get(stepIdentityKey(item.raw));
    if (exact) return { personId: exact, resolution: 'exact_step_identity' };

    const labelKey = canonicalPersonLabel(item.key).toLowerCase();
    const candidates = personCandidatesByLabel.get(labelKey) ?? [];
    if (candidates.length === 1) return { personId: candidates[0].personId, resolution: 'unique_label' };

    const relationRefs = new Set(item.refs.map((ref) => ref.key));
    if (relationRefs.size) {
      const overlapping = candidates.filter(({ person }) =>
        collectRefs(person).some((ref) => relationRefs.has(ref.key))
      );
      if (overlapping.length === 1) return { personId: overlapping[0].personId, resolution: 'reference_overlap' };
    }
    return { personId: null, resolution: candidates.length ? 'ambiguous_label' : 'missing_label' };
  };

  const seenRelations = new Map();
  const addAssertion = (entry) => {
    const relationKey = `${entry.subject_person_id}|${entry.object_person_id}|${entry.relation_type}|${entry.relation_subtype}|${entry.direction}`;
    const existing = seenRelations.get(relationKey);
    if (!existing) {
      seenRelations.set(relationKey, entry);
      entry.assertion_id = allocateAssertionId();
      assertions.push(entry);
      return false;
    }
    const confidence = Math.min(existing.confidence, entry.confidence);
    existing.confidence = confidence;
    existing.editor_note = `${existing.editor_note}; ${entry.editor_note}`;
    const seen = new Set(existing.evidence.map((e) => `${e.source_id}|${e.passage}|${e.evidence_level}|${e.certainty}`));
    for (const e of entry.evidence) {
      const key = `${e.source_id}|${e.passage}|${e.evidence_level}|${e.certainty}`;
      if (!seen.has(key)) {
        seen.add(key);
        existing.evidence.push(e);
      }
    }
    return true;
  };

  for (const subject of ntPeople) {
    const subjectId = personIdByRecord.get(subject);
    if (!subjectId) continue;
    const subjectRefs = collectRefs(subject).map((r) => r.key);
    const relationSchema = [
      { field: subject.parentsRaw, type: 'parent', direction: 'directed' },
      { field: subject.offspringRaw, type: 'offspring', direction: 'directed-reverse' },
      { field: subject.siblingsRaw, type: 'sibling', direction: 'undirected' },
      { field: subject.partnersRaw, type: 'partner', direction: 'undirected' }
    ];

    for (const rel of relationSchema) {
      for (const item of parsePersonRelationship(rel.field)) {
        const targetResolution = resolveRelationshipTarget(item);
        const targetId = targetResolution.personId;
        const primaryRef = item.refs[0]?.key || subjectRefs[0] || '';
        const evidence = [{
          source_id: SOURCE_ID_STEP,
          passage: primaryRef ? `STEP:${primaryRef}` : `STEP:${subject.unifiedName} ${rel.type}`,
          evidence_level: 'modern_reference',
          note: `${rel.type} relation from TIPNR`,
          certainty: item.uncertain ? 0.35 : 0.82
        }];
        if (!targetId) {
          ledger.push({
            kind: 'relation',
            reason: targetResolution.resolution === 'ambiguous_label' ? 'relation_target_ambiguous' : 'relation_target_missing',
            source: SOURCE_ID_STEP,
            subject: subject.unifiedRaw,
            target: item.raw,
            relation: rel.type
          });
          continue;
        }
        if (targetId === subjectId) {
          ledger.push({
            kind: 'relation',
            reason: 'relation_self_loop',
            source: SOURCE_ID_STEP,
            subject: subject.unifiedRaw,
            target: item.raw,
            relation: rel.type
          });
          continue;
        }
        const uncertain = item.uncertain;
        let subId = subjectId;
        let objId = targetId;
        let relationSubtype = rel.type;
        let direction = rel.direction === 'undirected' ? 'undirected' : 'directed';

        if (rel.type === 'parent') {
          relationSubtype = 'parent';
          subId = targetId;
          objId = subjectId;
          direction = 'directed';
        } else if (rel.type === 'offspring') {
          relationSubtype = 'parent';
          subId = subjectId;
          objId = targetId;
          direction = 'directed';
        } else if (rel.type === 'sibling' || rel.type === 'partner') {
          relationSubtype = rel.type;
          direction = 'undirected';
          if (subId > objId) {
            const tmp = subId;
            subId = objId;
            objId = tmp;
          }
        }

        const relation = {
          subject_person_id: subId,
          object_person_id: objId,
          relation_type: 'kinship',
          relation_subtype: relationSubtype,
          direction,
          evidence,
          status: 'inactive',
          confidence: uncertain ? 0.35 : 0.8,
          editorial_status: 'pending',
          editor_note: `From TIPNR relation field "${rel.type}"`,
          created_at: now,
          updated_at: now
        };
        const merged = addAssertion(relation);
        if (merged) {
          ledger.push({
            kind: 'relation',
            reason: 'relation_duplicate',
            source: SOURCE_ID_STEP,
            subject: subject.unifiedRaw,
            target: item.raw,
            relation: rel.type
          });
        }
      }
    }
  }

  const seedRows = (!ignoreRelationshipSeeds && fs.existsSync(SEED_PATH)) ? parseSeedRows(SEED_PATH) : [];
  const seedSeen = new Set();
  for (const seed of seedRows.sort((a, b) => String(a.seed_id).localeCompare(String(b.seed_id)))) {
    if (seedSeen.has(seed.seed_id)) {
      throw new Error(`Duplicate seed_id ${seed.seed_id}`);
    }
    seedSeen.add(seed.seed_id);
    if (!personIds.has(seed.subject_person_id) || !personIds.has(seed.object_person_id)) {
      throw new Error(`Seed uses missing person id: ${seed.seed_id}`);
    }
    if (seed.subject_person_id === seed.object_person_id) {
      throw new Error(`Seed self-loop detected: ${seed.seed_id}`);
    }
    const certainty = seed.evidence[0]?.certainty ?? 0.9;
    const relation = {
      subject_person_id: seed.subject_person_id,
      object_person_id: seed.object_person_id,
      relation_type: seed.relation_type,
      direction: seed.direction,
      evidence: seed.evidence.map((e) => ({ ...e })),
      status: 'inactive',
      confidence: certainty,
      editorial_status: 'pending',
      editor_note: `Explicit seed ${seed.seed_id}`,
      created_at: now,
      updated_at: now
    };
    if (seed.relation_subtype) relation.relation_subtype = seed.relation_subtype;
    addAssertion(relation);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJsonl(path.join(DATA_DIR, 'people.jsonl'), people);
  writeJsonl(path.join(DATA_DIR, 'names.jsonl'), names);
  writeJsonl(path.join(DATA_DIR, 'mentions.jsonl'), mentions);
  writeJsonl(path.join(DATA_DIR, 'assertions.jsonl'), assertions);
  writeJsonl(path.join(DATA_DIR, 'identity-options.jsonl'), identityOptions);
  writeJsonl(path.join(DATA_DIR, 'review-ledger.jsonl'), ledger);
  writeJson(path.join(DATA_DIR, 'stepbible.persons.json'), [...new Set(ntPeople.map((p) => p.unifiedName))]);
  writeJson(path.join(DATA_DIR, 'sblgnt.persons.json'), sblLexiconScan.sblPersons);
  writeJsonl(path.join(DATA_DIR, 'sblgnt-name-audit.jsonl'), sblLexiconScan.entries);
  writeJson(path.join(DATA_DIR, 'reconciliation.json'), {
    generatedAt: now,
    stepFile: `${SOURCE_ID_STEP}/${path.basename(stepPath)}`,
    source_dirs: { step: SOURCE_ID_STEP, sblgnt: SOURCE_ID_SBL },
    sbl_verified_refs: [...new Set(mentions.filter((m) => m.status === 'accepted').map((m) => m.passage))],
    sbl_missing_refs: [...new Set(mentions.filter((m) => m.status === 'pending').map((m) => m.passage))],
    sbl_greek_verification: sblLexiconScan.report,
    sbl_person_scan: sblPersonScan,
    completeness: {
      sbl_book_count: sbl.bookOrder.size,
      total_nt_refs_in_step: new Set(mentions.map((m) => m.passage)).size
    },
    ledger_counts: ledger.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, Object.create(null)),
    checksum: crypto.createHash('sha256').update(`${people.length}-${names.length}-${mentions.length}-${assertions.length}`).digest('hex')
  });
  const outManifest = {
    sourceFiles: {
      step: `${SOURCE_ID_STEP}/${path.basename(stepPath)}`,
      sblgnt: SOURCE_ID_SBL
    },
    snapshot,
    total_person_records_seen: records.length,
    excluded_non_human_or_non_person: excludedNonHuman,
    excluded_placeholder_entity: excludedPlaceholder,
    excluded_no_nt_reference: excludedNoNt,
    nt_person_count: people.length,
    name_count: names.length,
    mention_count: mentions.length,
    assertion_count: assertions.length,
    ledger_count: ledger.length,
    generatedAt: now
  };
  writeJson(path.join(DATA_DIR, 'ingest-report.json'), outManifest);

  console.log(
    `Built NT corpus from ${path.basename(stepPath)}; people=${people.length}, names=${names.length}, mentions=${mentions.length}, assertions=${assertions.length}, ledger=${ledger.length}`
  );
}

buildCorpus();
