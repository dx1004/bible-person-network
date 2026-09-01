#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['scripts/generate-inference-relationship-review.mjs', '--check'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
