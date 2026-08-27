#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function makeFixture(root) {
  const stepFile = `$========== PERSON\n`
    + `Alpha@ESV\t\t\t\t\t\t\t\tMale\n`
    + `\u2013 named\tAlpha\t\t\t\tMat.1.1\n`
    + `@Article= Ancient note text\t\t\t\t\t\t\t\t\t\n`
    + `\u2013 named\tSkipperAlias\t\t\t\tMat.2.1\n`
    + `Beta@ESV\t\t\t\t\t\t\t\tMale\n`
    + `\u2013 named\tBeta\t\t\t\tMat.3.1\n`
    + `GroupFounder@ESV\t\t\t\t\t\t\t\tMale\n`
    + `\u2013 named\tGroupFounder\t\t\t\tGen.1.1\n`
    + `\u2013 Group\tPeople|GroupFounder\t\t\t\tMat.4.1\n`
    + `\u2013 Greek\tPeople|GroupFounder\t\t\t\tMat.4.2\n`
    + `\u2013 (same form as previous)\tPeople|GroupFounder\t\t\t\tMat.4.3\n`
    + `Inferred@ESV\t\t\t\t\t\t\t\tMale\n`
    + `\u2013 Mentioned\tInferred\t\t\t\tMat.5.1\n`;
  const properNounsDir = path.join(root, 'Proper Nouns');
  fs.mkdirSync(properNounsDir, { recursive: true });
  fs.writeFileSync(
    path.join(properNounsDir, 'TIPNR - Translators Individualised Proper Names with all References - STEPBible.org CC BY.txt'),
    stepFile,
    'utf8'
  );
  fs.mkdirSync(path.join(root, 'sbl'), { recursive: true });
}

function makeRelationFixture(root) {
  const row = (name, cols) => {
    const defaults = [name, '', '', '', '', '', '', '', 'Male'];
    const expanded = [...defaults];
    for (let i = 0; i < cols.length; i += 1) expanded[i] = cols[i];
    return expanded.join('\t');
  };
  const stepRows = [
    `$========== PERSON`,
    row('James@ESV', [ 'James@ESV', '', '', 'Zebedee', '', 'Peter', '', '', 'Male' ]),
    `\u2013 named\tJames\t\t\t\tMat.1.1`,
    row('Peter@ESV', [ 'Peter@ESV', '', 'James', '', '', '', '', '', 'Male' ]),
    `\u2013 named\tPeter\t\t\t\tMat.2.1`,
    row('Zebedee@ESV', [ 'Zebedee@ESV', '', '', 'James', '', '', '', '', 'Male' ]),
    `\u2013 named\tZebedee\t\t\t\tMat.3.1`
  ].join('\n');
  const properNounsDir = path.join(root, 'Proper Nouns');
  fs.mkdirSync(properNounsDir, { recursive: true });
  fs.writeFileSync(
    path.join(properNounsDir, 'TIPNR - Translators Individualised Proper Names with all References - STEPBible.org CC BY.txt'),
    stepRows,
    'utf8'
  );
  fs.mkdirSync(path.join(root, 'sbl'), { recursive: true });
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sortedSnapshot(dirPath) {
  const entries = [];
  const walk = (base) => {
    for (const item of fs.readdirSync(base, { withFileTypes: true })) {
      const p = path.join(base, item.name);
      if (item.isDirectory()) {
        walk(p);
      } else {
        entries.push(p);
      }
    }
  };
  walk(dirPath);
  return entries
    .sort()
    .map((p) => `${path.relative(dirPath, p)}:${fs.readFileSync(p).toString('hex')}`);
}

function runIngest(stepDir, outDir, sblDir) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'scripts/build-stepbible-corpus.js'),
      '--step-data-dir',
      stepDir,
      '--sblgnt-dir',
      sblDir,
      '--output-dir',
      outDir,
      '--snapshot',
      '2026-08-26'
    ],
    { stdio: 'inherit' }
  );
  if (result.status !== 0 || result.error) {
    throw new Error(`build-stepbible-corpus failed: ${result.error || result.status}`);
  }
}

