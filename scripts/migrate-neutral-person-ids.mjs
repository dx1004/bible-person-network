#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LEGACY_PREFIX = /^nt-people-(\d{4})$/;
const CANONICAL_PREFIX = /^person-(\d{6})$/;
const ALLOWLIST_UNMAPPED_LEGACY_IDS = new Set([
  'nt-people-0136',
  'nt-people-0157',
  'nt-people-0248',
]);

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const APPLY = args.has('apply');
const CHECK = args.has('check');
const REPAIR = args.has('repair') || args.has('repair-metadata') || args.has('repair-signatures') || args.has('repair-map');
const REPAIR_SIGNatures = args.has('repair-signatures') || args.has('repair') || args.has('repair-metadata');
const REPAIR_MAP = args.has('repair-map') || args.has('repair') || args.has('repair-metadata');
const ROOT = args.get('root') ? path.resolve(process.cwd(), args.get('root')) : process.cwd();

const MANIFEST_PATH = path.join(ROOT, 'data', 'manifest.json');
const MIGRATION_FILES = [
  ['data/people.jsonl', [['person_id'], ['legacy_ids']]],
  ['data/names.jsonl', [['person_id']]],
  ['data/mentions.jsonl', [['person_id']]],
  ['data/assertions.jsonl', [['subject_person_id'], ['object_person_id']]],
  ['data/identity-options.jsonl', [['person_id'], ['merge_target_person_id']]],
  ['data/review-ledger.jsonl', [['person_id']]],
  ['editorial/chinese-name-overrides.jsonl', [['person_id']]],
  ['editorial/chinese-name-candidates.jsonl', [['person_id']]],
  ['editorial/chinese-name-review.jsonl', [['person_id']]],
  ['editorial/relationship-seeds.jsonl', [['subject_person_id'], ['object_person_id']]],
  ['editorial/relationship-review.jsonl', [['subject_person_id'], ['object_person_id'], ['assertion_snapshot', 'subject_person_id'], ['assertion_snapshot', 'object_person_id']]],
  ['editorial/reviewer-a-chinese.jsonl', [['person_id']]],
  ['editorial/reviewer-b-chinese.jsonl', [['person_id']]],
  ['editorial/reviewer-a-v2-chinese.jsonl', [['person_id']]],
  ['editorial/reviewer-b-v2-chinese.jsonl', [['person_id']]],
];
const LEGACY_FREE_JSON_FILES = [
  'editorial/relationship-coverage-inventory.json',
];

function readJsonl(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function hashSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadManifestCreatedAt() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest || !manifest.created_at) {
    throw new Error('manifest created_at not found.');
  }
  return manifest.created_at;
}

function buildPeopleMap(peoplePath) {
  const rows = readJsonl(peoplePath);
  const legacyToCanonical = new Map();
  const canonicalPeople = new Set();

  for (const row of rows) {
    const personId = row.person_id;
    if (!CANONICAL_PREFIX.test(personId) && !LEGACY_PREFIX.test(personId)) {
      throw new Error(`Invalid person_id in data/people.jsonl: ${personId}`);
    }

    const canonicalPersonId = CANONICAL_PREFIX.test(personId)
      ? personId
      : `person-${personId.slice('nt-people-'.length).padStart(6, '0')}`;
    canonicalPeople.add(canonicalPersonId);

    const legacyIds = [];
    if (LEGACY_PREFIX.test(personId)) {
      legacyIds.push(personId);
    }

    const personLegacyIds = Array.isArray(row.legacy_ids) ? row.legacy_ids : [];
    for (const legacyId of personLegacyIds) {
      if (LEGACY_PREFIX.test(legacyId)) {
        legacyIds.push(legacyId);
      }
    }

    for (const legacyId of legacyIds) {
      if (legacyToCanonical.has(legacyId) && legacyToCanonical.get(legacyId) !== canonicalPersonId) {
        throw new Error(`Duplicate legacy_id in data/people.jsonl maps to different canonical IDs: ${legacyId}`);
      }
      legacyToCanonical.set(legacyId, canonicalPersonId);
    }
  }

  if (canonicalPeople.size > 0 && canonicalPeople.size !== rows.length) {
    throw new Error(`Unexpected canonical/active people mismatch: ${rows.length} rows, ${canonicalPeople.size} canonical ids`);
  }

  return { legacyToCanonical, canonicalPeople };
}

function getByPath(row, parts) {
  return parts.reduce((node, key) => (node && typeof node === 'object' && key in node ? node[key] : undefined), row);
}

function setByPath(row, parts, value) {
  let node = row;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (node == null || typeof node !== 'object' || !(key in node)) {
      return;
    }
    node = node[key];
  }
  const last = parts.at(-1);
  if (node && typeof node === 'object' && last in node) {
    node[last] = value;
  }
}

