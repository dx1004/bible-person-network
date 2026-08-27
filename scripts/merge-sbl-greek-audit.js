#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_A_PATH = path.join(ROOT, 'editorial', 'reviewer-a-sbl-audit.jsonl');
const REVIEW_B_PATH = path.join(ROOT, 'editorial', 'reviewer-b-sbl-audit.jsonl');
const OUTPUT_PATH = path.join(ROOT, 'editorial', 'sblgnt-name-review.jsonl');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'sblgnt-name-review.schema.json');
const CANONICAL_AUDIT_PATH = path.join(ROOT, 'data', 'sblgnt-name-audit.jsonl');
const SCOPE_OVERRIDE_PATH = path.join(ROOT, 'editorial', 'person-scope-overrides.jsonl');
const SBL_TEXT_PATHS = [
  path.join(ROOT, '.sources', 'sblgnt', 'data', 'sblgnt', 'text'),
  path.join(ROOT, '.sources', 'sblgntapp', 'data', 'sblgnt', 'text')
];
const SBL_FILE_STEM_MAP = new Map([
  ['Matt', 'MAT'], ['Mark', 'MRK'], ['Luke', 'LUK'], ['John', 'JHN'], ['Acts', 'ACT'], ['Rom', 'ROM'],
  ['1Cor', '1CO'], ['2Cor', '2CO'], ['Gal', 'GAL'], ['Eph', 'EPH'], ['Phil', 'PHP'], ['Col', 'COL'],
  ['1Thess', '1TH'], ['2Thess', '2TH'], ['1Tim', '1TI'], ['2Tim', '2TI'], ['Titus', 'TIT'],
  ['Phlm', 'PHM'], ['Heb', 'HEB'], ['Jas', 'JAS'], ['1Pet', '1PE'], ['2Pet', '2PE'],
  ['1John', '1JN'], ['2John', '2JN'], ['3John', '3JN'], ['Jude', 'JUD'], ['Rev', 'REV']
]);
const NT_BOOK_MAP = new Map([
  ['MAT', 'MAT'], ['MRK', 'MRK'], ['LUK', 'LUK'], ['JHN', 'JHN'], ['ACT', 'ACT'], ['ROM', 'ROM'],
  ['1COR', '1CO'], ['2COR', '2CO'], ['GAL', 'GAL'], ['EPH', 'EPH'], ['PHP', 'PHP'], ['COL', 'COL'],
  ['1THESS', '1TH'], ['2THESS', '2TH'], ['1TH', '1TH'], ['2TH', '2TH'], ['1TIM', '1TI'], ['2TIM', '2TI'],
  ['1TI', '1TI'], ['2TI', '2TI'], ['TIT', 'TIT'], ['PHLM', 'PHM'],
  ['HEB', 'HEB'], ['JAS', 'JAS'], ['1PET', '1PE'], ['2PET', '2PE'], ['1JHN', '1JN'], ['2JHN', '2JN'], ['3JHN', '3JN'],
  ['JUDE', 'JUD'], ['JUD', 'JUD'], ['REV', 'REV'], ['PHM', 'PHM'],
  ['Mat', 'MAT'], ['Matt', 'MAT'], ['Mt', 'MAT'], ['Mrk', 'MRK'], ['Mk', 'MRK'], ['Mark', 'MRK'],
  ['Luk', 'LUK'], ['Luke', 'LUK'], ['Joh', 'JHN'], ['Jn', 'JHN'], ['John', 'JHN'],
  ['Act', 'ACT'], ['Acts', 'ACT'], ['Rom', 'ROM'], ['1Cor', '1CO'], ['2Cor', '2CO'],
  ['Gal', 'GAL'], ['Eph', 'EPH'], ['Php', 'PHP'], ['Col', 'COL'],
  ['1Th', '1TH'], ['2Th', '2TH'], ['1Ti', '1TI'], ['2Ti', '2TI'], ['Tit', 'TIT'], ['Phm', 'PHM'],
  ['Heb', 'HEB'], ['Jas', 'JAS'], ['James', 'JAS'], ['1Pe', '1PE'], ['2Pe', '2PE'],
  ['1Jn', '1JN'], ['2Jn', '2JN'], ['3Jn', '3JN'], ['Jude', 'JUD'], ['Rev', 'REV']
]);
const NT_BOOKS = new Set([...NT_BOOK_MAP.values()]);

const argv = process.argv.slice(2);
const validateOnly = argv.includes('--validate-only');

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSONL ${path.basename(filePath)}:${index + 1}: ${err.message}`);
    }
  });
}

function writeJsonl(filePath, rows) {
  const data = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${data}${rows.length ? '\n' : ''}`);
}

