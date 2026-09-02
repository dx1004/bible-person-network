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
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'tahot-totht-coverage-audit.schema.json');
const REPORT_SCHEMA_PATH = path.join(ROOT, 'schemas', 'tahot-totht-coverage-audit-report.schema.json');
const CANDIDATES_PATH = path.join(EDITORIAL_DIR, 'old-testament-person-candidates.jsonl');
const OUTPUT_PATH = path.join(EDITORIAL_DIR, 'tahot-totht-coverage-audit.jsonl');
const REPORT_PATH = path.join(EDITORIAL_DIR, 'tahot-totht-coverage-audit-report.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const DEFAULT_TAHOT_DIR = path.join(ROOT, '.sources', 'stepbible-data', 'Translators Amalgamated OT+NT');
const DEFAULT_TOTHT_DIR = path.join(DEFAULT_TAHOT_DIR, 'OLD format TOTHT');

const KNOWN_TAHOT_FILES = [
  'TAHOT Gen-Deu - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  'TAHOT Jos-Est - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  'TAHOT Job-Sng - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  'TAHOT Isa-Mal - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt'
];

const KNOWN_TOTHT_FILES = [
  'TOTHT Gen-Deu - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt',
  'TOTHT Jos-Est - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt',
  'TOTHT Job-Sng - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt',
  'TOTHT Isa-Mal - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt'
];

const BOOK_CANONICAL_MAP = new Map([
  ['Gen', 'GEN'], ['Gn', 'GEN'], ['Ex', 'EXO'], ['Exo', 'EXO'], ['Exod', 'EXO'], ['Exo', 'EXO'],
  ['Lev', 'LEV'], ['Le', 'LEV'], ['Leviticus', 'LEV'], ['Lv', 'LEV'],
  ['Num', 'NUM'], ['Nm', 'NUM'], ['Numbers', 'NUM'],
  ['Deu', 'DEU'], ['Deut', 'DEU'], ['De', 'DEU'],
  ['Jos', 'JOS'], ['Josh', 'JOS'], ['JOS', 'JOS'],
  ['Jdg', 'JDG'], ['Jg', 'JDG'], ['Judg', 'JDG'],
  ['Ruth', 'RUT'], ['Rut', 'RUT'],
  ['1Sa', '1SA'], ['2Sa', '2SA'], ['1Ki', '1KI'], ['2Ki', '2KI'],
  ['1Ch', '1CH'], ['2Ch', '2CH'], ['Ezr', 'EZR'], ['Ezra', 'EZR'],
  ['Neh', 'NEH'], ['Est', 'EST'],
  ['Job', 'JOB'],
  ['Psa', 'PSA'], ['Ps', 'PSA'],
  ['Pr', 'PRO'], ['Pro', 'PRO'], ['Pro', 'PRO'],
  ['Ecc', 'ECC'],
  ['Song', 'SNG'], ['Ss', 'SNG'], ['Sng', 'SNG'],
  ['Isa', 'ISA'], ['Is', 'ISA'],
  ['Jer', 'JER'], ['Je', 'JER'],
  ['Lam', 'LAM'], ['La', 'LAM'],
  ['Eze', 'EZE'], ['Ez', 'EZE'], ['Ze', 'EZE'], ['Ezk', 'EZE'],
  ['Dan', 'DAN'],
  ['Hos', 'HOS'],
  ['Joe', 'JOL'], ['Joel', 'JOL'], ['Jol', 'JOL'],
  ['Am', 'AMO'], ['Amo', 'AMO'],
  ['Oba', 'OBA'], ['Ob', 'OBA'],
  ['Jon', 'JON'],
  ['Mic', 'MIC'],
  ['Nah', 'NAH'], ['Nam', 'NAH'],
  ['Hab', 'HAB'],
  ['Zeph', 'ZEP'], ['Zep', 'ZEP'],
  ['Hag', 'HAG'],
  ['Zec', 'ZEC'],
  ['Mal', 'MAL']
]);

const BOOK_SET = new Set(BOOK_CANONICAL_MAP.values());

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

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw
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

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest?.created_at) throw new Error('data/manifest.json missing created_at');
  if (Number.isNaN(Date.parse(manifest.created_at))) throw new Error('manifest.created_at is not a valid date');
  return manifest;
}