function withEmptyRelationshipSeed(run) {
  const seeds = path.join(process.cwd(), 'editorial', 'relationship-seeds.jsonl');
  const hadSeeds = fs.existsSync(seeds);
  const original = hadSeeds ? fs.readFileSync(seeds, 'utf8') : '';

  fs.writeFileSync(seeds, '', 'utf8');
  try {
    return run();
  } finally {
    if (hadSeeds) {
      fs.writeFileSync(seeds, original, 'utf8');
    } else {
      fs.unlinkSync(seeds);
    }
  }
}

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-step-boundary-'));
  const stepDir = path.join(tmpRoot, 'step');
  const sblDir = path.join(tmpRoot, 'sbl');
  const firstOut = path.join(tmpRoot, 'out-1');
  const secondOut = path.join(tmpRoot, 'out-2');
  try {
    makeFixture(stepDir);
    fs.mkdirSync(firstOut, { recursive: true });
    fs.mkdirSync(secondOut, { recursive: true });

    withEmptyRelationshipSeed(() => {
      runIngest(stepDir, firstOut, sblDir);
      runIngest(stepDir, secondOut, sblDir);
    });

    const firstSnapshot = sortedSnapshot(firstOut);
    const secondSnapshot = sortedSnapshot(secondOut);
    if (firstSnapshot.length !== secondSnapshot.length) {
      throw new Error(`Determinism regression: file-count mismatch (${firstSnapshot.length} != ${secondSnapshot.length}).`);
    }
    for (let i = 0; i < firstSnapshot.length; i += 1) {
      if (firstSnapshot[i] !== secondSnapshot[i]) {
        throw new Error(`Determinism regression at ${i}: ${firstSnapshot[i]} != ${secondSnapshot[i]}`);
      }
    }
    console.log('[pass] step boundary regression: deterministic rebuild confirmed (two-byte identical corpus).');

    const people = readJsonl(path.join(firstOut, 'people.jsonl'));
    const names = readJsonl(path.join(firstOut, 'names.jsonl'));

    const alphaPerson = people.find((p) => {
      const personNames = names.filter((n) => n.person_id === p.person_id).map((n) => n.name_text);
      return personNames.includes('Alpha');
    });
    if (!alphaPerson) {
      throw new Error('Expected accepted person "Alpha" was not produced.');
    }
    const alphaNames = names
      .filter((n) => n.person_id === alphaPerson.person_id)
      .map((n) => n.name_text);

    if (alphaNames.includes('SkipperAlias')) {
      throw new Error('Regression detected: skipped @Article subrecord leaked into preceding accepted person.');
    }

    console.log('[pass] step boundary regression: skipped top-level subrecords do not leak.');

    if (people.some((p) => names.some((n) => n.person_id === p.person_id && n.name_text === 'GroupFounder'))) {
      throw new Error('Group-only NT references must not cause a named person to enter the NT corpus.');
    }
    if (names.some((n) => n.name_text === 'People')) {
      throw new Error('Group aliases must not leak into person name variants.');
    }
    if (names.some((n) => n.name_text === 'Inferred')) {
      throw new Error('Mentioned-only inferred identities must not enter the named-person corpus.');
    }
    console.log('[pass] STEP entity boundary regression: group aliases and inherited group forms are excluded.');

    const alphaIdBefore = alphaPerson.person_id;
    const fixturePath = path.join(stepDir, 'Proper Nouns', 'TIPNR - Translators Individualised Proper Names with all References - STEPBible.org CC BY.txt');
    const originalFixture = fs.readFileSync(fixturePath, 'utf8');
    fs.writeFileSync(
      fixturePath,
      originalFixture.replace('$========== PERSON\n', '$========== PERSON\nAardvark@ESV\t\t\t\t\t\t\t\tMale\n\u2013 named\tAardvark\t\t\t\tMat.1.2\n'),
      'utf8'
    );
    withEmptyRelationshipSeed(() => runIngest(stepDir, firstOut, sblDir));
    const stablePeople = readJsonl(path.join(firstOut, 'people.jsonl'));
    const stableNames = readJsonl(path.join(firstOut, 'names.jsonl'));
    const alphaAfter = stableNames.find((n) => n.name_text === 'Alpha');
    if (!alphaAfter || alphaAfter.person_id !== alphaIdBefore || !stablePeople.some((p) => p.person_id === alphaIdBefore)) {
      throw new Error('Existing STEP identity key did not preserve its person_id after insertion.');
    }
    console.log('[pass] stable person-id regression: existing identities retain IDs across source insertions.');

    const relationStepDir = path.join(tmpRoot, 'relations');
    const relationOut = path.join(tmpRoot, 'relations-out');
    makeRelationFixture(relationStepDir);
    fs.mkdirSync(relationOut, { recursive: true });
    withEmptyRelationshipSeed(() => {
      runIngest(relationStepDir, relationOut, sblDir);
    });

    const relPeople = readJsonl(path.join(relationOut, 'people.jsonl'));
    const relNames = readJsonl(path.join(relationOut, 'names.jsonl'));
    const relAssertions = readJsonl(path.join(relationOut, 'assertions.jsonl'));
    const personIdByName = new Map(
      relPeople.flatMap((p) =>
        relNames
          .filter((n) => n.person_id === p.person_id)
          .map((n) => [n.name_text, p.person_id])
      )
    );
    const parentJamesPeter = relAssertions.filter((a) => a.relation_subtype === 'parent' && a.direction === 'directed');
    if (parentJamesPeter.length !== 1) {
      throw new Error(`Expected one parent assertion, got ${parentJamesPeter.length}.`);
    }
    const parent = parentJamesPeter[0];
    if (parent.subject_person_id !== personIdByName.get('James') || parent.object_person_id !== personIdByName.get('Peter')) {
      throw new Error('Parent assertion direction should be parent -> child (James -> Peter).');
    }
    const sibling = relAssertions.filter((a) => a.relation_subtype === 'sibling' && a.direction === 'undirected');
    if (sibling.length !== 1) {
      throw new Error(`Expected one sibling assertion, got ${sibling.length}.`);
    }
    const jamesId = personIdByName.get('James');
    const zebId = personIdByName.get('Zebedee');
    const siblingAssertion = sibling[0];
    if (siblingAssertion.subject_person_id.localeCompare(siblingAssertion.object_person_id) > 0) {
      throw new Error('Sibling assertion endpoints are not in lexical order.');
    }
    const sibIds = [siblingAssertion.subject_person_id, siblingAssertion.object_person_id].sort();
    const expectedIds = [jamesId, zebId].sort();
    if (sibIds[0] !== expectedIds[0] || sibIds[1] !== expectedIds[1]) {
      throw new Error('Sibling assertion should use lexical endpoint ordering.');
    }
    console.log('[pass] kinship normalization regression: duplicates are deduplicated and directed correctly.');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