function normalizeWord(raw) {
  return String(raw || '').normalize('NFKC').replace(/[\u200b]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeBook(raw) {
  const token = String(raw || '').replace(/\.$/, '').trim();
  return NT_BOOK_MAP.get(token) || NT_BOOK_MAP.get(token.replace('.', '')) || null;
}

function normalizePassage(raw) {
  const m = normalizeWord(raw).match(/^([1-3]?[A-Za-z]+)\.?[\s-]*([0-9]+):([0-9]+)/i);
  if (!m) return null;
  const book = normalizeBook(m[1]);
  if (!book || !NT_BOOKS.has(book)) return null;
  return `${book} ${Number(m[2])}:${Number(m[3])}`;
}

function buildSblVerseMap() {
  const verseTextByRef = new Map();
  for (const dir of SBL_TEXT_PATHS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.txt'))) {
      const stem = path.parse(file).name;
      const book = SBL_FILE_STEM_MAP.get(stem);
      if (!book || !NT_BOOKS.has(book)) continue;
      for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/)) {
        const firstTab = line.indexOf('\t');
        if (firstTab < 0) continue;
        const left = line.slice(0, firstTab).trim();
        const text = normalizeWord(line.slice(firstTab + 1));
        const mm = left.match(/^(?:[1-3]?[A-Za-z]+\.?\s*)?(\d+):(\d+)$/);
        if (!mm) continue;
        const ref = `${book} ${Number(mm[1])}:${Number(mm[2])}`;
        verseTextByRef.set(ref, text);
      }
    }
  }
  return verseTextByRef;
}

function readReview(filePath, reviewer) {
  const rows = readJsonl(filePath);
  const out = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.person_key || !['accepted', 'rejected', 'pending'].includes(row.status) || !row.passage || !row.sbl_surface_form || !row.decision_note) {
      throw new Error(`${path.basename(filePath)}:${i + 1} missing required fields`);
    }
    if (out.has(row.person_key)) throw new Error(`Duplicate person_key in ${path.basename(filePath)}: ${row.person_key}`);
    const normalizedPassage = normalizePassage(row.passage);
    if (!normalizedPassage) throw new Error(`Invalid passage in ${path.basename(filePath)}:${i + 1}: ${row.passage}`);
    out.set(row.person_key, {
      reviewer,
      status: row.status,
      passage: normalizedPassage,
      passageRaw: String(row.passage),
      sblSurface: normalizeWord(row.sbl_surface_form),
      sblSurfaceRaw: String(row.sbl_surface_form),
      decisionNote: String(row.decision_note)
    });
  }
  return out;
}