function canonicalizeBook(rawBook) {
  if (!rawBook) return null;
  const token = String(rawBook).replace('.', '').trim();
  return BOOK_CANONICAL_MAP.get(token) || null;
}

function normalizeCode(raw) {
  const match = String(raw).match(/=\s*([GH][0-9]{4}[A-Z]?)/i);
  if (!match) return null;
  return match[1].toUpperCase();
}

function baseStrongCode(raw) {
  const normalized = String(raw || '').toUpperCase();
  const match = normalized.match(/^([GH][0-9]{4})[A-Z]?$/);
  return match ? match[1] : normalized;
}

function gatherFiles() {
  const tahotDir = parseArg('tahot-data-dir', DEFAULT_TAHOT_DIR);
  const tothtDir = parseArg('toth-dir', DEFAULT_TOTHT_DIR);
  const tahotPaths = KNOWN_TAHOT_FILES.map((name) => path.join(tahotDir, name));
  const tothtPaths = KNOWN_TOTHT_FILES.map((name) => path.join(tothtDir, name));
  const all = [...tahotPaths, ...tothtPaths];
  const missing = all.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    throw new Error(`Missing required source file(s):\n${missing.join('\n')}`);
  }
  return all.map((filePath) => ({
    path: filePath,
      source_path: path.relative(ROOT, filePath).split(path.sep).join('/'),
    kind: filePath.includes(`${path.sep}OLD format TOTHT${path.sep}`) ? 'totht' : 'tahot',
    relativePath: path.relative(ROOT, filePath)
  }));
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseCodeLines(lines) {
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.replace(/\uFEFF/g, '').trim();
    if (!line) continue;
    if (/^=+$/.test(line)) continue;

    const codeMatches = new Set();
    for (const match of rawLine.matchAll(/\b([GH][0-9]{4}[A-Z]?)\b/g)) {
      codeMatches.add(match[1].toUpperCase());
    }
    if (codeMatches.size === 0) continue;

    const normalizedLine = rawLine.replace(/[\u200b-\u200d]/g, '');
    const refs = new Set();
    for (const refMatch of normalizedLine.matchAll(/\b([1-3]?[A-Za-z]{2,4})\.([0-9]{1,3})[\.-]([0-9]{1,3})/g)) {
      const book = canonicalizeBook(refMatch[1]);
      const chapter = Number(refMatch[2]);
      const verse = Number(refMatch[3]);
      if (!book || !BOOK_SET.has(book) || !Number.isFinite(chapter) || !Number.isFinite(verse)) continue;
      refs.add(`${book} ${chapter}:${verse}`);
    }

    out.push({
      lineNo: index + 1,
      text: rawLine,
      codes: [...codeMatches],
      refs: [...refs]
    });
  }
  return out;
}

function buildSourceInventory(sourceFiles) {
  const rows = [];
  for (const sourceFile of sourceFiles) {
    const raw = fs.readFileSync(sourceFile.path, 'utf8');
    const lines = raw.split('\n');
    const parsed = parseCodeLines(lines);
    const verseSet = new Set();
    const bookCounts = {};

    for (const row of parsed) {
      for (const ref of row.refs) {
        verseSet.add(ref);
        const book = ref.split(' ')[0];
        bookCounts[book] = (bookCounts[book] || 0) + 1;
      }
    }

    rows.push({
      source_path: sourceFile.source_path,
      source_kind: sourceFile.kind,
      sha256: fileHash(sourceFile.path),
      bytes: Buffer.byteLength(raw),
      line_count: lines.length,
      data_line_count: parsed.length,
      verse_reference_count: verseSet.size,
      books_covered: Object.keys(bookCounts).filter((book) => bookCounts[book] > 0).sort(),
      parsed_lines: parsed
    });
  }
  return rows;
}

