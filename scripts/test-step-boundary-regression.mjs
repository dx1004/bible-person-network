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
    + `\u2013 named\tBeta\t\t\t\tMat.3.1\n`;
  const properNounsDir = path.join(root, 'Proper Nouns');
  fs.mkdirSync(properNounsDir, { recursive: true });
  fs.writeFileSync(
    path.join(properNounsDir, 'TIPNR - Translators Individualised Proper Names with all References - STEPBible.org CC BY.txt'),
    stepFile,
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

    runIngest(stepDir, firstOut, sblDir);
    runIngest(stepDir, secondOut, sblDir);

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
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
