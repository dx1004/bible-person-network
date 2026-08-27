#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
    const bookNorm = normalizeBook(mWithBook[1]);
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

function extractGreekNameForms(raw) {
  return String(raw || '')
    .replace(/[«»]/g, '')
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter((x) => x && isGreekLike(x))
    .map((x) => normalizeUnicodeText(x))
    .filter((x) => x.length > 1);
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
  const xmlDirs = [
    path.join(sblDir, 'data', 'sblgntapp', 'xml'),
    path.join(sblDir, 'data', 'sblgnt', 'xml')
  ];
  const refs = new Set();
  const bookOrder = new Set();
  const verseTextByRef = new Map();
  const files = [];
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
  const personToTokens = new Map();
  for (const person of records) {
    const tokens = [];
    for (const sr of person.subrecords) {
      if (sr.language !== 'grc' || !sr.text) continue;
      for (const token of extractGreekNameForms(sr.text)) {
        tokens.push(token);
        if (!tokenToPersons.has(token)) tokenToPersons.set(token, []);
        if (!tokenToPersons.get(token).includes(person.unifiedName)) tokenToPersons.get(token).push(person.unifiedName);
      }
    }
    if (tokens.length) {
      personToTokens.set(person.unifiedName, [...new Set(tokens)]);
    }
  }

  const sblPersons = [];
  const seenPerson = new Set();

  for (const person of records) {
    const tokens = personToTokens.get(person.unifiedName) || [];
    const refs = collectRefs(person).filter((r) => r && r.book);

    if (!tokens.length || !refs.length) {
      report.person_status.pending += 1;
      continue;
    }

    let matchedAny = false;
    let ambiguousCount = 0;

    for (const ref of refs) {
      const verseText = sbl.verseTextByRef.get(ref.key);
      if (!verseText) {
        report.uncheckable_refs += 1;
        continue;
      }

      report.checked_refs += 1;
      const hitTokens = tokens.filter((token) => token && verseText.includes(token));
      if (!hitTokens.length) {
        report.unmatched_refs += 1;
        continue;
      }

      matchedAny = true;
      report.matched_refs += 1;
      const hitPersonSet = new Set();
      for (const token of hitTokens) {
        const names = tokenToPersons.get(token) || [];
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

    if (!seenPerson.has(person.unifiedName)) {
      sblPersons.push(person.unifiedName);
      seenPerson.add(person.unifiedName);
    }
  }

  return {
    sblPersons,
    report: {
      ...report,
      ambiguous_examples: report.ambiguous_examples.slice(0, 30),
      notes: 'Conservative scan by normalized Greek token match in SBLGNT verse text. Not a full NER; ambiguity and missing-reference cases stay pending.'
    }
  };
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
      if (parsed) current.subrecords.push(parsed);
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
    if (sr && Array.isArray(sr.refs)) out.push(...sr.refs);
  }
  return out.filter((x) => x && x.book);
}

function buildCorpus() {
  const stepPath = findStepFile(SOURCE_DIR);
  if (!stepPath) throw new Error(`Cannot find TIPNR file in ${SOURCE_DIR}`);
  const sbl = buildSblReferenceSet(SBL_DIR);
  const records = parseStepPersons(stepPath);
  const sblLexiconScan = buildSblLexiconScan(records.filter((person) => !person._skipForType), sbl);

  const ledger = [];
  const people = [];
  const names = [];
  const mentions = [];
  const assertions = [];
  const identityOptions = [];

  let pNo = 1;
  let nNo = 1;
  let mNo = 1;
  let aNo = 1;
  let idNo = 1;
  let excludedNoNt = 0;
  let excludedNonHuman = 0;
  let excludedPlaceholder = 0;
  const buildTimestamp = snapshot.includes('T') ? snapshot : `${snapshot}T00:00:00Z`;
  const now = buildTimestamp;

  const nameToId = new Map();
  const ntPeople = [];

  const allocatePersonId = () => `nt-people-${padNum(pNo++)}`;
  const allocateNameId = () => `name-${padNum(nNo++)}`;
  const allocateMentionId = () => `mnt-${padNum(mNo++)}`;
  const allocateAssertionId = () => `asrt-${padNum(aNo++)}`;
  const allocateOptionId = () => `idopt-${padNum(idNo++)}`;

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

    const personId = allocatePersonId();
    const canonicalName = person.unifiedName;
    const greekName = person.subrecords.find((sr) => sr.significance === 'greek')?.text || null;
    const latinized = canonicalPersonLabel(canonicalName);

    const personRow = {
      person_id: personId,
      canonical_chinese: null,
      canonical_greek: greekName,
      latinized,
      sex: person.sex,
      status: 'pending',
      identity_group: `nt-idgrp-${padNum(pNo - 1)}`,
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
    nameToId.set(person.unifiedKey.toLowerCase(), personId);

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
      mentions.push({
        mention_id: allocateMentionId(),
        person_id: personId,
        source_id: SOURCE_ID_STEP,
        passage: ref,
        location: 'STEP Proper Names',
        status: verified ? 'accepted' : 'pending',
        notes: verified ? '' : 'Reference not verified in SBLGNT verse map',
        editorial_rationale: 'Automated extraction from STEP Proper Names PERSON record.',
        created_at: now,
        updated_at: now
      });
      if (!verified) {
        ledger.push({
          kind: 'reconcile',
          reason: 'missing_in_sblgnt',
          person_id: personId,
          passage: ref,
          source: SOURCE_ID_STEP
        });
      }
    }

    identityOptions.push({
      option_id: allocateOptionId(),
      person_id: personId,
      identity_key: person.unifiedRaw,
      status: 'independent',
      identity_scope: 'default',
      rationale: 'Default conservative identity, no merges applied.',
      editor_note: `Auto-import from ${SOURCE_ID_STEP} (${path.basename(stepPath)})`,
      created_at: now,
      updated_at: now
    });
  }

  const keyToPersonId = new Map();
  for (const p of ntPeople) {
    const pid = nameToId.get(p.unifiedKey.toLowerCase());
    if (!pid) continue;
    keyToPersonId.set(canonicalPersonLabel(p.unifiedKey).toLowerCase(), pid);
    for (const sr of p.subrecords) {
      if (sr.text) keyToPersonId.set(canonicalPersonLabel(sr.text).toLowerCase(), pid);
    }
  }

  const seenRelations = new Set();
  for (const subject of ntPeople) {
    const subjectId = nameToId.get(subject.unifiedKey.toLowerCase());
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
        const targetId = keyToPersonId.get(canonicalPersonLabel(item.key).toLowerCase());
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
            reason: 'relation_target_missing',
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
        const objId = rel.direction === 'directed-reverse' ? subjectId : targetId;
        const subId = rel.direction === 'directed-reverse' ? targetId : subjectId;
        const relationSubtype = rel.type === 'offspring' ? 'child' : rel.type;
        const isLineage = rel.type === 'parent' || rel.type === 'offspring';
        const dedupeKey = isLineage
          ? `lineage|${relationSubtype}|${[subId, objId].sort().join(':')}`
          : `edge|${subId}|${objId}|${rel.type}|${item.uncertain ? 1 : 0}`;
        if (seenRelations.has(dedupeKey)) {
          ledger.push({
            kind: 'relation',
            reason: 'relation_duplicate',
            source: SOURCE_ID_STEP,
            subject: subject.unifiedRaw,
            target: item.raw,
            relation: rel.type
          });
          continue;
        }
        seenRelations.add(dedupeKey);
        assertions.push({
          assertion_id: allocateAssertionId(),
          subject_person_id: subId,
          object_person_id: objId,
          relation_type: 'kinship',
          relation_subtype: relationSubtype,
          direction: rel.direction === 'undirected' ? 'undirected' : 'directed',
          evidence,
          status: 'inactive',
          confidence: item.uncertain ? 0.35 : 0.8,
          editorial_status: 'pending',
          editor_note: `From TIPNR relation field "${rel.type}"`,
          created_at: now,
          updated_at: now
        });
      }
    }
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
  writeJson(path.join(DATA_DIR, 'reconciliation.json'), {
    generatedAt: now,
    stepFile: `${SOURCE_ID_STEP}/${path.basename(stepPath)}`,
    source_dirs: { step: SOURCE_ID_STEP, sblgnt: SOURCE_ID_SBL },
    sbl_verified_refs: [...new Set(mentions.filter((m) => m.status === 'accepted').map((m) => m.passage))],
    sbl_missing_refs: [...new Set(mentions.filter((m) => m.status === 'pending').map((m) => m.passage))],
    sbl_greek_verification: sblLexiconScan.report,
    sbl_person_scan: {
      method: SBL_GREEK_SCAN,
      status: 'implemented_limited',
      total_sbl_scan_persons: sblLexiconScan.sblPersons.length
    },
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