function migrateValue(value, legacyToCanonical, unknownCollector) {
  if (typeof value !== 'string') return { changed: false, value };
  if (!LEGACY_PREFIX.test(value)) return { changed: false, value };

  const mapped = legacyToCanonical.get(value);
  if (!mapped) {
    unknownCollector.add(value);
    return { changed: false, value };
  }
  if (value === mapped) return { changed: false, value };
  return { changed: true, value: mapped };
}

function migrateRow(row, rules, legacyToCanonical, unknownCollector) {
  let changed = 0;

  for (const parts of rules) {
    if (parts.length === 1 && parts[0] === 'legacy_ids') {
      const sourceId = row.person_id;
      const seen = new Set();
      const legacyIds = [];
      for (const raw of Array.isArray(row.legacy_ids) ? row.legacy_ids : []) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        if (!seen.has(raw)) {
          legacyIds.push(raw);
          seen.add(raw);
        }
      }
      const normalizedSource = typeof sourceId === 'string' ? sourceId.trim() : '';
      if (LEGACY_PREFIX.test(normalizedSource) && !seen.has(normalizedSource)) {
        legacyIds.push(normalizedSource);
        changed += 1;
        seen.add(normalizedSource);
      }
      const previous = Array.isArray(row.legacy_ids) ? row.legacy_ids : [];
      if (legacyIds.length !== previous.length || !legacyIds.every((id, idx) => id === previous[idx])) {
        row.legacy_ids = legacyIds;
      }
      continue;
    }

    const v = getByPath(row, parts);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i += 1) {
        const res = migrateValue(v[i], legacyToCanonical, unknownCollector);
        if (res.changed) {
          v[i] = res.value;
          changed += 1;
        }
      }
      continue;
    }

    const res = migrateValue(v, legacyToCanonical, unknownCollector);
    if (res.changed) {
      setByPath(row, parts, res.value);
      changed += 1;
    }
  }

  return changed;
}

function collectLegacyReferences(row, rules, allowlist) {
  const remaining = [];
  for (const parts of rules) {
    if (parts.length === 1 && parts[0] === 'legacy_ids') {
      continue;
    }

    const v = getByPath(row, parts);
    const values = Array.isArray(v) ? v : [v];
    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }
      if (LEGACY_PREFIX.test(value) && !allowlist.has(value)) {
        remaining.push(value);
      }
    }
  }
  return remaining;
}

function validateLegacyUniqueness(peopleRows) {
  const seen = new Map();
  const duplicates = [];

  for (const row of peopleRows) {
    const ids = [row.person_id, ...(Array.isArray(row.legacy_ids) ? row.legacy_ids : [])].filter((id) => LEGACY_PREFIX.test(id));
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.set(id, row.person_id);
      } else {
        duplicates.push({ id, rows: [seen.get(id), row.person_id] });
      }
    }
  }

  if (duplicates.length > 0) {
    const lines = duplicates.map((d) => `${d.id} in ${d.rows[0]} and ${d.rows[1]}`).join('; ');
    throw new Error(`Duplicate legacy ids in people records: ${lines}`);
  }

  return seen.size;
}

function computeReviewSignature(reviewRow) {
  const snapshot = reviewRow.assertion_snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  return hashSha256(
    stableStringify({
      assertion_id: reviewRow.assertion_id,
      subject_person_id: snapshot.subject_person_id,
      object_person_id: snapshot.object_person_id,
      relation_type: snapshot.relation_type,
      relation_subtype: snapshot.relation_subtype ?? null,
      direction: snapshot.direction,
      evidence: snapshot.evidence,
      editorial_status: snapshot.editorial_status,
      status: snapshot.status,
      confidence: snapshot.confidence,
    }),
  );
}

function validatePeopleSet(canonicalPeople) {
  const peopleRows = readJsonl(path.join(ROOT, 'data', 'people.jsonl'));
  for (const row of peopleRows) {
    const personId = row.person_id;
    if (CANONICAL_PREFIX.test(personId)) {
      canonicalPeople.add(personId);
    }
  }
}

