#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/apply-old-testament-person-review-sidecar.js', '--check-only'], {
  stdio: 'inherit'
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
