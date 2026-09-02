#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_PATH = path.join(ROOT, 'editorial', 'source-access-review.jsonl');
const rows = fs.readFileSync(REVIEW_PATH, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const SOURCES_ROOT = path.resolve(ROOT, '.sources');
const MAX_DOWNLOAD_ATTEMPTS = 4;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const RETRY_BASE_DELAY_MS = 1_000;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function resolveSourcePath(localPath) {
  const resolved = path.resolve(ROOT, localPath);
  if (!resolved.startsWith(`${SOURCES_ROOT}${path.sep}`)) throw new Error(`source path escapes .sources: ${localPath}`);
  return resolved;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadWithRetry(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new Error(`${url}: HTTP ${response.status}`);
        error.retryable = TRANSIENT_HTTP_STATUSES.has(response.status);
        throw error;
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false;
      if (!retryable || attempt === MAX_DOWNLOAD_ATTEMPTS) throw error;

      const delay = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
      console.warn(
        `[historical-source] transient download failure; retrying ${attempt + 1}/${MAX_DOWNLOAD_ATTEMPTS} in ${delay}ms: ${error.message}`,
      );
      await wait(delay);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function downloadCandidates(url) {
  const candidates = [url];
  const parsed = new URL(url);
  const archiveMatch = parsed.pathname.match(/^\/download\/([^/]+)\/(.+)$/);
  if (!archiveMatch || parsed.hostname !== 'archive.org') return candidates;

  const [, encodedIdentifier, encodedFilePath] = archiveMatch;
  try {
    const metadataUrl = `https://archive.org/metadata/${encodedIdentifier}`;
    const metadata = JSON.parse((await downloadWithRetry(metadataUrl)).toString('utf8'));
    const directory = typeof metadata.dir === 'string' ? metadata.dir.replace(/\/$/, '') : '';
    const mirrors = [metadata.d1, metadata.d2]
      .filter((host, index, hosts) => typeof host === 'string' && host && hosts.indexOf(host) === index)
      .map((host) => `https://${host}${directory}/${encodedFilePath}`);
    return [...mirrors, ...candidates];
  } catch (error) {
    console.warn(`[historical-source] unable to resolve Internet Archive mirrors; using canonical URL: ${error.message}`);
    return candidates;
  }
}

async function downloadLockedSource(url) {
  const candidates = await downloadCandidates(url);
  let lastError;

  for (const candidate of candidates) {
    try {
      return await downloadWithRetry(candidate);
    } catch (error) {
      lastError = error;
      if (candidate !== candidates.at(-1)) {
        console.warn(`[historical-source] mirror unavailable; trying next official URL: ${error.message}`);
      }
    }
  }

  throw lastError;
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
    const buffer = await downloadLockedSource(file.url);
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
