#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE_DIR = path.join(ROOT, '.sources', 'stepbible-data');
const EDITORIAL_DIR = path.join(ROOT, 'editorial');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'old-testament-person-candidates.schema.json');
const OUTPUT_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates-report.json');
const MANIFEST_PATH = path.join(ROOT, 'data', 'manifest.json');
const DEFAULT_SOURCE_ID = 'source:0002';

const DATASET_TIMESTAMP = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).created_at;
if (!DATASET_TIMESTAMP || Number.isNaN(Date.parse(DATASET_TIMESTAMP))) {
  throw new Error('data/manifest.json must provide a valid created_at timestamp');
}

const validateOnly = process.argv.includes('--validate-only');
const sourceDir = parseArg('step-data-dir', DEFAULT_SOURCE_DIR);
const outputPath = parseArg('output', OUTPUT_PATH);
const reportPath = parseArg('report', REPORT_PATH);

const OT_BOOK_MAP = new Map([
  ['Gen', 'GEN'], ['Gn', 'GEN'],
  ['Exod', 'EXO'], ['Ex', 'EXO'], ['Exo', 'EXO'], ['Exodus', 'EXO'],
  ['Lev', 'LEV'], ['Lv', 'LEV'], ['Leviticus', 'LEV'],
  ['Num', 'NUM'], ['Nm', 'NUM'], ['Numbers', 'NUM'],
  ['Deut', 'DEU'], ['Deu', 'DEU'], ['Dt', 'DEU'], ['Deuteronomy', 'DEU'],
  ['Josh', 'JOS'], ['Jos', 'JOS'], ['Joshua', 'JOS'],
  ['Judg', 'JDG'], ['Jdg', 'JDG'], ['Jg', 'JDG'], ['Judges', 'JDG'],
  ['Ruth', 'RUT'], ['Rut', 'RUT'], ['Ru', 'RUT'],
  ['1Sam', '1SA'], ['2Sam', '2SA'], ['1Sa', '1SA'], ['2Sa', '2SA'], ['1 Samuel', '1SA'], ['2 Samuel', '2SA'],
  ['1Kings', '1KI'], ['2Kings', '2KI'], ['1Kgs', '1KI'], ['2Kgs', '2KI'], ['1Ki', '1KI'], ['2Ki', '2KI'],
  ['1Chr', '1CH'], ['2Chr', '2CH'], ['1Ch', '1CH'], ['2Ch', '2CH'],
  ['Ezr', 'EZR'],
  ['Neh', 'NEH'],
  ['Est', 'EST'], ['Es', 'EST'],
  ['Job', 'JOB'],
  ['Psa', 'PSA'], ['Ps', 'PSA'], ['Psalms', 'PSA'],
  ['Prov', 'PRO'], ['Pr', 'PRO'], ['Pro', 'PRO'], ['Proverbs', 'PRO'],
  ['Eccl', 'ECC'], ['Ecc', 'ECC'],
  ['Song', 'SNG'], ['Song of Songs', 'SNG'], ['Sng', 'SNG'], ['SOS', 'SNG'],
  ['Isa', 'ISA'], ['Is', 'ISA'],
  ['Jer', 'JER'], ['Je', 'JER'],
  ['Lam', 'LAM'], ['Lamentations', 'LAM'],
  ['Ezek', 'EZE'], ['Ezk', 'EZE'], ['Eze', 'EZE'], ['Ezekiel', 'EZE'],
  ['Dan', 'DAN'],
  ['Hos', 'HOS'], ['Hosea', 'HOS'],
  ['Jol', 'JOL'],
  ['Joe', 'JOL'],
  ['Amos', 'AMO'], ['Amo', 'AMO'],
  ['Obad', 'OBA'], ['Obadiah', 'OBA'],
  ['Oba', 'OBA'],
  ['Jonah', 'JON'], ['Jon', 'JON'],
  ['Mic', 'MIC'],
  ['Nam', 'NAH'],
  ['Nah', 'NAH'], ['Nahum', 'NAH'], ['Nah', 'NAH'],
  ['Hab', 'HAB'], ['Habakkuk', 'HAB'],
  ['Zeph', 'ZEP'], ['Zep', 'ZEP'], ['Zephaniah', 'ZEP'],
  ['Hag', 'HAG'], ['Haggai', 'HAG'],
  ['Zec', 'ZEC'], ['Zechariah', 'ZEC'],
  ['Mal', 'MAL'], ['Malachi', 'MAL']
]);

