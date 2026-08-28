#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_PATH = path.join(ROOT, 'editorial', 'source-access-review.jsonl');
const rows = fs.readFileSync(REVIEW_PATH, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const SOURCES_ROOT = path.resolve(ROOT, '.sources');

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function resolveSourcePath(localPath) {
  const resolved = path.resolve(ROOT, localPath);
  if (!resolved.startsWith(`${SOURCES_ROOT}${path.sep}`)) throw new Error(`source path escapes .sources: ${localPath}`);
  return resolved;
}

for (const row of rows.filter((item) => item.access_status === 'locked_public_download')) {
  for (const file of row.files) {
    const target = resolveSourcePath(file.local_path);
    if (fs.existsSync(target)) {
      const existing = fs.readFileSync(target);
      if (existing.length === file.bytes && sha256(existing) === file.sha256) {
        console.log(`[historical-source] verified ${file.local_path}`);
        continue;
      }
    }
    const response = await fetch(file.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length !== file.bytes) throw new Error(`${file.local_path}: byte mismatch`);
    if (sha256(buffer) !== file.sha256) throw new Error(`${file.local_path}: SHA-256 mismatch`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const realParent = fs.realpathSync(path.dirname(target));
    const realSourcesRoot = fs.realpathSync(SOURCES_ROOT);
    if (!realParent.startsWith(`${realSourcesRoot}${path.sep}`)) throw new Error(`source directory escapes .sources: ${file.local_path}`);
    const temporary = `${target}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    try {
      fs.writeFileSync(temporary, buffer, { flag: 'wx' });
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    console.log(`[historical-source] downloaded ${file.local_path}`);
  }
}
