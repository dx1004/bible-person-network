#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const SCHEMA_DIR = path.join(ROOT, 'schemas');
const OUT_DIR = path.join(ROOT, 'exports');
const NEO4J_DIR = path.join(ROOT, 'neo4j', 'import');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

const DATASET_TIMESTAMP = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).created_at;
if (!DATASET_TIMESTAMP || Number.isNaN(Date.parse(DATASET_TIMESTAMP))) {
  throw new Error('data/manifest.json must provide a valid created_at timestamp');
}

const collections = [
  { name: 'people', idKey: 'person_id', requiredInRelations: ['person_id', 'subject_person_id', 'object_person_id'] },
  { name: 'names', idKey: 'name_id' },
  { name: 'mentions', idKey: 'mention_id' },
  { name: 'assertions', idKey: 'assertion_id' },
  { name: 'sources', idKey: 'source_id' },
  { name: 'identity-options', idKey: 'option_id' }
];

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`JSONL parse failed: ${filePath}:line:${idx + 1}`);
    }
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function formatDate(d) {
  return new Date(d).toISOString();
}

function buildValidator(schema) {
  const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: false, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return (item) => {
    if (validate(item)) return [];
    return (validate.errors || []).map((err) => {
      const at = (err.instancePath || err.dataPath || '').replace(/^\./, '');
      const loc = at ? `${at}` : 'root';
      return `${loc}: ${err.message}`;
    });
  };
}

function writeCsv(file, rows, headers) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replaceAll('"', '""');
    return `"${s}"`;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h])).join(','));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
}