const NT_BOOK_MAP = new Map([
  ['Mat', 'MAT'], ['Matt', 'MAT'], ['Mt', 'MAT'], ['Matthew', 'MAT'],
  ['Mark', 'MRK'], ['Mk', 'MRK'], ['Mc', 'MRK'], ['Mrk', 'MRK'], ['Mr', 'MRK'], ['Mar', 'MRK'],
  ['Act', 'ACT'], ['Acts', 'ACT'], ['Ac', 'ACT'],
  ['Luke', 'LUK'], ['Luk', 'LUK'], ['Lk', 'LUK'], ['Lu', 'LUK'], ['Luk', 'LUK'],
  ['Joh', 'JHN'], ['Jn', 'JHN'], ['Jo', 'JHN'], ['Jhn', 'JHN'], ['John', 'JHN'],
  ['Rom', 'ROM'], ['Ro', 'ROM'],
  ['1Cor', '1CO'], ['2Cor', '2CO'], ['1Co', '1CO'], ['2Co', '2CO'],
  ['Gal', 'GAL'], ['Ga', 'GAL'],
  ['Eph', 'EPH'], ['Ep', 'EPH'],
  ['Php', 'PHP'], ['Phi', 'PHP'], ['Philip', 'PHP'], ['Phil', 'PHP'], ['Col', 'COL'],
  ['1Th', '1TH'], ['2Th', '2TH'], ['1Ti', '1TI'], ['2Ti', '2TI'], ['Tit', 'TIT'], ['Th', '1TH'],
  ['Phm', 'PHM'], ['Philemon', 'PHM'],
  ['Heb', 'HEB'], ['He', 'HEB'],
  ['Jas', 'JAS'], ['Jam', 'JAS'], ['James', 'JAS'],
  ['1Pet', '1PE'], ['2Pet', '2PE'], ['1Pe', '1PE'], ['2Pe', '2PE'], ['Pe', '1PE'],
  ['1Jn', '1JN'], ['2Jn', '2JN'], ['3Jn', '3JN'], ['Jo1', '1JN'], ['Jo2', '2JN'], ['Jo3', '3JN'],
  ['Jude', 'JUD'], ['Jud', 'JUD'],
  ['Rev', 'REV'], ['Re', 'REV'], ['Rv', 'REV']
]);

const BOOK_TESTAMENT = new Map();
for (const v of OT_BOOK_MAP.values()) BOOK_TESTAMENT.set(v, 'ot');
for (const v of NT_BOOK_MAP.values()) BOOK_TESTAMENT.set(v, 'nt');

const ALL_BOOK_MAP = new Map([...OT_BOOK_MAP, ...NT_BOOK_MAP]);
const OT_BOOK_SET = new Set([...OT_BOOK_MAP.values()]);
const NT_BOOK_SET = new Set([...NT_BOOK_MAP.values()]);
const ALL_BOOK_SET = new Set([...OT_BOOK_SET, ...NT_BOOK_SET]);
const BOOK_SET = ALL_BOOK_SET;

