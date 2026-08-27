#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSERTIONS_PATH = path.join(ROOT, 'data', 'assertions.jsonl');
const SOURCES_PATH = path.join(ROOT, 'data', 'sources.jsonl');
const SOURCES_PATH2 = path.join(ROOT, 'data', 'manifest.json');
const INVENTORY_PATH = path.join(ROOT, 'editorial', 'relationship-coverage-inventory.json');
const OUTPUT_PATH = path.join(ROOT, 'exports', 'relationship-coverage-report.json');
const NO_WRITE = process.argv.includes('--no-write') || process.argv.includes('--stdout');

function readJsonl(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  if (!options.parse) return lines;
  return lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL ${path.basename(filePath)}:${idx + 1}`);
    }
  });
}

function normalizeSourceSet() {
  const sources = readJsonl(SOURCES_PATH, { parse: true });
  const set = new Set(sources.map((row) => row.source_id));
  return set;
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(SOURCES_PATH2, 'utf8'));
  return {
    created_at: String(manifest.created_at || ''),
    version: String(manifest.version || '')
  };
}

function readInventory() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error('coverage inventory file missing');
  }
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  if (!inventory?.targets || !Array.isArray(inventory.targets)) {
    throw new Error('coverage inventory invalid: targets is required');
  }
  return inventory;
}

function readAssertions() {
  const rows = readJsonl(ASSERTIONS_PATH, { parse: true });
  return rows;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function makeKey(target) {
  return `${target.subject_person_id}|${target.object_person_id}|${target.relation_type}|${target.relation_subtype ?? ''}|${target.direction}`;
}

function compareEvidenceLevel(level) {
  return level === 'nt_text' || level === 'ancient_text' || level === 'reference' || level === 'modern_reference' || level === 'editorial';
}

const assertions = readAssertions();
const sourceSet = normalizeSourceSet();
const inventory = readInventory();
const manifest = readManifest();

const assertionKeys = new Set(
  assertions.map((row) => makeKey({
    subject_person_id: row.subject_person_id,
    object_person_id: row.object_person_id,
    relation_type: row.relation_type,
    relation_subtype: row.relation_subtype ?? null,
    direction: row.direction
  }))
);

const byType = {};
const seenTargets = new Set();

for (const target of inventory.targets) {
  const targetKey = makeKey(target);
  if (seenTargets.has(targetKey)) {
    throw new Error(`duplicate inventory target key: ${target.target_id} (${targetKey})`);
  }
  seenTargets.add(targetKey);

  if (!byType[target.relation_type]) byType[target.relation_type] = { required: 0, covered: 0 };
  byType[target.relation_type].required += 1;

  if (!target.subject_person_id || !target.object_person_id) {
    throw new Error(`invalid inventory target: ${target.target_id}`);
  }
  const sourceId = target.evidence?.source_id;
  if (!sourceSet.has(sourceId)) {
    throw new Error(`inventory target ${target.target_id} uses unknown source_id: ${sourceId}`);
  }
  if (!compareEvidenceLevel(target.evidence?.evidence_level)) {
    throw new Error(`inventory target ${target.target_id} has unsupported evidence_level`);
  }
}

const coveredTargets = [];
const missingTargets = [];
for (const target of inventory.targets) {
  const key = makeKey(target);
  if (assertionKeys.has(key)) {
    coveredTargets.push({
      target_id: target.target_id,
      relation_type: target.relation_type,
      key
    });
  } else {
    missingTargets.push({
      target_id: target.target_id,
      relation_type: target.relation_type,
      key,
      rationale: target.rationale
    });
  }
}

for (const row of coveredTargets) {
  byType[row.relation_type].covered += 1;
}

const report = {
  inventory_id: inventory.inventory_id,
  generated_at: new Date().toISOString(),
  manifest_created_at: manifest.created_at,
  manifest_version: manifest.version,
  totals: {
    targets: inventory.targets.length,
    covered: coveredTargets.length,
    missing: missingTargets.length
  },
  by_relation_type: byType,
  covered_targets: coveredTargets.sort((a, b) => String(a.target_id).localeCompare(String(b.target_id))),
  missing_targets: missingTargets.sort((a, b) => String(a.target_id).localeCompare(String(b.target_id))),
  deliberately_bounded_gaps: inventory.deliberately_bounded_gaps || []
};

if (!NO_WRITE) {
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

const stableSummary = stableStringify(report);
if (missingTargets.length > 0) {
  console.log(`coverage: ${coveredTargets.length}/${inventory.targets.length} targets covered`);
  console.log(`missing: ${missingTargets.length}`);
} else {
  console.log('coverage: complete against v1 inventory');
}
if (!NO_WRITE) {
  console.log(`report: ${OUTPUT_PATH}`);
} else {
  console.log('report: stdout');
}
console.log(stableSummary.length > 1200 ? stableSummary.slice(0, 1200) : stableSummary);