function validateSchema(schemaPath, rows) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const targetRows = Array.isArray(rows) ? rows : [rows];
  for (let idx = 0; idx < targetRows.length; idx += 1) {
    const row = targetRows[idx];
    if (!validate(row)) {
      const details = (validate.errors || []).map((err) => `${err.instancePath || err.dataPath}: ${err.message}`).join('; ');
      const scope = Array.isArray(rows) ? `line ${idx + 1}` : 'root';
      throw new Error(`Schema validation failed at ${path.basename(schemaPath)} ${scope}: ${details}`);
    }
  }
}

function compareExpected(expected, actual) {
  const stable = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  };
  if (stable(expected) !== stable(actual)) {
    throw new Error('validate-only mismatch: recomputed output differs from committed artifact');
  }
}

function findSourceRevisions(sourceId) {
  const sources = readJsonl(path.join(DATA_DIR, 'sources.jsonl'));
  const source = sources.find((entry) => entry.source_id === sourceId);
  if (!source || !Array.isArray(source.file_hashes)) {
    return null;
  }
  return new Map(source.file_hashes.map((entry) => [entry.source_path, entry]));
}

function writeJsonl(filePath, rows) {
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, text ? `${text}\n` : '', 'utf8');
}

function writeReport(filePath, report) {
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const validateOnly = process.argv.includes('--validate-only');
  const outputPath = parseArg('output', OUTPUT_PATH);
  const reportPath = parseArg('report', REPORT_PATH);

  const candidates = readJsonl(CANDIDATES_PATH);
  const sourceFiles = gatherFiles();
  const sourceInventory = buildSourceInventory(sourceFiles);
  const manifest = readManifest();
  const manifestCreatedAt = manifest.created_at;

  const codeToCandidateIds = new Map();
  const baseCodeToCandidateIds = new Map();
  const rowsByCandidate = new Map();

  for (const candidate of candidates) {
    const codes = new Set();
    const fromStep = normalizeCode(candidate.step_unified_raw || '');
    if (fromStep) codes.add(fromStep);

    const namedCodes = Array.isArray(candidate.names)
      ? candidate.names.flatMap((item) => {
          if (!item || typeof item.name_text !== 'string') return [];
          return [...item.name_text.matchAll(/\b([GH][0-9]{4}[A-Z]?)\b/g)].map((m) => m[1].toUpperCase());
        })
      : [];

    for (const code of namedCodes) codes.add(code);

    const candidateCodes = Array.from(codes).sort();
    const buckets = {
      candidate,
      candidate_refs: new Set(Array.isArray(candidate.ot_refs) ? candidate.ot_refs : []),
      tahot_lines: 0,
      totht_lines: 0,
      matched_codes: new Set(),
      ambiguous_codes: new Set(),
      source_files_seen: new Set(),
      sample_refs: new Set(),
      source_code_hits: {}
    };

    rowsByCandidate.set(candidate.candidate_id, buckets);
    for (const code of candidateCodes) {
      const list = codeToCandidateIds.get(code) || [];
      list.push({ candidateId: candidate.candidate_id, candidateCode: code });
      codeToCandidateIds.set(code, list);
      const baseCode = baseStrongCode(code);
      if (baseCode !== code) {
        const baseList = baseCodeToCandidateIds.get(baseCode) || [];
        baseList.push({ candidateId: candidate.candidate_id, candidateCode: code });
        baseCodeToCandidateIds.set(baseCode, baseList);
      }
    }
    buckets.source_code_hits = Object.fromEntries(candidateCodes.map((code) => [code, { tahot: 0, totht: 0, total: 0 }]));
  }

  for (const source of sourceInventory) {
    for (const line of source.parsed_lines) {
      for (const code of line.codes) {
        const candidateEntries = [
          ...(codeToCandidateIds.get(code) || []),
          ...(baseCodeToCandidateIds.get(code) || [])
        ];
        if (!candidateEntries.length) continue;

        const matchedEntries = candidateEntries.filter(({ candidateId }) => {
          const bucket = rowsByCandidate.get(candidateId);
          if (!bucket) return false;
          if (!line.refs.length || !bucket.candidate_refs.size) return true;
          return line.refs.some((ref) => bucket.candidate_refs.has(ref));
        });
        if (!matchedEntries.length) continue;

        for (const { candidateId, candidateCode } of matchedEntries) {
          const bucket = rowsByCandidate.get(candidateId);
          if (!bucket) continue;

          const key = `${source.relativePath}:${line.lineNo}`;
          const hitBucket = bucket.source_code_hits[candidateCode] || { tahot: 0, totht: 0, total: 0 };
          if (source.kind === 'tahot') {
            hitBucket.tahot += 1;
            bucket.tahot_lines += 1;
          } else {
            hitBucket.totht += 1;
            bucket.totht_lines += 1;
          }
          hitBucket.total += 1;
          bucket.source_code_hits[candidateCode] = hitBucket;
          bucket.matched_codes.add(candidateCode);
          if (matchedEntries.length > 1) bucket.ambiguous_codes.add(candidateCode);
          bucket.source_files_seen.add(source.source_path || source.relativePath);
          for (const ref of line.refs) {
            if (bucket.sample_refs.size >= 12) break;
            bucket.sample_refs.add(ref);
          }
        }
      }
    }
  }

  const rows = [];
  for (const [candidateId, bucket] of rowsByCandidate.entries()) {
    const totalHits = bucket.tahot_lines + bucket.totht_lines;
    const covered = totalHits > 0;
    const ambiguous = covered && [...bucket.matched_codes].every((code) => bucket.ambiguous_codes.has(code));
    const status = !covered ? 'unmatched' : ambiguous ? 'ambiguous' : 'covered';
    const sourceCodeHits = Object.entries(bucket.source_code_hits).map(([code, hit]) => ({
      code,
      tahot_hit_lines: hit.tahot,
      totht_hit_lines: hit.totht,
      total_hit_lines: hit.total
    }));

    rows.push({
      audit_id: `ttca-${candidateId}`,
      candidate_id: candidateId,
      step_identity_key: bucket.candidate.step_identity_key,
      canonical_name: bucket.candidate.canonical_name,
      candidate_decision: bucket.candidate.candidate_decision || 'pending',
      status,
      strong_codes: Object.keys(bucket.source_code_hits),
      source_code_hits: sourceCodeHits,
      tahot_hit_count: bucket.tahot_lines,
      totht_hit_count: bucket.totht_lines,
      matched_strength_codes: [...bucket.matched_codes],
      ambiguous_strength_codes: [...bucket.ambiguous_codes],
      source_files_seen: [...bucket.source_files_seen].map((value) => String(value)),
      sample_refs: [...bucket.sample_refs].slice(0, 12),
      generated_at: manifestCreatedAt,
      audit_note: 'Independent TAHOT/TOTHT coverage audit; no editorial decisions are applied.'
    });
  }

  rows.sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));

  const sourceBooks = new Set();
  for (const entry of sourceInventory) {
    for (const book of entry.books_covered || []) {
      sourceBooks.add(book);
    }
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const report = {
    audit_version: '1.0',
    generated_at: manifestCreatedAt,
    manifest_created_at: manifestCreatedAt,
    scope: 'independent',
    source_id: 'source:0005',
    status_pending: 'coverage audit only, not acceptance',
    source_file_count: sourceInventory.length,
    candidate_total: rows.length,
    status_summary: {
      covered: counts.covered || 0,
      ambiguous: counts.ambiguous || 0,
      unmatched: counts.unmatched || 0
    },
    books: {
      total_expected: BOOK_SET.size,
      covered: [...sourceBooks].sort(),
      covered_count: sourceBooks.size
    },
    source_files: sourceInventory.map((entry) => ({
      source_path: entry.source_path,
      source_kind: entry.source_kind,
      sha256: entry.sha256,
      bytes: entry.bytes,
      line_count: entry.line_count,
      data_line_count: entry.data_line_count,
      verse_reference_count: entry.verse_reference_count
    })),
    note: '独立覆盖审计：不产生任何发布人物或关系的可见变更。'
  };

  if (validateOnly && !fs.existsSync(outputPath)) {
    throw new Error(`validate-only requested but output missing: ${outputPath}`);
  }
  if (validateOnly && !fs.existsSync(reportPath)) {
    throw new Error(`validate-only requested but report missing: ${reportPath}`);
  }

  validateSchema(SCHEMA_PATH, rows);
  validateSchema(REPORT_SCHEMA_PATH, report);

  if (sourceInventory.length !== 8) {
    throw new Error(`Invalid source file inventory count: expected 8, got ${sourceInventory.length}`);
  }

  if (report.source_file_count !== sourceInventory.length) {
    throw new Error(`Source file count mismatch: report=${report.source_file_count}, actual=${sourceInventory.length}`);
  }

  if (report.candidate_total !== rows.length) {
    throw new Error(`Candidate total mismatch: report=${report.candidate_total}, actual=${rows.length}`);
  }

  if (report.source_files.length !== sourceInventory.length) {
    throw new Error(`Source file list mismatch: report list=${report.source_files.length}, actual=${sourceInventory.length}`);
  }

  const sumStatus = (counts.covered || 0) + (counts.ambiguous || 0) + (counts.unmatched || 0);
  if (sumStatus !== rows.length) {
    throw new Error(`Status summary mismatch: covered+ambiguous+unmatched=${sumStatus}, actual=${rows.length}`);
  }

  if (report.books.total_expected !== BOOK_SET.size) {
    throw new Error(`Expected book count mismatch: report=${report.books.total_expected}, actual=${BOOK_SET.size}`);
  }
  if (report.books.covered_count !== sourceBooks.size) {
    throw new Error(`Covered book count mismatch: report=${report.books.covered_count}, actual=${sourceBooks.size}`);
  }

  const sourceRevisionMap = findSourceRevisions('source:0005');
  if (!sourceRevisionMap) {
    throw new Error('source:0005 file_hashes not found in data/sources.jsonl');
  }

  for (const entry of report.source_files) {
    const sourceRevision = sourceRevisionMap.get(entry.source_path);
    if (!sourceRevision) {
      throw new Error(`source:0005 missing file hash entry for ${entry.source_path}`);
    }
    if (sourceRevision.sha256 !== entry.sha256) {
      throw new Error(`source hash mismatch for ${entry.source_path}: manifest=${sourceRevision.sha256}, report=${entry.sha256}`);
    }
    if (sourceRevision.bytes !== entry.bytes) {
      throw new Error(`source byte count mismatch for ${entry.source_path}: manifest=${sourceRevision.bytes}, report=${entry.bytes}`);
    }
  }

  if (validateOnly) {
    const existingRows = readJsonl(outputPath);
    const existingReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    compareExpected(rows, existingRows);
    compareExpected(report, existingReport);
    console.log(`TAHOT/TOTHT audit validate-only passed: candidates=${rows.length}, books=${sourceBooks.size}/${BOOK_SET.size}`);
    return;
  }

  writeJsonl(outputPath, rows);
  writeReport(reportPath, report);

  console.log(`audit rows: ${rows.length}`);
  console.log(`coverage: covered=${counts.covered || 0} ambiguous=${counts.ambiguous || 0} unmatched=${counts.unmatched || 0}`);
}

main();
