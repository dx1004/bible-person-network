#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, '.sources');
const dataManifest = path.join(root, 'data', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(dataManifest, 'utf8'));

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

const cuvSource = {
  name: 'cmn-cu89s-usfm',
  url: 'https://ebible.org/Scriptures/cmn-cu89s_usfm.zip',
  checksum: manifest.supplemental_source?.cuv_zip_sha256,
  extractedPath: path.join(sourceRoot, 'cmn-cu89s-usfm')
};

function assertCommandExists(command, commandForError) {
  const fallback = commandForError || command;
  const probe = process.platform === 'win32'
    ? spawnSync('where', [command], { encoding: 'utf8', stdio: 'pipe' })
    : spawnSync('which', [command], { encoding: 'utf8', stdio: 'pipe' });
  if (probe.error) {
    throw new Error(`required command "${fallback}" is not available: ${probe.error.message}`);
  }
  if (probe.status !== 0) {
    throw new Error(`required command "${fallback}" is not available in PATH`);
  }
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result.stdout?.trim();
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function hasUsfm(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasUsfm(fullPath)) {
        return true;
      }
    } else if (/\.usfm$/i.test(entry.name)) {
      return true;
    }
  }
  return false;
}

function downloadWithSha256(url, expectedSha256, destPath, timeoutMs = 60000) {
  if (!expectedSha256 || typeof expectedSha256 !== 'string') {
    throw new Error('manifest missing supplemental_source.cuv_zip_sha256');
  }

  const start = new URL(url);
  if (!/^https?:$/.test(start.protocol)) {
    throw new Error(`unsupported protocol for CUV source: ${start.protocol}`);
  }

  const writeWithDir = (filePath) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return fs.createWriteStream(filePath, { flags: 'w' });
  };

  const requestOnce = (requestUrl, currentRedirects, responseTimeoutMs) => new Promise((resolve, reject) => {
    const parsed = new URL(requestUrl);
    const client = parsed.protocol === 'http:' ? http : https;

    const req = client.get(parsed, (res) => {
      const statusCode = res.statusCode || 0;

      if (statusCode >= 300 && statusCode < 400) {
        const location = res.headers.location;
        res.resume();
        if (!location) {
          reject(new Error(`redirect without Location from ${requestUrl} (status ${statusCode})`));
          return;
        }
        if (currentRedirects <= 0) {
          reject(new Error(`too many redirects for ${url}`));
          return;
        }
        const nextUrl = new URL(location, requestUrl).toString();
        const nextProtocol = new URL(nextUrl).protocol;
        if (!/^https?:$/.test(nextProtocol)) {
          reject(new Error(`unsupported redirect protocol ${nextProtocol} for ${url}`));
          return;
        }
        resolve(requestOnce(nextUrl, currentRedirects - 1, responseTimeoutMs));
        return;
      }

      if (statusCode !== 200) {
        res.resume();
        reject(new Error(`download failed: ${requestUrl} (HTTP ${statusCode})`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(responseTimeoutMs, () => req.destroy(new Error(`download timeout for ${requestUrl}`)));
    req.on('error', (err) => reject(err));
  });

  return (async () => {
    const hash = crypto.createHash('sha256');
    const output = writeWithDir(destPath);
    try {
      const response = await requestOnce(url, 5, timeoutMs);
      await pipeline(
        response,
        new Transform({
          transform(chunk, encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
          }
        }),
        output
      );
      const actual = hash.digest('hex');
      if (actual !== expectedSha256) {
        throw new Error(`checksum mismatch for ${url}. expected ${expectedSha256}, got ${actual}`);
      }
    } catch (error) {
      if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true });
      throw error;
    }
  })();
}

function extractCuvZip(zipPath, extractedPath) {
  const tempDir = path.join(sourceRoot, '.tmp-cuv-usfm-extract');
  removeDir(tempDir);
  removeDir(extractedPath);
  fs.mkdirSync(tempDir, { recursive: true });

  if (process.platform === 'win32') {
    assertCommandExists('powershell', 'PowerShell');
    const quotedZip = zipPath.replace(/'/g, "''");
    const quotedTarget = tempDir.replace(/'/g, "''");
    run(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${quotedZip}' -DestinationPath '${quotedTarget}' -Force`
      ],
      root
    );
  } else {
    assertCommandExists('unzip');
    run('unzip', ['-q', zipPath, '-d', tempDir], root);
  }

  if (!hasUsfm(tempDir)) {
    removeDir(tempDir);
    throw new Error(`invalid or empty extracted CUV archive at ${zipPath}`);
  }

  fs.renameSync(tempDir, extractedPath);
}

function fetchGitSources() {
  for (const source of sources) {
    const target = path.join(sourceRoot, source.name);
    if (!fs.existsSync(path.join(target, '.git'))) {
      run('git', ['clone', '--filter=blob:none', '--no-checkout', source.url, target]);
    }
    run('git', ['fetch', '--depth', '1', 'origin', source.commit], target);
    run('git', ['checkout', '--detach', source.commit], target);
    const actual = run('git', ['rev-parse', 'HEAD'], target);
    if (actual !== source.commit) {
      throw new Error(`${source.name}: expected ${source.commit}, got ${actual}`);
    }
    console.log(`${source.name}: ${actual}`);
  }
}

async function fetchCuvSource() {
  const zipPath = path.join(sourceRoot, `.tmp-${randomUUID()}.zip`);

  try {
    await downloadWithSha256(cuvSource.url, cuvSource.checksum, zipPath);
    extractCuvZip(zipPath, cuvSource.extractedPath);
    fs.rmSync(zipPath, { force: true });
  } catch (error) {
    removeDir(cuvSource.extractedPath);
    removeDir(path.join(sourceRoot, '.tmp-cuv-usfm-extract'));
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
    throw error;
  }
}

async function main() {
  assertCommandExists('git');
  fs.mkdirSync(sourceRoot, { recursive: true });

  fetchGitSources();
  console.log(`fetching CUV source: ${cuvSource.url}`);
  await fetchCuvSource();
  console.log(`cuv source ready: ${cuvSource.extractedPath}`);
  console.log(`Locked sources ready in ${sourceRoot}`);
}

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