function csvValue(v) {
  if (v === null || v === undefined) return '';
  return `"${String(v).replaceAll('"', '""')}"`;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function main() {
  const runStarted = new Date().toISOString();
  const errors = [];
  const collectionsData = {};
  const ids = {};
  for (const col of collections) {
    const file = path.join(DATA_DIR, `${col.name}.jsonl`);
    const schemaFile = path.join(SCHEMA_DIR, `${col.name === 'identity-options' ? 'identity-options' : col.name}.schema.json`);
    if (!fs.existsSync(file)) throw new Error(`Missing data file: ${file}`);
    if (!fs.existsSync(schemaFile)) throw new Error(`Missing schema: ${schemaFile}`);
    const rows = readJsonl(file);
    const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
    const validate = buildValidator(schema);
    rows.forEach((r, i) => {
      for (const msg of validate(r)) {
        errors.push(`${path.basename(file)}#${i + 1}: ${msg}`);
      }
    });

    const idSet = new Set();
    for (const r of rows) {
      if (!(col.idKey in r)) continue;
      const id = r[col.idKey];
      if (idSet.has(id)) {
        errors.push(`${col.name}.jsonl: duplicate id ${id}`);
      }
      idSet.add(id);
    }
    ids[col.name] = idSet;
    collectionsData[col.name] = rows;
  }

  const { people, names, mentions, assertions, sources, identityOptions } = {
    people: collectionsData.people,
    names: collectionsData.names,
    mentions: collectionsData.mentions,
    assertions: collectionsData.assertions,
    sources: collectionsData.sources,
    identityOptions: collectionsData['identity-options']
  };

  const peopleSet = ids.people;
  for (const n of names) {
    assert(peopleSet.has(n.person_id), `names.jsonl: person_id not found ${n.person_id}`);
  }
  for (const m of mentions) {
    assert(peopleSet.has(m.person_id), `mentions.jsonl: person_id not found ${m.person_id}`);
    const sourceSet = ids.sources;
    assert(sourceSet.has(m.source_id), `mentions.jsonl: source_id not found ${m.source_id}`);
  }
  for (const a of assertions) {
    assert(peopleSet.has(a.subject_person_id), `assertions.jsonl: subject_person_id not found ${a.subject_person_id}`);
    assert(peopleSet.has(a.object_person_id), `assertions.jsonl: object_person_id not found ${a.object_person_id}`);
    assert(a.subject_person_id !== a.object_person_id, `assertions.jsonl: self-loop ${a.assertion_id}`);
    for (const e of a.evidence) {
      assert(ids.sources.has(e.source_id), `assertions.jsonl: evidence source_id not found ${e.source_id}`);
      assert(typeof e.passage === 'string' && e.passage.length > 0, `assertions.jsonl: invalid passage in ${a.assertion_id}`);
    }
  }
  for (const opt of identityOptions) {
    assert(peopleSet.has(opt.person_id), `identity-options.jsonl: person_id not found ${opt.person_id}`);
  }

  const counts = {
    people: people.length,
    names: names.length,
    mentions: mentions.length,
    assertions: assertions.length,
    sources: sources.length,
    identityOptions: identityOptions.length
  };

  if (errors.length > 0) {
    throw new Error(`Validation failed (${errors.length}):\n${errors.join('\n')}`);
  }

  ensureDir(OUT_DIR);
  fs.writeFileSync(path.join(OUT_DIR, 'people.json'), JSON.stringify(people, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'names.json'), JSON.stringify(names, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'mentions.json'), JSON.stringify(mentions, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'assertions.json'), JSON.stringify(assertions, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'sources.json'), JSON.stringify(sources, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'identity-options.json'), JSON.stringify(identityOptions, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'run.json'), JSON.stringify({ runStarted, counts }, null, 2));

  writeCsv(path.join(OUT_DIR, 'people.csv'), people, ['person_id', 'canonical_chinese', 'canonical_greek', 'latinized', 'sex', 'status', 'identity_group']);
  writeCsv(path.join(OUT_DIR, 'names.csv'), names, ['name_id', 'person_id', 'name_text', 'language', 'source_scope', 'status']);
  writeCsv(path.join(OUT_DIR, 'assertions.csv'), assertions.map((r) => ({
    assertion_id: r.assertion_id,
    subject_person_id: r.subject_person_id,
    object_person_id: r.object_person_id,
    relation_type: r.relation_type,
    direction: r.direction,
    status: r.status,
    confidence: r.confidence,
    editorial_status: r.editorial_status,
    relation_subtype: r.relation_subtype || '',
    first_evidence: r.evidence[0]?.passage || ''
  })), ['assertion_id', 'subject_person_id', 'object_person_id', 'relation_type', 'relation_subtype', 'direction', 'status', 'confidence', 'editorial_status', 'first_evidence']);

  const evidenceRows = [];
  const allPassages = new Set();
  for (const m of mentions) {
    if (m.passage) allPassages.add(m.passage);
  }
  for (const a of assertions) {
    for (const e of a.evidence || []) {
      if (!e || !e.passage) continue;
      allPassages.add(e.passage);
      evidenceRows.push({
        assertion_id: a.assertion_id,
        passage: e.passage,
        source_id: e.source_id,
        evidence_level: e.evidence_level,
        certainty: e.certainty ?? '',
        note: e.note || ''
      });
    }
  }

  ensureDir(NEO4J_DIR);
  const legacyRelationEdges = path.join(NEO4J_DIR, 'relation_edges.csv');
  if (fs.existsSync(legacyRelationEdges)) {
    fs.unlinkSync(legacyRelationEdges);
  }
  fs.writeFileSync(path.join(NEO4J_DIR, 'person_nodes.csv'), [
    'person_id,canonical_chinese,canonical_greek,latinized,sex,status,identity_group',
    ...people.map((p) => [p.person_id, p.canonical_chinese, p.canonical_greek || '', p.latinized || '', p.sex || '', p.status, p.identity_group || ''].map(csvValue).join(','))
  ].join('\n'));
  fs.writeFileSync(path.join(NEO4J_DIR, 'name_nodes.csv'), [
    'name_id,person_id,name_text,language,source_scope,status',
    ...names.map((n) => [n.name_id, n.person_id, n.name_text, n.language, n.source_scope, n.status].map(csvValue).join(','))
  ].join('\n'));
  fs.writeFileSync(path.join(NEO4J_DIR, 'assertion_nodes.csv'), [
    'assertion_id,subject_person_id,object_person_id,relation_type,relation_subtype,direction,status,confidence,editorial_status',
    ...assertions.map((a) => [a.assertion_id, a.subject_person_id, a.object_person_id, a.relation_type, a.relation_subtype || '', a.direction, a.status, a.confidence, a.editorial_status].map(csvValue).join(','))
  ].join('\n'));
  fs.writeFileSync(path.join(NEO4J_DIR, 'identity_option_nodes.csv'), [
    'option_id,person_id,identity_key,status,identity_scope,rationale,editor_note',
    ...identityOptions.map((o) => [o.option_id, o.person_id, o.identity_key, o.status, o.identity_scope, o.rationale || '', o.editor_note || ''].map(csvValue).join(','))
  ].join('\n'));
  fs.writeFileSync(path.join(NEO4J_DIR, 'passage_nodes.csv'), [
    'passage',
    ...Array.from(allPassages).sort().map((passage) => [passage].map(csvValue).join(','))
  ].join('\n'));
  fs.rmSync(path.join(NEO4J_DIR, 'mention_nodes.csv'), { force: true });
  const mentionEdges = mentions.map((m) => ({
    mention_id: m.mention_id,
    person_id: m.person_id,
    passage: m.passage,
    source_id: m.source_id,
    status: m.status
  }));
  fs.writeFileSync(path.join(NEO4J_DIR, 'mention_edges.csv'), [
    'mention_id,person_id,passage,source_id,status',
    ...mentionEdges.map((m) => [m.mention_id, m.person_id, m.passage, m.source_id, m.status].map(csvValue).join(','))
  ].join('\n'));
  fs.writeFileSync(path.join(NEO4J_DIR, 'assertion_evidence.csv'), [
    'assertion_id,passage,source_id,evidence_level,certainty,note',
    ...evidenceRows.map((row) => [row.assertion_id, row.passage, row.source_id, row.evidence_level, row.certainty, row.note].map(csvValue).join(','))
  ].join('\n'));
  fs.writeFileSync(path.join(NEO4J_DIR, 'evidence_nodes.csv'), [
    'source_id,short_name,license,edition,language,scope',
    ...sources.map((s) => [s.source_id, s.short_name, s.license, s.edition, s.language, s.scope].map(csvValue).join(','))
  ].join('\n'));

  const cypher = [
    'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.person_id IS UNIQUE;',
    'CREATE CONSTRAINT name_id IF NOT EXISTS FOR (n:NameVariant) REQUIRE n.name_id IS UNIQUE;',
    'CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.source_id IS UNIQUE;',
    'CREATE CONSTRAINT assertion_id IF NOT EXISTS FOR (a:Assertion) REQUIRE a.assertion_id IS UNIQUE;',
    'CREATE CONSTRAINT passage_id IF NOT EXISTS FOR (p:Passage) REQUIRE p.passage IS UNIQUE;',
    'CREATE CONSTRAINT identity_option_id IF NOT EXISTS FOR (i:IdentityOption) REQUIRE i.option_id IS UNIQUE;',
    'LOAD CSV WITH HEADERS FROM "file:///person_nodes.csv" AS row MERGE (p:Person {person_id: row.person_id}) SET p += row;',
    'LOAD CSV WITH HEADERS FROM "file:///name_nodes.csv" AS row MATCH (p:Person {person_id: row.person_id}) MERGE (n:NameVariant {name_id: row.name_id}) SET n += row MERGE (p)-[:HAS_NAME]->(n);',
    'LOAD CSV WITH HEADERS FROM "file:///evidence_nodes.csv" AS row MERGE (s:Source {source_id: row.source_id}) SET s += row;',
    'LOAD CSV WITH HEADERS FROM "file:///assertion_nodes.csv" AS row MERGE (a:Assertion {assertion_id: row.assertion_id}) SET a += row;',
    'LOAD CSV WITH HEADERS FROM "file:///identity_option_nodes.csv" AS row MATCH (p:Person {person_id: row.person_id}) MERGE (i:IdentityOption {option_id: row.option_id}) SET i.identity_key = row.identity_key, i.status = row.status, i.identity_scope = row.identity_scope, i.rationale = row.rationale, i.editor_note = row.editor_note MERGE (p)-[:HAS_IDENTITY_OPTION]->(i);',
    'LOAD CSV WITH HEADERS FROM "file:///passage_nodes.csv" AS row MERGE (p:Passage {passage: row.passage}) SET p.passage = row.passage;',
    'LOAD CSV WITH HEADERS FROM "file:///mention_edges.csv" AS row MATCH (person:Person {person_id: row.person_id}), (psg:Passage {passage: row.passage}) MERGE (person)-[r:MENTIONED_IN]->(psg) SET r.mention_id = row.mention_id, r.source_id = row.source_id, r.status = row.status;',
    'LOAD CSV WITH HEADERS FROM "file:///assertion_nodes.csv" AS row MATCH (s:Person {person_id: row.subject_person_id}), (o:Person {person_id: row.object_person_id}), (a:Assertion {assertion_id: row.assertion_id}) MERGE (a)-[:SUBJECT]->(s) MERGE (a)-[:OBJECT]->(o);',
    'LOAD CSV WITH HEADERS FROM "file:///assertion_evidence.csv" AS row MATCH (a:Assertion {assertion_id: row.assertion_id}), (src:Source {source_id: row.source_id}), (psg:Passage {passage: row.passage}) MERGE (a)-[r1:SUPPORTED_BY]->(src) SET r1.evidence_level = row.evidence_level, r1.certainty = CASE row.certainty WHEN \"\" THEN null ELSE toFloat(row.certainty) END, r1.note = row.note MERGE (a)-[r2:SUPPORTED_BY]->(psg) SET r2.evidence_level = row.evidence_level, r2.certainty = CASE row.certainty WHEN \"\" THEN null ELSE toFloat(row.certainty) END, r2.note = row.note;'
  ].join('\n');
  fs.writeFileSync(path.join(NEO4J_DIR, 'import.cypher'), cypher + '\n');

  const payload = {
    generatedAt: formatDate(DATASET_TIMESTAMP),
    version: {
      major: 0,
      minor: 1,
      patch: 0
    },
    counts,
    assertionsActive: assertions.filter((a) => a.status === 'active').length
  };
  payload.checksum = sha256(stableStringify(payload));
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(payload, null, 2));
  console.log('OK validate-and-build');
}

main();
