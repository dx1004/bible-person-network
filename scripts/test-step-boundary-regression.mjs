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

function makeSameNameRelationFixture(root) {
  const row = (name, parents = '', siblings = '', offspring = '') =>
    [name, '', parents, siblings, '', offspring, '', '', 'Male'].join('\t');
  const stepRows = [
    '$========== PERSON',
    row('James@Mat.4.21=G1', 'Zebedee@Mat.4.21', 'John@Mat.4.21'),
    '\u2013 named\tJames\t\t\t\tMat.4.21',
    row('James@Mat.10.3=G2', 'Alphaeus@Mat.10.3'),
    '\u2013 named\tJames\t\t\t\tMat.10.3',
    row('Zebedee@Mat.4.21=G3', '', '', 'James@Mat.4.21'),
    '\u2013 named\tZebedee\t\t\t\tMat.4.21',
    row('John@Mat.4.21=G4', '', 'James@Mat.4.21'),
    '\u2013 named\tJohn\t\t\t\tMat.4.21',
    row('Alphaeus@Mat.10.3=G5', '', '', 'James@Mat.10.3'),
    '\u2013 named\tAlphaeus\t\t\t\tMat.10.3'
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

function makeSplitFixture(root) {
  const stepRows = [
    '$========== PERSON',
    ['Demetrius@Act.19.24-3Jn=G1216', 'Man living at the time of the New Testament', '', '', '', '', '', '', 'Male'].join('\t'),
    '\u2013 Named\tDemetrius@Act.19.24-3Jn\tG1216\u00abG1216=\u0394\u03b7\u03bc\u1f75\u03c4\u03c1\u03b9\u03bf\u03c2\tDemetrius\t\tAct.19.24; Act.19.38; 3Jn.1.12'
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

function makeSplitOverrideFixture(root) {
  const stepRows = [
    '$========== PERSON',
    'Simon@Act.8.13-=G4613N\tA person living in the time of the New Testament\t\t\t\t\t\t\t\tMale',
    '\u2013 Named\tSimon\t\t\t\tAct.8.13; Act.9.43; Act.10.6; Act.10.17; Act.10.32',
    'Simon@Mat.26.6-Luk=G4613I\tA leper host in the gospels\t\t\t\t\t\t\tMale',
    '\u2013 Named\tSimon\t\t\t\tMat.26.6; Mrk.14.3; Luk.7.40; Luk.7.43; Luk.7.44',
    'Alexander@1Ti.1.20-2Ti=G0223J\tA man mentioned in Timothy letters\t\t\t\t\t\t\tMale',
    '\u2013 Named\tAlexander\t\t\t\t1Ti.1.20; 2Ti.4.14'
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

function makeJezebelSplitFixture(root) {
  const stepRows = [
    '$========== PERSON',
    'Jezebel@1Ki.16.31-Rev=H0348\tA woman mentioned by John in Revelation\tSomeSource@1Ki.16.31-Rev=H0001\t\t\t\t\tFemale',
    '\u2013 named\tJezebel\t\t\t\tRev.2.20'
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
      '--ignore-relationship-seeds',
      'true',
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

  let canWriteSeeds = true;
  try {
    fs.writeFileSync(seeds, '', 'utf8');
  } catch (error) {
    if (error?.code === 'EPERM') {
      canWriteSeeds = false;
      console.warn('[warn] relationship-seeds.jsonl is not writable in this environment; running regression with existing seeds.');
    } else {
      throw error;
    }
  }
  try {
    return run();
  } finally {
    if (canWriteSeeds) {
      if (hadSeeds) {
        fs.writeFileSync(seeds, original, 'utf8');
      } else {
        fs.unlinkSync(seeds);
      }
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

    const sameNameStepDir = path.join(tmpRoot, 'same-name-relations');
    const sameNameOut = path.join(tmpRoot, 'same-name-relations-out');
    makeSameNameRelationFixture(sameNameStepDir);
    fs.mkdirSync(sameNameOut, { recursive: true });
    withEmptyRelationshipSeed(() => runIngest(sameNameStepDir, sameNameOut, sblDir));
    const samePeople = readJsonl(path.join(sameNameOut, 'people.jsonl'));
    const sameNames = readJsonl(path.join(sameNameOut, 'names.jsonl'));
    const sameAssertions = readJsonl(path.join(sameNameOut, 'assertions.jsonl'));
    const idsByIdentity = new Map(
      sameNames
        .filter((name) => name.notes.startsWith('Unified name from STEP: '))
        .map((name) => [name.notes.slice('Unified name from STEP: '.length).replace(/=\S+$/, ''), name.person_id])
    );
    const expectedParentPairs = [
      [idsByIdentity.get('Zebedee@Mat.4.21'), idsByIdentity.get('James@Mat.4.21')],
      [idsByIdentity.get('Alphaeus@Mat.10.3'), idsByIdentity.get('James@Mat.10.3')]
    ];
    for (const [parentId, childId] of expectedParentPairs) {
      if (!samePeople.some((person) => person.person_id === parentId) || !samePeople.some((person) => person.person_id === childId)) {
        throw new Error('Same-name fixture did not produce distinct stable person identities.');
      }
      if (!sameAssertions.some((a) => a.relation_subtype === 'parent' && a.subject_person_id === parentId && a.object_person_id === childId)) {
        throw new Error(`Exact STEP identity relation endpoint was not preserved: ${parentId} -> ${childId}`);
      }
    }
    if (idsByIdentity.get('James@Mat.4.21') === idsByIdentity.get('James@Mat.10.3')) {
      throw new Error('Same-name STEP records were merged unexpectedly.');
    }
    console.log('[pass] exact relation endpoint regression: same-name STEP people remain distinct.');

    const splitStepDir = path.join(tmpRoot, 'split-person');
    const splitOut = path.join(tmpRoot, 'split-person-out');
    makeSplitFixture(splitStepDir);
    fs.mkdirSync(splitOut, { recursive: true });
    withEmptyRelationshipSeed(() => runIngest(splitStepDir, splitOut, sblDir));
    const splitPeople = readJsonl(path.join(splitOut, 'people.jsonl'));
    const splitMentions = readJsonl(path.join(splitOut, 'mentions.jsonl'));
    if (splitPeople.length !== 2) throw new Error(`Expected Demetrius override to create two people, got ${splitPeople.length}.`);
    const mentionSets = splitPeople.map((person) =>
      splitMentions.filter((mention) => mention.person_id === person.person_id).map((mention) => mention.passage).sort().join('|')
    ).sort();
    if (mentionSets.join(',') !== ['3JN 1:12', 'ACT 19:24|ACT 19:38'].sort().join(',')) {
      throw new Error(`Person split override did not partition mentions exactly: ${mentionSets.join(',')}`);
    }
    console.log('[pass] person split override regression: one STEP record becomes conservative verse-partitioned identities.');

    const splitOverrideStepDir = path.join(tmpRoot, 'split-person-overrides');
    const splitOverrideOut = path.join(tmpRoot, 'split-person-overrides-out');
    makeSplitOverrideFixture(splitOverrideStepDir);
    fs.mkdirSync(splitOverrideOut, { recursive: true });
    withEmptyRelationshipSeed(() => runIngest(splitOverrideStepDir, splitOverrideOut, sblDir));
    const overridePeople = readJsonl(path.join(splitOverrideOut, 'people.jsonl'));
    const overrideMentions = readJsonl(path.join(splitOverrideOut, 'mentions.jsonl'));
    if (overridePeople.length !== 6) {
      throw new Error(`Expected 6 partitioned identities from conservative split overrides, got ${overridePeople.length}.`);
    }
    const overrideMentionSets = overridePeople.map((person) =>
      overrideMentions
        .filter((mention) => mention.person_id === person.person_id)
        .map((mention) => mention.passage)
        .sort()
        .join('|')
    ).sort();
    const expectedOverrideMentionSets = [
      'ACT 8:13',
      'ACT 10:17|ACT 10:32|ACT 10:6|ACT 9:43',
      'MAT 26:6|MRK 14:3',
      'LUK 7:40|LUK 7:43|LUK 7:44',
      '1TI 1:20',
      '2TI 4:14'
    ].sort();
    if (overrideMentionSets.join('|') !== expectedOverrideMentionSets.join('|')) {
      throw new Error(`Person split override regression failed partition coverage: ${overrideMentionSets.join(' ; ')}`);
    }
    console.log('[pass] person split override regression: new Simon and Alexander split prerequisites partition mentions exactly.');

    const jezebelStepDir = path.join(tmpRoot, 'jezebel-split');
    const jezebelOut = path.join(tmpRoot, 'jezebel-split-out');
    makeJezebelSplitFixture(jezebelStepDir);
    fs.mkdirSync(jezebelOut, { recursive: true });
    withEmptyRelationshipSeed(() => runIngest(jezebelStepDir, jezebelOut, sblDir));
    const jezebelPeople = readJsonl(path.join(jezebelOut, 'people.jsonl'));
    const jezebelNames = readJsonl(path.join(jezebelOut, 'names.jsonl'));
    const jezebelMentions = readJsonl(path.join(jezebelOut, 'mentions.jsonl'));
    const jezebelAssertions = readJsonl(path.join(jezebelOut, 'assertions.jsonl'));
    const jezebelPersonIds = new Set(
      jezebelMentions
        .filter((m) => m.passage === 'REV 2:20')
        .map((m) => m.person_id)
    );
    if (jezebelPersonIds.size !== 1) {
      throw new Error(`Expected a single replacement identity for REV 2:20 Jezebel fixture, got ${jezebelPersonIds.size}.`);
    }
    const [jezebelPersonId] = [...jezebelPersonIds];
    const replacementName = jezebelNames.find((n) => n.person_id === jezebelPersonId && n.name_text === 'Jezebel');
    if (!replacementName || replacementName.notes !== 'Unified name from STEP: Jezebel@Rev.2.20-H0348') {
      throw new Error('Expected split replacement identity to preserve explicit one-part partition unified_raw identity key.');
    }
    const replacementNames = jezebelNames.filter((n) => n.person_id === jezebelPersonId).map((n) => n.name_text);
    if (!replacementNames.includes('Jezebel')) {
      throw new Error(`Expected replacement identity to retain canonical name text "Jezebel", got ${replacementNames.join(', ')}`);
    }
    const hasRelation = jezebelAssertions.some(
      (a) => a.subject_person_id === jezebelPersonId || a.object_person_id === jezebelPersonId
    );
    if (hasRelation) {
      throw new Error('One-part split replacement should clear OT-derived relation fields for the new Rev 2:20 identity.');
    }
    console.log('[pass] person split replacement regression: Rev 2:20 Jezebel can be represented as a distinct NT-only identity with cleared relations.');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