const OT_BOOKS_CANONICAL = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA',
  'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOL',
  'AMO', 'OBA', 'JON', 'MIC', 'NAH', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'
];
const EXCLUDED_TOP_LEVEL_KEYS = new Set(['queen_of_sheba', 'pharaoh']);
const EXPLICIT_NON_PERSON_KEYS = new Set(['michael']);
const PLACEHOLDER_RELATION_PREFIXES = new Set([
  'father', 'mother', 'daughter', 'son', 'husband', 'wife', 'a_wife',
  'brother', 'sister', 'child', 'parent', 'spouse', 'relative',
  'mother_in_law', 'father_in_law', 'son_in_law', 'daughter_in_law'
]);

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
const candidateSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const validateCandidate = ajv.compile(candidateSchema);

function parseArg(name, fallback = process.env[name.toUpperCase()]) {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const withEqual = `${key}=`;
  const found = args.find((item) => item.startsWith(withEqual));
  if (found) return found.slice(withEqual.length);
  const idx = args.indexOf(key);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return fallback;
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

function normalizeBookRef(rawRef) {
  return String(rawRef || '')
    .replace(/^LXX\s*/i, '')
    .replace(/[\s]+/g, '')
    .replace(/ff$/i, '')
    .replace(/-[A-Za-z]+$/i, '')
    .replace(/[\u200b-\u200d]/g, '')
    .trim();
}

function normalizeBook(rawBook) {
  const token = String(rawBook || '').replace('.', '').trim();
  return ALL_BOOK_MAP.get(token) || ALL_BOOK_MAP.get(token.replace('.', '')) || null;
}

function parseReference(rawRef) {
  if (!rawRef) return null;
  const isLxx = /^\s*LXX\b/i.test(String(rawRef));
  const token = normalizeBookRef(rawRef);
  if (!token || !token.includes('.')) return null;
  const m = token.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+[a-z]?)$/i);
  if (!m) return null;
  const verseNum = Number(m[3].replace(/[a-z]$/i, ''));
  if (!Number.isFinite(verseNum) || verseNum <= 0) return null;
  const book = normalizeBook(m[1]);
  if (!book || !BOOK_SET.has(book)) return null;
  const testament = BOOK_TESTAMENT.get(book);
  if (!testament) return null;
  return {
    raw: token,
    book,
    passage: `${book} ${Number(m[2])}:${verseNum}`,
    key: `${book} ${Number(m[2])}:${verseNum}`,
    isLxx,
    testament
  };
}

function parseRefsFromText(raw) {
  if (!raw) return [];
  const out = [];
  for (const block of String(raw).split(/[;,\n]/)) {
    for (const item of block.split(/\s+[-–]\s*/).map((x) => x.trim()).filter(Boolean)) {
      const ref = parseReference(item);
      if (ref) out.push(ref);
    }
  }
  return out;
}

function isGreekLike(raw) {
  return /\p{Script=Greek}/u.test(String(raw || ''));
}

function isHebrewLike(raw) {
  return /\p{Script=Hebrew}/u.test(String(raw || ''));
}

