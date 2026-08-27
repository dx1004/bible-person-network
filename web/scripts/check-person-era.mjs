#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyPersonEra, PERSON_ERAS } from './person-era.mjs';

const rootDir = path.resolve(process.cwd(), '..');
const people = JSON.parse(await fs.readFile(path.join(rootDir, 'exports', 'people.json'), 'utf8'));
const mentions = JSON.parse(await fs.readFile(path.join(rootDir, 'exports', 'mentions.json'), 'utf8'));

const booksByPerson = new Map();
for (const mention of mentions.filter((item) => item.status === 'accepted')) {
  const match = String(mention.passage || '').match(/^([1-3]?[A-Z]{2,4})\b/);
  if (!match) continue;
  const books = booksByPerson.get(mention.person_id) || new Set();
  books.add(match[1]);
  booksByPerson.set(mention.person_id, books);
}

const erasByPerson = new Map();
const counts = Object.fromEntries(PERSON_ERAS.map((era) => [era, 0]));
for (const person of people) {
  const era = classifyPersonEra(person, [...(booksByPerson.get(person.person_id) || [])]);
  if (!PERSON_ERAS.includes(era)) throw new Error(`${person.person_id} has invalid era: ${era}`);
  erasByPerson.set(person.person_id, era);
  counts[era] += 1;
}

for (const [personId, expected] of [
  ['nt-people-0242', '旧约背景'],
  ['nt-people-0156', '耶稣时期'],
  ['nt-people-0266', '使徒时期'],
  ['nt-people-0374', '使徒时期']
]) {
  const actual = erasByPerson.get(personId);
  if (actual !== expected) throw new Error(`${personId} era mismatch: ${actual} != ${expected}`);
}

if (!counts['旧约背景'] || !counts['耶稣时期'] || !counts['使徒时期']) {
  throw new Error(`required era bucket is empty: ${JSON.stringify(counts)}`);
}

console.log(`[person-era-check] ${JSON.stringify(counts)}`);
