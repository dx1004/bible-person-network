#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MENTIONS = path.join(ROOT, 'data', 'mentions.jsonl');
const LEDGER = path.join(ROOT, 'editorial', 'mention-sense-review.jsonl');
const REPORT = path.join(ROOT, 'editorial', 'mention-sense-application-report.json');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
// Explicitly reviewed semantic corrections. Existing mention_sense values are
// otherwise immutable so accidental snapshot drift still fails closed.
const SENSE_CORRECTION_IDS = new Set([
  'mnt-015606', 'mnt-014288', 'mnt-007703', 'mnt-0935',
  'mnt-007610', 'mnt-007643', 'mnt-008840', 'mnt-010351', 'mnt-012144', 'mnt-014987',
  'mnt-015752', 'mnt-015989', 'mnt-017843', 'mnt-020169', 'mnt-2163',
]);
const RULED_CORRECTION_REASON_CODES = new Set([
  'polysemous_tribal_context',
  'polysemous_collective_context',
  'polysemous_place_context',
  'polysemous_national_context',
  'nt_context_reference_without_explicit_name',
  'curated_parent_reference_without_name',
  'curated_textual_subscription_absent',
  'curated_verse_absent_locked_text',
  'curated_common_noun_not_person_name',
  'jacob_israel_poetic_collective',
  'jacob_prophetic_collective',
  'israel_collective_after_genesis',
  'ot_residual_tribal_eponym',
  'ot_residual_people_eponym',
  'ot_context_reference_without_explicit_name',
  'curated_final_tribal_reference',
  'curated_final_collective_reference',
  'curated_final_context_without_explicit_name',
]);
const PERSON_CORRECTION_REASON_CODES = new Set([
  'reviewed_direct_assertion_endpoint',
]);
if (APPLY === CHECK) throw new Error('pass exactly one of --apply or --check');

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

const mentions = readJsonl(MENTIONS);
const reviews = readJsonl(LEDGER);
const accepted = new Map(
  reviews
    .filter((row) => row.final_decision?.status === 'accepted')
    .map((row) => [row.mention_id, row.final_decision.mention_sense])
);
const ruledCorrectionIds = new Set(
  reviews
    .filter((row) => row.final_decision?.status === 'accepted'
      && ((row.final_decision?.mention_sense !== 'person'
        && RULED_CORRECTION_REASON_CODES.has(row.final_decision?.reason_code))
        || (row.final_decision?.mention_sense === 'person'
          && PERSON_CORRECTION_REASON_CODES.has(row.final_decision?.reason_code))))
    .map((row) => row.mention_id)
);
const mentionIds = new Set(mentions.map((row) => row.mention_id));
for (const mentionId of accepted.keys()) if (!mentionIds.has(mentionId)) throw new Error(`missing mention ${mentionId}`);

let changed = 0;
const output = mentions.map((mention) => {
  const sense = accepted.get(mention.mention_id);
  if (!sense) return mention;
  if (mention.mention_sense && mention.mention_sense !== sense
    && !SENSE_CORRECTION_IDS.has(mention.mention_id)
    && !ruledCorrectionIds.has(mention.mention_id)) {
    throw new Error(`sense conflict ${mention.mention_id}: ${mention.mention_sense} != ${sense}`);
  }
  if (mention.mention_sense === sense) return mention;
  changed += 1;
  return { ...mention, mention_sense: sense };
});
const outputText = `${output.map((row) => JSON.stringify(row)).join('\n')}\n`;
const counts = Object.fromEntries(['person', 'people_group', 'tribe', 'nation', 'place', 'ambiguous'].map((sense) => [sense, output.filter((row) => row.mention_sense === sense).length]));
const report = {
  dataset: 'mention-sense-application',
  total_mentions: output.length,
  reviewed_mentions: accepted.size,
  changed_mentions: changed,
  pending_mentions: output.length - accepted.size,
  sense_counts: counts,
  output_snapshot_sha256: crypto.createHash('sha256').update(outputText).digest('hex')
};

if (CHECK) {
  if (changed) throw new Error(`${changed} accepted mention-sense decisions are not applied`);
  const saved = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  if (saved.output_snapshot_sha256 !== report.output_snapshot_sha256 || saved.reviewed_mentions !== report.reviewed_mentions) throw new Error('mention-sense application report drift');
  console.log(JSON.stringify({ ...report, mode: 'check' }));
} else {
  atomicWrite(MENTIONS, outputText);
  atomicWrite(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, mode: 'apply' }));
}