function loadScopeExclusions() {
  if (!fs.existsSync(SCOPE_OVERRIDE_PATH)) return new Set();
  const rows = readJsonl(SCOPE_OVERRIDE_PATH);
  const excluded = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (row.decision === 'exclude' && row.person_key) {
      excluded.add(String(row.person_key).trim());
    }
  }
  return excluded;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
  const snapshot = String(manifest.created_at || '').trim() || new Date().toISOString();
  const aMap = readReview(REVIEW_A_PATH, 'reviewer-a');
  const bMap = readReview(REVIEW_B_PATH, 'reviewer-b');

  const canonicalAudit = readJsonl(CANONICAL_AUDIT_PATH);
  const allAuditRows = new Map(
    canonicalAudit
      .filter((row) => row && row.person_key)
      .map((row) => [row.person_key, row])
  );
  const excludedByScope = loadScopeExclusions();
  const reviewClassification = new Set(['independently_verified_surface_identity', 'independently_rejected_identity']);

  const keysA = [...aMap.keys()].sort();
  const keysB = [...bMap.keys()].sort();
  if (keysA.length !== keysB.length || keysA.join('\u0000') !== keysB.join('\u0000')) {
    throw new Error('Reviewer key-set mismatch');
  }
  const canonicalKeys = keysA.filter((personKey) => allAuditRows.has(personKey) || excludedByScope.has(personKey));
  if (keysA.length !== canonicalKeys.length) {
    throw new Error('Reviewer key-set must exactly cover canonical unmatched SBL audit rows');
  }
  const nonAuthoritativeKeys = keysA.filter((key) => !allAuditRows.has(key) && !excludedByScope.has(key));
  if (nonAuthoritativeKeys.length) {
    throw new Error(`Reviewer keys do not exist in canonical scan rows: ${nonAuthoritativeKeys.join(', ')}`);
  }
  const authoritativeAudit = new Map(
    keysA
      .map((personKey) => [personKey, allAuditRows.get(personKey)])
      .filter((entry) => entry[1])
      .map(([personKey, row]) => {
        if (row && !reviewClassification.has(row.classification)) {
          throw new Error(`Review target ${personKey} has unsupported classification ${row.classification}`);
        }
        return [personKey, row];
      })
  );
  if (authoritativeAudit.size > keysA.length) {
    throw new Error(`Authoritative review coverage must not exceed reviewed rows: ${authoritativeAudit.size}/${keysA.length}`);
  }

  const sblVerseMap = buildSblVerseMap();
  const rows = [];
  let accepted = 0;
  let rejected = 0;
  let pending = 0;

  for (const personKey of keysA) {
    const a = aMap.get(personKey);
    const b = bMap.get(personKey);
    const latinized = personKey.split('@')[0].replace(/=.*/, '').trim();
    const passage = a.passage || b.passage;
    const sblSurface = a.sblSurface || b.sblSurface;
    const auditEntry = authoritativeAudit.get(personKey);
    const checkedPassages = new Set(auditEntry?.checked_passages || []);
    if (auditEntry && (!checkedPassages.has(a.passage) || !checkedPassages.has(b.passage))) {
      throw new Error(`Reviewer passage is not among canonical checked passages for ${personKey}`);
    }

    const verseText = sblVerseMap.get(passage);
    const surfaceExists = !!(verseText && verseText.includes(sblSurface));

    const samePassage = a.passage === b.passage;
    const sameSurface = a.sblSurface === b.sblSurface;
    const acceptedAgreement = a.status === 'accepted' && b.status === 'accepted'
      && samePassage && sameSurface && surfaceExists;
    const rejectedAgreement = a.status === 'rejected' && b.status === 'rejected' && samePassage && sameSurface;

    let finalStatus;
    let finalDecision;
    let finalNote;

    if (acceptedAgreement) {
      finalStatus = 'accepted';
      finalDecision = 'accepted';
      finalNote = `两位审校一致通过且位点 ${passage} 包含表面形态 ${sblSurface}。`;
      accepted += 1;
    } else if (rejectedAgreement) {
      finalStatus = 'excluded';
      finalDecision = 'rejected';
      finalNote = `两位审校一致否决 ${personKey}（${passage}）。`;
      rejected += 1;
    } else {
      finalStatus = 'pending';
      finalDecision = 'pending';
      finalNote = '两位审校未形成可入库一致结论（状态/位点/形态或文本核验不一致）。';
      pending += 1;
    }

    rows.push({
      review_id: `sbl-audit-${String(rows.length + 1).padStart(4, '0')}`,
      person_key: personKey,
      latinized,
      sbl_surface_form: sblSurface,
      sbl_passage: passage,
      sbl_surface_verified: finalStatus === 'accepted' && surfaceExists,
      sbl_verification_source: 'sblgnt-text',
      scan_status: null,
      scan_status_note: '',
      scan_greek_tokens: [],
      scan_classification: null,
      scan_checked_passages: passage ? [passage] : [],
      scan_matched_passages: finalStatus === 'accepted' ? [passage] : [],
      scan_unmatched_passages: finalStatus !== 'accepted' ? [passage] : [],
      scan_uncheckable_passages: [],
      reviewer_a: { reviewer: 'reviewer-a', status: a.status, passage: a.passageRaw, sbl_surface_form: a.sblSurfaceRaw, decision_note: a.decisionNote },
      reviewer_b: { reviewer: 'reviewer-b', status: b.status, passage: b.passageRaw, sbl_surface_form: b.sblSurfaceRaw, decision_note: b.decisionNote },
      round1: { reviewer: 'reviewer-a', status: a.status, passage: a.passageRaw, sbl_surface_form: a.sblSurfaceRaw, decision_note: a.decisionNote },
      round2: { reviewer: 'reviewer-b', status: b.status, passage: b.passageRaw, sbl_surface_form: b.sblSurfaceRaw, decision_note: b.decisionNote },
      final_status: finalStatus,
      final_decision: finalDecision,
      final_decision_note: finalNote,
      method: 'independent_reviewer_merge_sbl_surface_match',
      source_snapshot: snapshot,
      created_at: snapshot,
      updated_at: snapshot
    });
  }

  if (rows.length !== keysA.length) {
    throw new Error(`Expected ${keysA.length} authoritative rows, got ${rows.length}`);
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: true, validateSchema: false }).compile(schema);
  const errors = [];
  rows.forEach((row, index) => {
    if (!validate(row)) {
      (validate.errors || []).forEach((e) => {
        const loc = e.instancePath || e.dataPath || 'root';
        errors.push(`sblgnt-name-review.jsonl#${index + 1}: ${loc} ${e.message}`);
      });
    }
  });
  if (errors.length) {
    throw new Error(`Schema validation failed:\n${errors.join('\n')}`);
  }

  if (!validateOnly) {
    writeJsonl(OUTPUT_PATH, rows);
  }

  return { rows, accepted, rejected, pending };
}

const result = main();
console.log(JSON.stringify({
  status: 'ok',
  accepted: result.accepted,
  rejected: result.rejected,
  pending: result.pending,
  total: result.rows.length
}, null, 2));