function splitRelationItems(raw) {
  if (!raw) return [];
  return String(raw).split(/\s+\+\s*|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
}

function parsePersonRelationship(raw) {
  const out = [];
  for (const item of splitRelationItems(raw)) {
    const uncertain = /\(\?\)/.test(item);
    const normalized = normalizePersonName(item);
    if (!normalized) continue;
    const nameRef = normalized.split('@')[0].trim();
    const relTail = normalized.includes('@') ? normalized.split('@').slice(1).join('@') : '';
    const relationRefs = parseRefsFromText(relTail);
    out.push({
      key: normalizePersonName(nameRef),
      raw: item,
      uncertain,
      refs: relationRefs.filter((ref) => ref && BOOK_SET.has(ref.book)).map((ref) => ref.key)
    });
  }
  return out;
}

function parseSubrecord(line) {
  if (!line.startsWith('–')) return null;
  const cols = line.split('\t');
  if (cols.length < 6) return null;

  const significance = normalizeToken(cols[0].replace(/^–\s*/, ''));
  if (significance.toLowerCase() === 'total') return null;

  const rawName = normalizeToken(cols[1] || '');
  const translated = normalizeToken(cols[3] || '');
  const formText = normalizeToken(cols[2] || '');
  const formMatch = /«[^=]*=(.+)$/.exec(formText);
  const formName = formMatch ? normalizeToken(formMatch[1]) : '';
  const canonicalBase = normalizePersonName(formName || translated || rawName);
  if (!canonicalBase) return null;

  const allRefs = normalizeToken(cols[5] || '');
  const refs = parseRefsFromText(allRefs);
  if (!refs.length) {
    return {
      significance: significance.toLowerCase(),
      rawName,
      aliasKey: normalizePersonName(rawName).toLowerCase(),
      text: canonicalBase,
    language: inferLanguage(formName, rawName, translated),
    sourceScope: inferSourceScope(significance),
    status: 'pending',
    refs: []
  };
  }

  let language = 'en';
  if (isGreekLike(formName)) language = 'grc';
  if (isHebrewLike(formName) || isHebrewLike(rawName) || isHebrewLike(translated)) language = 'hbo';
  return {
    significance: significance.toLowerCase(),
    rawName,
    aliasKey: normalizePersonName(rawName).toLowerCase(),
    text: canonicalBase,
    language,
    sourceScope: inferSourceScope(significance),
    status: 'accepted',
    refs
  };
}

function inferLanguage(formName, rawName, translatedName) {
  let language = 'en';
  if (isGreekLike(formName)) language = 'grc';
  if (isHebrewLike(formName) || isHebrewLike(rawName) || isHebrewLike(translatedName)) {
    language = 'hbo';
  }
  return language;
}

function inferSourceScope(significanceRaw) {
  const sig = String(significanceRaw || '').toLowerCase();
  if (sig === 'named') return 'canonical';
  if (sig === 'greek') return 'alias';
  if (sig.includes('archaic') || sig.includes('hebrew')) return 'variant';
  if (sig.includes('spelled') || sig.includes('variant')) return 'variant';
  return 'alias';
}

function inferSex(typeField) {
  const t = String(typeField || '').toLowerCase();
  if (t === 'male') return 'male';
  if (t === 'female') return 'female';
  return 'unknown';
}

function isHumanLikeType(typeField) {
  if (!typeField) return true;
  const t = String(typeField).toLowerCase();
  return t === 'male' || t === 'female';
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

function isExplicitTopLevelName(rawUnified) {
  if (!rawUnified || rawUnified.startsWith('@')) return false;
  const atIndex = String(rawUnified).indexOf('@');
  if (atIndex <= 0) return false;
  const nameKey = normalizePersonName(rawUnified.slice(0, atIndex)).toLowerCase().trim();
  if (!nameKey) return false;
  const canonicalBase = nameKey.split('|')[0].trim();
  const canonicalBaseKey = canonicalBase.replace(/\s+/g, '_');
  if (EXCLUDED_TOP_LEVEL_KEYS.has(canonicalBaseKey) || EXPLICIT_NON_PERSON_KEYS.has(canonicalBase)) return false;
  return !isPlaceholderTopLevel(rawUnified);
}

function parseStepPersons(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const people = [];
  let mode = false;
  let current = null;

  const skipTopLevel = (raw, reason, type) => {
    people.push({
      unifiedRaw: raw,
      unifiedName: normalizePersonName(raw) || raw,
      unifiedKey: canonicalPersonLabel(raw).toLowerCase(),
      type: type || 'Male',
      skipReason: reason,
      subrecords: [],
      isPlaceholderSkip: reason === 'placeholder_entity',
      _skipForType: true
    });
    current = null;
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
      if (parsed) current.subrecords.push(parsed);
      continue;
    }

    if (!line.includes('\t')) continue;
    const cols = line.split('\t');
    if (cols[0].startsWith('$==========')) continue;

    const topLevelRaw = cols[0];
    if (!isExplicitTopLevelName(topLevelRaw)) {
      const typeField = normalizeToken(cols[8] || '');
      const canonicalBase = canonicalPersonLabel(topLevelRaw).toLowerCase().replace(/\s+/g, '_');
      const isPlaceholder = isPlaceholderTopLevel(topLevelRaw);
      if (isPlaceholder) {
        skipTopLevel(topLevelRaw, 'placeholder_entity', typeField || 'Male');
      } else if (EXPLICIT_NON_PERSON_KEYS.has(canonicalBase) || EXCLUDED_TOP_LEVEL_KEYS.has(canonicalBase) || topLevelRaw.startsWith('@')) {
        skipTopLevel(topLevelRaw, 'non_human_or_non_person', typeField || 'Male');
      }
      continue;
    }

    const unifiedRaw = topLevelRaw;
    const unifiedName = normalizePersonName(unifiedRaw);
    if (!unifiedName) continue;
    const typeField = normalizeToken(cols[8] || '');
    const unifiedBase = canonicalPersonLabel(unifiedName).toLowerCase();
    const isHuman = isHumanLikeType(typeField) && !EXCLUDED_TOP_LEVEL_KEYS.has(unifiedBase.replace(/\s+/g, '_')) && !EXPLICIT_NON_PERSON_KEYS.has(unifiedBase);

    const person = {
      unifiedRaw,
      unifiedName,
      unifiedKey: normalizePersonName(unifiedName),
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
      isHumanLikeType: !!typeField,
      subrecords: []
    };

    if (!isHuman) {
      people.push({ ...person, _skipForType: true, skipReason: 'non_human_or_non_person' });
      current = null;
      continue;
    }

    person.relationshipsRaw = {
      parents: parsePersonRelationship(person.parentsRaw),
      siblings: parsePersonRelationship(person.siblingsRaw),
      partners: parsePersonRelationship(person.partnersRaw),
      offspring: parsePersonRelationship(person.offspringRaw)
    };

    people.push(person);
    current = person;
  }

  return people;
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
    .replace(/\s+/g, ' ')
    .trim();
}

function stepIdentityKey(rawUnified) {
  return normalizePersonName(rawUnified)
    .replace(/=\S+$/, '')
    .replace(/\?+$/, '')
    .trim()
    .toLowerCase();
}

function personOtRefs(person) {
  return person.subrecords.flatMap((sr) => sr.refs).filter((ref) => ref && ref.testament === 'ot');
}

function findStepFile(dir) {
  const targetDir = path.join(dir, 'Proper Nouns');
  if (!fs.existsSync(targetDir)) return null;
  const candidates = fs
    .readdirSync(targetDir)
    .map((file) => path.join(targetDir, file))
    .filter((full) => fs.statSync(full).isFile())
    .filter((full) => /TIPNR.*Proper Names/i.test(path.basename(full)))
    .sort((a, b) => a.localeCompare(b));
  return candidates[0] || null;
}

function computeHash(filePaths) {
  const hash = crypto.createHash('sha256');
  for (const filePath of filePaths.sort()) {
    hash.update(filePath);
    hash.update('\u0000');
    hash.update(fs.readFileSync(filePath));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function writeJsonl(filePath, rows) {
  const data = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${data}${rows.length > 0 ? '\n' : ''}`);
}

function writeReport(filePath, report) {
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function validate(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    if (!validateCandidate(rows[i])) {
      const detail = (validateCandidate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      throw new Error(`Invalid candidate row at line ${i + 1}: ${detail || 'schema validation failed'}`);
    }
  }
}

function runGenerate() {
  const stepPath = findStepFile(sourceDir);
  if (!stepPath) throw new Error(`Cannot find TIPNR file in ${sourceDir}`);
  const records = parseStepPersons(stepPath);

  const excluded = {
    placeholders: 0,
    nonPerson: 0,
    noOtRefs: 0,
    lxxOnlyRefs: 0,
    nonHuman: 0
  };
  const sourceCoverage = new Map();
  const candidates = [];

  const validCandidatesById = new Map();
  for (const person of records) {
    if (person._skipForType) {
      if (person.skipReason === 'placeholder_entity') excluded.placeholders += 1;
      else if (person.skipReason === 'non_human_or_non_person') excluded.nonPerson += 1;
      continue;
    }
    if (!person.isHuman) {
      excluded.nonHuman += 1;
      continue;
    }

    const otRefs = personOtRefs(person).filter((ref) => ref && !ref.isLxx);
    const lxxRefs = personOtRefs(person).filter((ref) => ref && ref.isLxx);
    if (!otRefs.length) {
      if (!personOtRefs(person).length || lxxRefs.length === personOtRefs(person).length) {
        excluded.lxxOnlyRefs += 1;
      } else {
        excluded.noOtRefs += 1;
      }
      continue;
    }

    const key = stepIdentityKey(person.unifiedRaw);
    if (validCandidatesById.has(key)) continue;

    const uniqueOtRefs = [...new Set(otRefs.map((r) => r.key))].sort();
    const bookCoverage = uniqueOtRefs.map((passage) => passage.split(' ')[0]);
    for (const book of bookCoverage) sourceCoverage.set(book, (sourceCoverage.get(book) || 0) + 1);

    const names = person.subrecords
      .filter((sub) => sub.status !== 'pending')
      .map((sub) => ({
        name_text: sub.text,
        raw_name: sub.rawName,
        significance: sub.significance,
        language: sub.language,
        source_scope: sub.sourceScope,
        status: sub.status,
        refs: [...new Set(sub.refs.filter((r) => BOOK_SET.has(r.book) && !r.isLxx).map((r) => r.key))].sort()
      }));

    const canonicalName = names[0]?.name_text || person.unifiedName;

    validCandidatesById.set(key, {
      step_identity_key: key,
      source_id: DEFAULT_SOURCE_ID,
      source_file: path.relative(ROOT, stepPath),
      candidate_status: 'pending',
      candidate_decision: 'pending',
      canonical_name: canonicalName,
      latinized: canonicalPersonLabel(person.unifiedRaw),
      normalized_unified_name: canonicalPersonLabel(person.unifiedRaw),
      sex: person.sex,
      step_unified_raw: person.unifiedRaw,
      raw_fields: {
        description: person.description,
        tribe: person.tribe,
        summary: person.summary,
        parents_raw: person.parentsRaw,
        siblings_raw: person.siblingsRaw,
        partners_raw: person.partnersRaw,
        offspring_raw: person.offspringRaw
      },
      relationships_raw: person.relationshipsRaw || {
        parents: parsePersonRelationship(person.parentsRaw),
        siblings: parsePersonRelationship(person.siblingsRaw),
        partners: parsePersonRelationship(person.partnersRaw),
        offspring: parsePersonRelationship(person.offspringRaw)
      },
      names,
      ot_refs: uniqueOtRefs,
      ot_ref_count: uniqueOtRefs.length,
      nt_ref_count: [...new Set(person.subrecords.flatMap((sr) => sr.refs).filter((ref) => ref && ref.testament === 'nt').map((r) => r.key))].length,
      created_at: DATASET_TIMESTAMP,
      source_snapshot: DATASET_TIMESTAMP,
      metadata: {
        source_norm: normalizeUnicodeText(person.unifiedRaw),
        has_nt_refs: [...new Set(person.subrecords.flatMap((sr) => sr.refs).filter((ref) => ref && ref.testament === 'nt').map((r) => r.key))].length > 0
      }
    });
  }

  const rows = [...validCandidatesById.values()]
    .sort((a, b) => (a.step_identity_key > b.step_identity_key ? 1 : a.step_identity_key < b.step_identity_key ? -1 : 0));
  for (let index = 0; index < rows.length; index += 1) {
    rows[index].candidate_id = `otc-${String(index + 1).padStart(4, '0')}`;
  }

    validate(rows);
    writeJsonl(outputPath, rows);

  const report = {
    generated_at: DATASET_TIMESTAMP,
    source_file: path.relative(ROOT, path.join(sourceDir, 'Proper Nouns', path.basename(stepPath))),
    source_snapshot: DATASET_TIMESTAMP,
    source_id: DEFAULT_SOURCE_ID,
    source_version: 'source:0002',
    source_hash: crypto.createHash('sha256').update(fs.readFileSync(stepPath)).digest('hex'),
    input_records: records.length,
    candidate_count: rows.length,
    excluded_counts: excluded,
    book_coverage: {
      ...Object.fromEntries(OT_BOOKS_CANONICAL.map((book) => [book, sourceCoverage.get(book) || 0])),
      ...Object.fromEntries([...sourceCoverage.entries()].filter(([book]) => OT_BOOK_SET.has(book)).sort((a, b) => a[0].localeCompare(b[0])))
    },
    output_path: path.relative(ROOT, outputPath),
    report_path: path.relative(ROOT, reportPath),
    output_checksum: computeHash([outputPath]),
    note: 'All OT candidates remain pending until explicit editorial review.'
  };
  writeReport(reportPath, report);

    validateReportAgainstRows(report, rows);
    console.log(JSON.stringify({
      candidate_count: rows.length,
      excluded: excluded,
      input_records: records.length,
      output: path.relative(ROOT, outputPath),
      report: path.relative(ROOT, reportPath)
    }));
  }

function runValidateOnly() {
  if (!fs.existsSync(outputPath)) throw new Error(`Missing candidate file: ${outputPath}`);
  const rows = fs.readFileSync(outputPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid JSON at ${outputPath}:${idx + 1}`);
      }
    });
  validate(rows);
  if (rows.length) {
    console.log(`validate-old-testament-candidates ok (${rows.length} rows)`);
  } else {
    console.log('validate-old-testament-candidates ok (0 rows)');
  }
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    validateReportAgainstRows(report, rows);
  } else {
    throw new Error(`Missing report file: ${reportPath}`);
  }
}

