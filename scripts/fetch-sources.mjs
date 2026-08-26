#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, '.sources');

const sources = [
  {
    name: 'sblgnt',
    url: 'https://github.com/LogosBible/SBLGNT.git',
    commit: 'c4d241a9c1c479a55b989ba35a4976c1d0b8052c'
  },
  {
    name: 'stepbible-data',
    url: 'https://github.com/STEPBible/STEPBible-Data.git',
    commit: 'efe428a0047bf7b9c3ce2624f60c252c6e435945'
  }
];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result.stdout.trim();
}

fs.mkdirSync(sourceRoot, { recursive: true });

for (const source of sources) {
  const target = path.join(sourceRoot, source.name);
  if (!fs.existsSync(path.join(target, '.git'))) {
    run('git', ['clone', '--filter=blob:none', '--no-checkout', source.url, target]);
  }
  run('git', ['fetch', '--depth', '1', 'origin', source.commit], target);
  run('git', ['checkout', '--detach', source.commit], target);
  const actual = run('git', ['rev-parse', 'HEAD'], target);
  if (actual !== source.commit) throw new Error(`${source.name}: expected ${source.commit}, got ${actual}`);
  console.log(`${source.name}: ${actual}`);
}

console.log(`Locked sources ready in ${sourceRoot}`);
