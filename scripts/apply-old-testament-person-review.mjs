#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const EDITORIAL = path.join(ROOT, 'editorial');
const EXPORTS = path.join(ROOT, 'exports');
const APPLY = process.argv.includes('--apply');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const STAMP = MANIFEST.created_at;

// Verse-specific CUV forms accepted during the source audit. These remain
// aliases: the canonical Chinese label still follows the final person review.
const CURATED_CHINESE_ALIASES = new Map([
  ['otc-1820', ['米该亚']]
]);

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${file}:${index + 1}: invalid JSON`); }
  }) : [];
}

function numericId(value) {
  return Number(String(value || '').match(/(\d+)$/)?.[1] || 0);
}

function appendUnique(values, value) {
  return values.includes(value) ? values : [...values, value];
}

function writeJsonlAtomic(file, rows) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  fs.renameSync(temp, file);
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

const people = readJsonl(path.join(DATA, 'people.jsonl'));
const names = readJsonl(path.join(DATA, 'names.jsonl'));
const mentions = readJsonl(path.join(DATA, 'mentions.jsonl'));
const candidates = readJsonl(path.join(EDITORIAL, 'old-testament-person-candidates.jsonl'));
const reviews = readJsonl(path.join(EDITORIAL, 'old-testament-person-review.jsonl'));

const candidateById = new Map(candidates.map((row) => [row.candidate_id, row]));
const personById = new Map(people.map((row) => [row.person_id, row]));
const personByIdentityGroup = new Map(people.map((row) => [row.identity_group, row]).filter(([key]) => key));
const accepted = reviews.filter((row) => row.final_decision?.status === 'accepted');
const rejected = reviews.filter((row) => row.final_decision?.status === 'rejected');

let nextPerson = Math.max(...people.map((row) => numericId(row.person_id)), 0) + 1;
let nextName = Math.max(...names.map((row) => numericId(row.name_id)), 0) + 1;
let nextMention = Math.max(...mentions.map((row) => numericId(row.mention_id)), 0) + 1;

const candidateToPerson = new Map();
let createdPeople = 0;
let updatedPeople = 0;

for (const review of accepted) {
  const decision = review.final_decision;
  const candidate = candidateById.get(review.candidate_id);
  if (!candidate) throw new Error(`missing candidate ${review.candidate_id}`);
  let person;
  if (decision.decision_action === 'merge_existing') {
    person = personById.get(decision.target_person_id);
    if (!person) throw new Error(`${review.review_id}: missing merge target ${decision.target_person_id}`);
  } else if (decision.decision_action === 'create_new') {
    const identityGroup = `ot-idgrp-${candidate.candidate_id}`;
    person = personByIdentityGroup.get(identityGroup);
    if (!person) {
      const personId = `person-${String(nextPerson++).padStart(6, '0')}`;
      person = {
        person_id: personId,
        canonical_chinese: decision.canonical_chinese,
        canonical_greek: null,
        canonical_hebrew: candidate.names.some((name) => name.language === 'hbo') ? candidate.canonical_name : null,
        canonical_aramaic: candidate.names.some((name) => name.language === 'arc') ? candidate.canonical_name : null,
        latinized: candidate.latinized,
        sex: candidate.sex || 'unknown',
        status: 'accepted',
        identity_group: identityGroup,
        legacy_ids: [],
        testaments: ['ot'],
        editor_note: `Accepted OT review ${review.review_id}; STEP identity ${candidate.step_identity_key}.`,
        review_status: {
          chinese_label_status: 'accepted',
          chinese_label_note: 'Accepted by two-round Old Testament person review and final adjudication.'
        },
        source_decisions: ['source:0002', 'source:0003', 'source:0005'],
        nt_ref_count: candidate.nt_ref_count || 0,
        ot_ref_count: candidate.ot_ref_count || candidate.ot_refs.length,
        bible_ref_count: (candidate.nt_ref_count || 0) + (candidate.ot_ref_count || candidate.ot_refs.length),
        source_snapshot: candidate.source_snapshot || STAMP,
        created_at: STAMP,
        updated_at: STAMP
      };
      people.push(person);
      personById.set(person.person_id, person);
      personByIdentityGroup.set(identityGroup, person);
      createdPeople += 1;
    }
  } else {
    throw new Error(`${review.review_id}: unsupported accepted action ${decision.decision_action}`);
  }

  const before = JSON.stringify(person);
  person.canonical_chinese ||= decision.canonical_chinese;
  if (!person.canonical_hebrew && candidate.names.some((name) => name.language === 'hbo')) person.canonical_hebrew = candidate.canonical_name;
  if (!person.canonical_aramaic && candidate.names.some((name) => name.language === 'arc')) person.canonical_aramaic = candidate.canonical_name;
  person.ot_ref_count = candidate.ot_ref_count || candidate.ot_refs.length;
  if (decision.decision_action === 'create_new') person.nt_ref_count = 0;
  person.bible_ref_count = (person.nt_ref_count || 0) + person.ot_ref_count;
  person.testaments = decision.decision_action === 'create_new'
    ? ['ot']
    : [...new Set([...(person.testaments || ((person.nt_ref_count || 0) > 0 ? ['nt'] : [])), 'ot'])];
  person.source_decisions = appendUnique(appendUnique(person.source_decisions || [], 'source:0002'), 'source:0005');
  if (JSON.stringify(person) !== before && decision.decision_action === 'merge_existing') updatedPeople += 1;
  candidateToPerson.set(candidate.candidate_id, person.person_id);
}

const nameKeys = new Set(names.map((row) => `${row.person_id}\u0000${row.language}\u0000${row.name_text}`));
let createdNames = 0;
function addName(personId, nameText, language, sourceScope, notes) {
  if (!nameText) return;
  const key = `${personId}\u0000${language}\u0000${nameText}`;
  if (nameKeys.has(key)) return;
  names.push({
    name_id: `name-${String(nextName++).padStart(4, '0')}`,
    person_id: personId,
    name_text: nameText,
    language,
    source_scope: sourceScope,
    status: 'accepted',
    notes,
    created_at: STAMP,
    updated_at: STAMP
  });
  nameKeys.add(key);
  createdNames += 1;
}

const mentionKeys = new Set(mentions.map((row) => `${row.person_id}\u0000${row.source_id}\u0000${row.passage}`));
let createdMentions = 0;

for (const review of accepted) {
  const candidate = candidateById.get(review.candidate_id);
  const personId = candidateToPerson.get(candidate.candidate_id);
  addName(personId, review.final_decision.canonical_chinese, 'zh-hans', 'canonical', `Accepted OT review ${review.review_id}.`);
  for (const alias of CURATED_CHINESE_ALIASES.get(candidate.candidate_id) || []) {
    addName(personId, alias, 'zh-hans', 'alias', `CUV textual form accepted during source audit for ${candidate.candidate_id}.`);
  }
  addName(personId, candidate.latinized, 'en', 'variant', `STEP identity ${candidate.step_identity_key}.`);
  for (const name of candidate.names || []) {
    addName(personId, name.name_text, name.language, name.source_scope || 'variant', `STEP OT candidate ${candidate.candidate_id}.`);
  }
  for (const passage of candidate.ot_refs || []) {
    const key = `${personId}\u0000source:0002\u0000${passage}`;
    if (mentionKeys.has(key)) continue;
    mentions.push({
      mention_id: `mnt-${String(nextMention++).padStart(6, '0')}`,
      person_id: personId,
      source_id: 'source:0002',
      passage,
      location: 'STEP Proper Names OT',
      status: 'accepted',
      testament: 'ot',
      notes: '',
      editorial_rationale: `Accepted OT person review ${review.review_id}.`,
      created_at: STAMP,
      updated_at: STAMP
    });
    mentionKeys.add(key);
    createdMentions += 1;
  }
}

people.sort((a, b) => numericId(a.person_id) - numericId(b.person_id));
names.sort((a, b) => numericId(a.name_id) - numericId(b.name_id));
mentions.sort((a, b) => numericId(a.mention_id) - numericId(b.mention_id));

const mapRows = [...candidateToPerson.entries()].map(([candidate_id, person_id]) => ({ candidate_id, person_id }));
const report = {
  mode: APPLY ? 'apply' : 'dry-run',
  accepted_reviews: accepted.length,
  rejected_reviews: rejected.length,
  created_people: createdPeople,
  updated_existing_people: updatedPeople,
  created_names: createdNames,
  created_mentions: createdMentions,
  totals: { people: people.length, names: names.length, mentions: mentions.length },
  candidate_person_map_rows: mapRows.length
};

if (APPLY) {
  writeJsonlAtomic(path.join(DATA, 'people.jsonl'), people);
  writeJsonlAtomic(path.join(DATA, 'names.jsonl'), names);
  writeJsonlAtomic(path.join(DATA, 'mentions.jsonl'), mentions);
  fs.mkdirSync(EXPORTS, { recursive: true });
  writeJsonAtomic(path.join(EXPORTS, 'old-testament-candidate-person-map.json'), {
    generated_at: STAMP,
    source_id: 'source:0002',
    rows: mapRows
  });
  writeJsonAtomic(path.join(EXPORTS, 'old-testament-person-migration-report.json'), report);
}

console.log(JSON.stringify(report, null, 2));