function checkAndMaybeRepairRelationshipSignatures(reviewRows, options) {
  const { repair } = options;
  const report = {
    total: reviewRows.length,
    mismatchedSignatures: 0,
    repairedSignatures: 0,
    repairedSignatureFields: 0,
    mismatchRows: [],
  };

  const canonicalPeople = new Set(
    readJsonl(path.join(ROOT, 'data', 'people.jsonl')).map((row) => row.person_id),
  );

  for (const row of reviewRows) {
    const expected = computeReviewSignature(row);
    if (!expected) {
      throw new Error(`relationship-review signature cannot be computed for ${row.review_id || row.assertion_id}`);
    }

    if (row.assertion_signature !== expected) {
      report.mismatchedSignatures += 1;
      report.mismatchRows.push(row.assertion_id);
      if (repair) {
        row.assertion_signature = expected;
        report.repairedSignatures += 1;
        report.repairedSignatureFields += 1;
      }
    }

    if (!row.assertion_snapshot || typeof row.assertion_snapshot !== 'object') {
      throw new Error(`Missing assertion_snapshot for ${row.review_id || row.assertion_id}`);
    }

    for (const field of ['subject_person_id', 'object_person_id']) {
      const value = row[field];
      const snapshotValue = row.assertion_snapshot[field];
      if (!CANONICAL_PREFIX.test(value)) {
        throw new Error(`Invalid person id ${value} in ${field} at ${row.assertion_id}`);
      }
      if (!canonicalPeople.has(value)) {
        throw new Error(`Missing canonical person ${value} in ${field} at ${row.assertion_id}`);
      }
      if (snapshotValue !== value) {
        throw new Error(`Snapshot person id mismatch at ${row.assertion_id} for ${field}`);
      }
    }
  }

  return report;
}

function runMigration(legacyToCanonical, apply, checkOnly) {
  const unknown = new Set();
  const filesReport = [];
  let totalChangedRows = 0;
  let totalChangedFields = 0;
  const remainingLegacy = new Set();

  for (const [file, rules] of MIGRATION_FILES) {
    const full = path.join(ROOT, file);
    const rows = readJsonl(full);
    let changedRows = 0;
    let changedFields = 0;

    for (const row of rows) {
      const beforeUnknownSize = unknown.size;
      const changed = migrateRow(row, rules, legacyToCanonical, unknown);
      if (changed > 0) {
        changedRows += 1;
        changedFields += changed;
      }

      collectLegacyReferences(row, rules, ALLOWLIST_UNMAPPED_LEGACY_IDS).forEach((id) => remainingLegacy.add(id));
      if (unknown.size > beforeUnknownSize) {
        // unknown IDs are tracked through the `unknown` set
      }
    }

    if (apply) {
      writeJsonl(full, rows);
    }

    filesReport.push({
      file,
      rows: rows.length,
      changedRows,
      changedFields,
    });

    totalChangedRows += changedRows;
    totalChangedFields += changedFields;
  }

  const peopleRows = readJsonl(path.join(ROOT, 'data/people.jsonl'));
  validateLegacyUniqueness(peopleRows);

  for (const file of LEGACY_FREE_JSON_FILES) {
    const full = path.join(ROOT, file);
    const raw = fs.readFileSync(full, 'utf8');
    const matches = raw.match(/nt-people-\d{4}/g) || [];
    if (matches.length > 0) {
      throw new Error(`Legacy IDs remain in active JSON file ${file}: ${[...new Set(matches)].join(', ')}`);
    }
  }

  const peopleCanonicalIds = peopleRows.map((row) => row.person_id);

  if (remainingLegacy.size > 0) {
    throw new Error(`Legacy IDs remain in migrated fields: ${[...remainingLegacy].join(', ')}`);
  }

  const unknownList = [...unknown];
  const unmapped = unknownList.filter((id) => !ALLOWLIST_UNMAPPED_LEGACY_IDS.has(id));
  if (unmapped.length > 0) {
    throw new Error(`Unmapped legacy IDs encountered: ${unmapped.join(', ')}`);
  }

  return {
    mode: apply ? 'apply' : checkOnly ? 'check' : 'dry-run',
    changedRows: totalChangedRows,
    changedFields: totalChangedFields,
    perFile: filesReport,
    peopleCount: peopleRows.length,
    allowlistHits: unknownList.filter((id) => ALLOWLIST_UNMAPPED_LEGACY_IDS.has(id)).sort(),
    canonicalPeople: peopleCanonicalIds.length,
  };
}

function buildLegacyIdMapRows(legacyToCanonical) {
  const mapRows = [...legacyToCanonical.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([legacyId, newId]) => ({ legacy_id: legacyId, new_id: newId }));

  const manifestCreatedAt = loadManifestCreatedAt();
  const mapHash = hashSha256(stableStringify(mapRows));
  return {
    generated_at: manifestCreatedAt,
    checksum: mapHash,
    map: mapRows,
  };
}