function validateReportAgainstRows(report, rows) {
  const rowCount = rows.length;
  if (report.candidate_count !== rowCount) {
    throw new Error(`report.candidate_count mismatch: ${report.candidate_count} !== ${rowCount}`);
  }
  const reportHash = computeHash([outputPath]);
  if (report.output_checksum !== reportHash) {
    throw new Error(`report.output_checksum mismatch: ${report.output_checksum} !== ${reportHash}`);
  }
  if (!report.book_coverage || typeof report.book_coverage !== 'object') {
    throw new Error('report.book_coverage missing or invalid');
  }
  const coverageKeys = Object.keys(report.book_coverage);
  const expectedCount = OT_BOOKS_CANONICAL.length;
  if (coverageKeys.length < expectedCount) {
    throw new Error(`report.book_coverage missing keys: found ${coverageKeys.length}, expected ${expectedCount}`);
  }
  for (const key of OT_BOOKS_CANONICAL) {
    if (!(key in report.book_coverage)) {
      throw new Error(`report.book_coverage missing key ${key}`);
    }
  }
  const coverageSum = Object.entries(report.book_coverage)
    .filter(([book]) => OT_BOOK_SET.has(book))
    .reduce((sum, [, count]) => sum + (count || 0), 0);
  const expectedRefCount = rows.reduce((sum, row) => sum + (row.ot_ref_count || 0), 0);
  if (coverageSum !== expectedRefCount) {
    throw new Error(`book coverage sum ${coverageSum} does not match candidate ot_ref_count total ${expectedRefCount}`);
  }
  if (report.source_id !== DEFAULT_SOURCE_ID) {
    throw new Error(`report.source_id mismatch: ${report.source_id}`);
  }
}

if (validateOnly) {
  runValidateOnly();
} else {
  runGenerate();
}