function runCheck(legacyToCanonical) {
  const mapPath = path.join(ROOT, 'exports', 'legacy-person-id-map.json');
  if (!fs.existsSync(mapPath)) {
    throw new Error('map file not found');
  }

  const manifestCreatedAt = loadManifestCreatedAt();
  const current = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  if (current.generated_at !== manifestCreatedAt) {
    throw new Error(`legacy-person-id-map generated_at mismatch: expected ${manifestCreatedAt}`);
  }

  const expected = buildLegacyIdMapRows(legacyToCanonical);
  const currentRows = Array.isArray(current.map) ? current.map : [];

  if (currentRows.length !== expected.map.length) {
    throw new Error(`Map size mismatch: expected ${expected.map.length}, found ${currentRows.length}`);
  }

  for (const row of currentRows) {
    const expectedNew = expected.map.find((r) => r.legacy_id === row.legacy_id);
    if (!expectedNew || expectedNew.new_id !== row.new_id) {
      throw new Error(`Map mismatch for ${row.legacy_id}: expected ${expectedNew ? expectedNew.new_id : '<missing>'}, found ${row.new_id}`);
    }
  }

  if (current.generated_at !== expected.generated_at) {
    throw new Error(`Map generated_at mismatch: expected ${expected.generated_at}, found ${current.generated_at}`);
  }
  if (current.checksum !== expected.checksum) {
    throw new Error(`Map checksum mismatch: expected ${expected.checksum}, found ${current.checksum}`);
  }

  return {
    status: 'pass',
    mode: 'check',
    mapPath,
    mapRows: currentRows.length,
    generatedAt: expected.generated_at,
    checksum: expected.checksum,
  };
}

function loadMapFromExports() {
  const mapPath = path.join(ROOT, 'exports', 'legacy-person-id-map.json');
  if (!fs.existsSync(mapPath)) return null;
  const current = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const currentRows = Array.isArray(current.map) ? current.map : [];
  const rowsMap = new Map();
  for (const row of currentRows) {
    if (row && typeof row.legacy_id === 'string' && typeof row.new_id === 'string') {
      rowsMap.set(row.legacy_id, row.new_id);
    }
  }
  return rowsMap.size > 0 ? rowsMap : null;
}

function writeLegacyMap(legacyToCanonical) {
  const mapPath = path.join(ROOT, 'exports', 'legacy-person-id-map.json');
  const next = buildLegacyIdMapRows(legacyToCanonical);
  fs.writeFileSync(mapPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function main() {
  let legacyToCanonical = null;
  try {
    const peopleInfo = buildPeopleMap(path.join(ROOT, 'data/people.jsonl'));
    if (peopleInfo.legacyToCanonical.size > 0) {
      legacyToCanonical = peopleInfo.legacyToCanonical;
    }
  } catch (error) {
    throw error;
  }

  if (!legacyToCanonical || legacyToCanonical.size === 0) {
    const fallback = loadMapFromExports();
    if (!fallback) {
      throw new Error('No legacy ids detected in data/people.jsonl and no exports/legacy-person-id-map.json fallback available.');
    }
    legacyToCanonical = fallback;
  }

  const migrationReport = runMigration(legacyToCanonical, false, !CHECK && !REPAIR);
  const relationshipRows = readJsonl(path.join(ROOT, 'editorial/relationship-review.jsonl'));
  const signatureReport = checkAndMaybeRepairRelationshipSignatures(relationshipRows, {
    repair: APPLY || REPAIR_SIGNatures || REPAIR_MAP,
  });

  if (REPAIR_SIGNatures || REPAIR_MAP) {
    if (signatureReport.repairedSignatures > 0) {
      writeJsonl(path.join(ROOT, 'editorial/relationship-review.jsonl'), relationshipRows);
    }
    if (REPAIR_MAP) {
      writeLegacyMap(legacyToCanonical);
    }
  }

  if (CHECK || REPAIR) {
    const checkReport = runCheck(legacyToCanonical);
    const combined = {
      migration: migrationReport,
      signatures: {
        total: signatureReport.total,
        mismatchedSignatures: signatureReport.mismatchedSignatures,
        repairedSignatures: signatureReport.repairedSignatures,
      },
      map: checkReport,
    };
    console.log(JSON.stringify(combined, null, 2));

    if (signatureReport.mismatchedSignatures > 0 && !(REPAIR_SIGNatures || REPAIR_MAP)) {
      throw new Error('relationship-review signature drift detected. re-run with --repair-metadata');
    }

    return;
  }

  const report = APPLY ? runMigration(legacyToCanonical, true, false) : migrationReport;
  console.log(JSON.stringify({ ...report, relationshipSignatures: signatureReport }, null, 2));

  if (!APPLY) {
    console.log('DRY-RUN complete. Re-run with --apply to write files. Re-run with --check for canonical verification.');
  } else {
    console.log('Migration written, including exports/legacy-person-id-map.json');
  }
}

main();
