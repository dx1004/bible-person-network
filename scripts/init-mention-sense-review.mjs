#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const EDITORIAL = path.join(ROOT, 'editorial');
const LEDGER = path.join(EDITORIAL, 'mention-sense-review.jsonl');
const REPORT = path.join(EDITORIAL, 'mention-sense-review-report.json');
const EXPLICIT_LEDGER = path.join(EDITORIAL, 'mention-sense-explicit-person-proposals.jsonl');
const EXPLICIT_REPORT = path.join(EDITORIAL, 'mention-sense-explicit-person-proposals-report.json');
const SCHEMA = path.join(ROOT, 'schemas', 'mention-sense-review.schema.json');
const CUV = path.join(ROOT, '.sources', 'cmn-cu89s-usfm');
const STAMP = '2026-08-31T00:00:00Z';
const CHECK = process.argv.includes('--check');
const REVIEWED_PERSON_SEED_PATH = path.join(EDITORIAL, 'mention-sense-reviewed-person-seed.jsonl');
const SBLGNT_NAME_AUDIT_PATH = path.join(DATA, 'sblgnt-name-audit.jsonl');
const STEP_OT_ROOT = path.join(ROOT, '.sources', 'stepbible-data', 'Translators Amalgamated OT+NT');
const TAHOT_PATHS = [
  'TAHOT Gen-Deu - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  'TAHOT Jos-Est - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  'TAHOT Job-Sng - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
  'TAHOT Isa-Mal - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
].map((name) => path.join(STEP_OT_ROOT, name));
const TOTHT_PATHS = [
  'TOTHT Gen-Deu - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt',
  'TOTHT Jos-Est - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt',
  'TOTHT Job-Sng - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt',
  'TOTHT Isa-Mal - Translators OT Hebrew Tagged text - STEPBible.org CC BY.txt',
].map((name) => path.join(STEP_OT_ROOT, 'OLD format TOTHT', name));

const CURATED = new Map([
  ['person-001235|JER 36:26', ['ambiguous', 'curated_common_noun_not_person_name', '希伯来文 הַמֶּלֶךְ 是普通名词“王”，不是“哈米勒”这一具名人物；人物纠错 cpc-000001 已完成三轮复核。']],
  ['person-001235|JER 38:6', ['ambiguous', 'curated_common_noun_not_person_name', '希伯来文 הַמֶּלֶךְ 是普通名词“王”，不是“哈米勒”这一具名人物；人物纠错 cpc-000001 已完成三轮复核。']],
  ['person-000140|ACT 1:13', ['person', 'curated_named_person_in_roster', '使徒行传1:13明确出现“雅各”的名字；本实体为“雅各的儿子／兄弟犹大”关系中的雅各，属具名人物。']],
  ['person-000141|ACT 1:13', ['person', 'curated_named_person_in_roster', '使徒行传1:13明确列出“亚勒腓的儿子雅各”，人物身份由父名限定。']],
  ['person-000143|ACT 1:13', ['person', 'curated_named_person_in_roster', '使徒行传1:13使徒名单明确列出西庇太的儿子雅各；同节同名者按亲属限定语分辨。']],
  ['person-000156|ROM 16:25', ['person', 'curated_explicit_named_person', '罗马书16:25明确出现“耶稣基督”，是具名人物指称。']],
  ['person-000156|ROM 16:27', ['person', 'curated_explicit_named_person', '罗马书16:27明确出现“耶稣基督”，是具名人物指称。']],
  ['person-000156|2CO 13:14', ['person', 'curated_explicit_named_person', '哥林多后书13:14明确出现“主耶稣基督”，是具名人物指称。']],
  ['person-000175|LUK 2:33', ['ambiguous', 'curated_parent_reference_without_name', '路加福音2:33只写“孩子的父母”，没有出现约瑟之名；保留上下文指涉，不算明确名字提及。']],
  ['person-000175|LUK 2:43', ['ambiguous', 'curated_parent_reference_without_name', '路加福音2:43只写“他的父母”，没有出现约瑟之名；保留上下文指涉，不算明确名字提及。']],
  ['person-000188|LUK 6:16', ['person', 'curated_explicit_named_person', '路加福音6:16明确出现“雅各的儿子／兄弟犹大”，指非加略人犹大。']],
  ['person-000188|JHN 14:22', ['person', 'curated_explicit_named_person', '约翰福音14:22明确出现“犹大（不是加略人犹大）”，指非加略人犹大。']],
  ['person-000189|LUK 6:16', ['person', 'curated_explicit_named_person', '路加福音6:16明确出现“卖主的加略人犹大”。']],
  ['person-000189|JHN 14:22', ['person', 'curated_explicit_contrast_reference', '约翰福音14:22在“不是加略人犹大”的对照语中明确提及加略人犹大的名字，仍属于具名人物指涉。']],
  ['person-000209|2CO 13:14', ['ambiguous', 'curated_textual_subscription_absent', '锁定和合本与SBLGNT正文的哥林多后书13:14没有路加之名；该关联属于后期题署或传统，不算正文具名提及。']],
  ['person-000212|ACT 24:7', ['ambiguous', 'curated_verse_absent_locked_text', '锁定和合本与SBLGNT正文不含使徒行传24:7；克劳第·吕西亚在此定位属于后期文本传统，不算锁定正文具名提及。']],
  ['person-000274|ACT 8:37', ['ambiguous', 'curated_verse_absent_locked_text', '锁定和合本与SBLGNT正文不含使徒行传8:37；腓利在此定位属于后期文本传统，不算锁定正文具名提及。']],
  ['person-000280|ROM 16:27', ['ambiguous', 'curated_textual_subscription_absent', '罗马书16:27正文没有非比之名；该关联属于题署或传统，不算正文具名提及。']],
  ['person-000320|ACT 15:34', ['ambiguous', 'curated_verse_absent_locked_text', '锁定和合本与SBLGNT正文不含使徒行传15:34；西拉在此定位属于后期文本传统，不算锁定正文具名提及。']],
  ['person-000352|2CO 13:14', ['ambiguous', 'curated_textual_subscription_absent', '哥林多后书13:14正文没有提多之名；该关联属于题署或传统，不算正文具名提及。']],
  ['person-001966|NUM 32:40', ['people_group', 'eponymous_clan_not_individual', '“摩西将基列给了玛吉”承接前句“玛吉的子孙”，此处玛吉代表该宗族群体，不是历史个人在场。']],
  ['person-000183|RUT 1:2', ['place', 'regional_label_not_person', '“犹大伯利恒”中的犹大是地域，不是先祖犹大本人。']],
  ['person-001115|JOS 24:33', ['place', 'tribal_territory_not_person', '“以法莲山地”指向支派领地，不是先祖以法莲本人。']],
  ['person-000183|1KI 22:51', ['nation', 'kingdom_label_not_person', '“犹大王”中的犹大是王国，不是先祖犹大本人。']],
  ['person-000183|2CH 20:35', ['nation', 'kingdom_label_not_person', '“犹大王”中的犹大是王国，不是先祖犹大本人。']],
  ['person-002185|1KI 4:15', ['place', 'tribal_territory_not_person', '“在拿弗他利”指向支派领地，不是先祖拿弗他利本人。']],
  ['person-002185|1KI 7:14', ['tribe', 'tribal_label_not_person', '“是拿弗他利支派中一个寡妇的儿子”中的拿弗他利是支派，不是先祖本人。']],
  ['person-000183|2KI 15:17', ['nation', 'kingdom_label_not_person', '“犹大王”中的犹大是王国，不是先祖犹大本人。']],
  ['person-000183|2KI 15:13', ['nation', 'kingdom_label_not_person', '“犹大王乌西雅三十九年”中的犹大是王国，不是先祖犹大本人。']],
  ['person-000183|2KI 15:23', ['nation', 'kingdom_label_not_person', '“犹大王”中的犹大是王国，不是先祖犹大本人。']],
  ['person-000183|2KI 15:37', ['nation', 'polysemous_national_context', '“耶和华使亚兰王利汛和利玛利的儿子比加去攻击犹大”中的犹大是犹大国，不是先祖犹大本人。']],
  ['person-000183|2KI 17:1', ['nation', 'kingdom_label_not_person', '“犹大王”中的犹大是王国，不是先祖犹大本人。']],
  ['person-000183|2KI 18:1', ['nation', 'kingdom_label_not_person', '“犹大王”中的犹大是王国，不是先祖犹大本人。']],
  ['person-001979|ISA 8:1', ['ambiguous', 'curated_inscription_before_person_naming', '该节是写在牌上的预先题名；到赛8:3才明确用此名给孩子命名，因此本节不作明确人物提及。']],
  ['person-000156|ISA 7:14', ['ambiguous', 'curated_intertext_not_explicit_name', '该节未直接出现“耶稣”之名；与耶稣的关联属新约引用与解释路径，不作本节的直接具名人物提及。']],
  ['person-000156|ISA 8:8', ['ambiguous', 'curated_intertext_not_explicit_name', '该节未直接出现“耶稣”之名；神学上的弥赛亚解释另存为互文路径，不建立直接名字提及。']],
  ['person-000183|ISA 8:8', ['place', 'curated_land_reference_not_eponym', '“遍满你的地”中的犹大指向土地／地域，不是先祖犹大本人。']],
  ['person-001494|2SA 17:25', ['people_group', 'gentilic_not_person', '“以实玛利人”在本节是族属称谓，不是祖先以实玛利本人。']],
  ['person-001115|NUM 1:10', ['tribe', 'tribal_label_not_person', '“属以法莲的”在本节指支派归属，不是祖先以法莲本人在场。']],
  ['person-002015|NUM 1:10', ['tribe', 'tribal_label_not_person', '“属玛拿西的”在本节指支派归属，不是祖先玛拿西本人在场。']],
  ['person-000183|HAG 1:1', ['place', 'province_label_not_person', '“犹大省长”中的犹大是行政地域，不是祖先犹大本人。']],
  ['person-000183|HOS 1:1', ['nation', 'kingdom_label_not_person', '“作犹大王”中的犹大是王国，不是祖先犹大本人。']],
  ['person-000183|ISA 7:1', ['nation', 'kingdom_label_not_person', '“犹大王”中的犹大是王国，不是祖先犹大本人。']],
  ['person-001115|ISA 7:5', ['nation', 'kingdom_label_not_person', '“亚兰王和以法莲，并利玛利的儿子”中的以法莲指北国政治共同体，不是族长以法莲本人。']],
  ['person-000042|1CH 1:17', ['person', 'curated_explicit_unmarked_name', '1CH 1:17 处出现“亚法撒”，语境为族长谱列表中的专名；判定为人物。']],
  ['person-000926|1KI 4:9', ['person', 'curated_explicit_full_name_no_pn', '1KI 4:9 中“麦、以伦·伯·哈南有便·底甲”，此“便·底甲”为完整专名表述（不改身份）。']],
  ['person-001369|1KI 4:10', ['person', 'curated_explicit_full_name_no_pn', '1KI 4:10 中“有便·希悉”，其“便·希悉”为完整专名表述（不改身份）。']],
  ['person-000156|LUK 17:13', ['person', 'curated_explicit_unmarked_name', '“高声说：耶稣，夫子，可怜我们吧”中的“耶稣”为显性人物称呼。']],
  ['person-000156|ACT 3:20', ['person', 'curated_explicit_unmarked_name', '“差遣所预定给你们的基督（耶稣）降临”中的“耶稣”在该句为明确人物指称。']],
  ['person-002629|1SA 17:13', ['person', 'curated_explicit_named_son', '撒上17:13明确列出耶西第三子沙玛；此处“沙玛”是人物示米亚的中文异名。']]
]);

for (const key of [
  'person-000045|2SA 2:9',
  'person-000100|1CH 1:51', 'person-000100|1CH 1:54',
  'person-000110|NUM 32:2',
  'person-000135|1CH 29:27', 'person-000135|1SA 10:1', 'person-000135|1SA 14:24',
  'person-000135|2CH 21:2', 'person-000135|2KI 13:18', 'person-000135|AMO 4:5',
  'person-000135|DEU 32:15', 'person-000135|DEU 33:26', 'person-000135|EXO 16:3',
  'person-000135|EXO 19:2', 'person-000135|EZR 2:2', 'person-000135|JDG 8:35',
  'person-000135|JOS 22:12', 'person-000135|NEH 7:7', 'person-000135|NUM 31:47',
  'person-000183|EST 9:27',
  'person-000202|NUM 8:11',
  'person-002405|NUM 32:2',
]) {
  const tribal = key.startsWith('person-000110|') || key.startsWith('person-000202|') || key.startsWith('person-002405|');
  CURATED.set(key, tribal
    ? ['tribe', 'curated_final_tribal_reference', '该节以族人／支派行动或人口结构指相应支派，不是同名祖先本人。']
    : ['people_group', 'curated_final_collective_reference', '该节以族人、国民、后裔或共同体称谓指相应群体，不是同名祖先本人。']);
}

for (const key of [
  'person-000045|EZE 27:6',
  'person-000100|GEN 28:9', 'person-000100|GEN 36:21',
  'person-000135|GEN 31:46', 'person-000135|GEN 31:51', 'person-000135|GEN 31:54',
]) {
  CURATED.set(key, ['ambiguous', 'curated_final_context_without_explicit_name', '该节只延续前文人物／群体语境，或相关词形的身份与译法不能唯一指向此人；不算该人物的明确名字提及。']);
}

function readJsonlSet(file) {
  if (!file || !fs.existsSync(file)) return new Set();
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return new Set();
  const rows = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return new Set(
    rows
      .filter((row) => (row?.mention_sense === 'person' || row?.decision === 'person') && row?.mention_id)
      .map((row) => String(row.mention_id))
  );
}

const CURATED_PERSON_SENSE_REVIEW_IDS = readJsonlSet(REVIEWED_PERSON_SEED_PATH);
const MENTION_SNAPSHOT_VERSION = 1;
const EPONYMOUS_LABELS = new Set([
  '以色列', '雅各', '犹大', '流便', '吕便', '西缅', '利未', '以萨迦', '西布伦',
  '便雅悯', '但', '拿弗他利', '迦得', '亚设', '约瑟', '以法莲', '玛拿西',
  '以东', '以扫', '摩押', '亚扪', '亚玛力', '米甸', '迦南'
]);
// Labels in this set may denote either a historical person or a later
// tribe, people, kingdom, territory, descendants, or other collective.
// They must never use the low-risk STEP PERSON shortcut below.
const POLYSEMOUS_PERSON_LABELS = new Set([
  ...EPONYMOUS_LABELS,
  '以实玛利', '玛吉', '赫', '亚衲',
]);
const TRIBAL_EPONYM_LABELS = new Set([
  '犹大', '流便', '吕便', '西缅', '利未', '以萨迦', '西布伦', '便雅悯', '但',
  '拿弗他利', '迦得', '亚设', '约瑟', '以法莲', '玛拿西',
]);
const PEOPLE_EPONYM_LABELS = new Set(['以扫', '以东', '以实玛利', '摩押', '亚扪', '亚玛力', '米甸', '迦南', '玛吉', '赫', '亚衲']);
const EXPLICIT_CONTEXT_TAGS = new Set([
  '支派', '族', '民族', '部族', '国家', '国', '地点', '省', '王国', '后裔', '子孙', '后代', '人群',
  '百姓', '同胞', '百姓', '会众', '军队', '全地', '乡', '城', '家', '地', '山', '河', '海'
]);

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function sha(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function normalize(value) { return String(value || '').normalize('NFKC').replace(/\s+/g, '').trim(); }
function stripFootnoteAndXref(rawVerse) {
  if (!rawVerse) return '';
  let text = rawVerse;
  text = text.replace(/\\f[\s\S]*?\\f\*/g, '');
  text = text.replace(/\\x[\s\S]*?\\x\*/g, '');
  text = text.replace(/\\fr[\s\S]*?\\fr\*/g, '');
  text = text.replace(/\\fk[\s\S]*?\\fk\*/g, '');
  text = text.replace(/\\ft[\s\S]*?\\ft\*/g, '');
  text = text.replace(/\\fv[\s\S]*?\\fv\*/g, '');
  text = text.replace(/\\fqa[\s\S]*?\\fqa\*/g, '');
  text = text.replace(/\\f[\*]/g, '');
  return text;
}
function hasExplicitCollectiveOrPlaceContext(prefix, alias, suffix) {
  if (!prefix && !suffix) return false;
  const around = `${prefix}|${suffix}`;
  return Array.from(EXPLICIT_CONTEXT_TAGS).some((tag) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${tag}(?:[^\\p{L}\\p{N}]|$)`).test(around))
    || /(?:属|属於|属于|之于|中|属下|是|者|于|该|此|其)$/.test(prefix)
    || /^(?:者|之|属|属下|的|中|之下|所|为|便|者|等|诸|后裔|子孙|后代|家|省|省份)/.test(suffix);
}
function hasExplicitUnpnPersonText(rawVerse, aliases) {
  if (!rawVerse) return { match: false };
  const cleaned = stripFootnoteAndXref(rawVerse)
    .replace(/\\\+?pn\*?/g, '')
    .replace(/\\[a-z0-9*+]+/giu, '')
    .replace(/[\s　]+/g, '');
  for (const aliasValue of aliases) {
    const alias = normalize(aliasValue);
    if (!alias || EPONYMOUS_LABELS.has(alias)) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRegex = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u');
    const match = tokenRegex.exec(cleaned);
    if (!match) continue;
    const idx = match.index + match[1].length;
    const prefix = cleaned.slice(Math.max(0, idx - 8), idx);
    const suffix = cleaned.slice(idx + alias.length, idx + alias.length + 8);
    if (hasExplicitCollectiveOrPlaceContext(prefix, alias, suffix)) continue;
    return {
      match: true,
      alias,
      snippet: cleaned.slice(Math.max(0, idx - 12), idx + alias.length + 12),
    };
  }
  return { match: false };
}
function buildMentionSourceProjection(mention) {
  const payload = {
    projection_version: MENTION_SNAPSHOT_VERSION,
    mention_id: mention.mention_id,
    person_id: mention.person_id,
    source_id: mention.source_id,
    passage: mention.passage,
    location: mention.location,
    status: mention.status,
    created_at: mention.created_at,
    updated_at: mention.updated_at,
  };
  if (mention.testament) payload.testament = mention.testament;
  if (mention.notes !== undefined) payload.notes = mention.notes;
  if (mention.editorial_rationale !== undefined) payload.editorial_rationale = mention.editorial_rationale;
  return payload;
}
function readCuvVerses() {
  const verses = new Map();
  for (const file of fs.readdirSync(CUV).filter((name) => name.endsWith('.usfm')).sort()) {
    let book = null;
    let chapter = null;
    let currentPassages = [];
    for (const line of fs.readFileSync(path.join(CUV, file), 'utf8').split(/\r?\n/)) {
      const id = /^\\id\s+([1-3]?[A-Z]{2,4})/.exec(line);
      if (id) {
        book = id[1] === 'EZK' ? 'EZE' : id[1] === 'NAM' ? 'NAH' : id[1];
        currentPassages = [];
      }
      const chapterMatch = /^\\c\s+(\d+)/.exec(line);
      if (chapterMatch) {
        chapter = chapterMatch[1];
        currentPassages = [];
      }
      const verse = /^\\v\s+(\d+(?:-\d+)?)\s*(.*)/.exec(line);
      if (book && chapter && verse) {
        const [start, end = start] = verse[1].split('-').map(Number);
        currentPassages = [];
        for (let number = start; number <= end; number += 1) {
          const passage = `${book} ${chapter}:${number}`;
          currentPassages.push(passage);
          verses.set(passage, verse[2]);
        }
        if (start !== end) verses.set(`${book} ${chapter}:${verse[1]}`, verse[2]);
        continue;
      }
      const continuation = /^\\(?:q\d*|m|p|pi\d*|li\d*)\s+(.+)/.exec(line);
      if (currentPassages.length && continuation) {
        for (const passage of currentPassages) {
          verses.set(passage, `${verses.get(passage) || ''} ${continuation[1]}`.trim());
        }
      }
    }
  }
  return verses;
}

function readOtStrongCodesByPassage(filePaths) {
  const result = new Map();
  for (const filePath of filePaths) {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const ref = /^([1-3]?[A-Za-z]{2,4})\.(\d+)\.(\d+)#/.exec(line);
      if (!ref) continue;
      const rawBook = ref[1].toUpperCase();
      const book = rawBook === 'EZK' ? 'EZE' : rawBook === 'NAM' ? 'NAH' : rawBook;
      const passage = `${book} ${ref[2]}:${ref[3]}`;
      const codes = result.get(passage) || new Set();
      for (const match of line.matchAll(/\b(H\d{4}[A-Z]?)\b/g)) codes.add(match[1]);
      result.set(passage, codes);
    }
  }
  return result;
}

function normalizeHebrew(value) {
  return String(value || '').normalize('NFD').replace(/[\u0591-\u05C7]/g, '').replace(/[^\u05D0-\u05EA]/g, '');
}

function readOtProperNameLemmasByPassage(filePaths) {
  const result = new Map();
  for (const filePath of filePaths) {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!/\bHNp[a-z]*/i.test(line)) continue;
      const ref = /^([1-3]?[A-Za-z]{2,4})\.(\d+)\.(\d+)#/.exec(line);
      if (!ref) continue;
      const rawBook = ref[1].toUpperCase();
      const book = rawBook === 'EZK' ? 'EZE' : rawBook === 'NAM' ? 'NAH' : rawBook;
      const passage = `${book} ${ref[2]}:${ref[3]}`;
      const lemmas = result.get(passage) || new Set();
      for (const match of line.matchAll(/\{H\d{4}[A-Z]?=([^=}]+)=/g)) {
        const lemma = normalizeHebrew(match[1]);
        if (lemma) lemmas.add(lemma);
      }
      result.set(passage, lemmas);
    }
  }
  return result;
}

function ownHebrewStrongCodes(person) {
  const note = String(person.editor_note || '');
  const referred = note.match(/referred to as([\s\S]*?)(?:<br>\s*(?:son|daughter|father|mother|brother|sister|husband|wife|with|a descendant)|$)/i)?.[1] || '';
  return [...new Set([...referred.matchAll(/<strong="(H\d{4}[A-Z]?)">/g)].map((match) => match[1]))];
}
function hasPersonalGrammar(rawVerse, aliases) {
  if (!rawVerse) return false;
  const plain = rawVerse
    .replace(/\\\+?pn\*?/g, '')
    .replace(/\\[a-z0-9*]+/giu, '')
    .replace(/[\s　]+/g, '');
  for (const aliasValue of aliases) {
    const alias = normalize(aliasValue);
    if (!alias || EPONYMOUS_LABELS.has(alias) || !plain.includes(alias)) continue;
    const personalPatterns = [
      new RegExp(`(?:先知|祭司|大祭司|王|将军|省长|士师|使徒|门徒)${alias}`),
      new RegExp(`${alias}(?:说|回答|问|吩咐|打发|起来|去了|来到|生了|死了|作王|登基|娶|嫁|听见|看见)`),
      new RegExp(`${alias}的(?:儿子|女儿|父亲|母亲|兄弟|姊妹|妻子|丈夫)`),
      new RegExp(`(?:儿子|女儿|父亲|母亲|兄弟|姊妹|妻子|丈夫)${alias}`)
    ];
    if (personalPatterns.some((pattern) => pattern.test(plain))) return true;
  }
  return false;
}

function classifyPolysemousContext(rawVerse, aliases) {
  const plain = normalize(String(rawVerse || '').replace(/\\[a-z0-9*+]+/giu, ''));
  for (const alias of aliases.map(normalize).filter(Boolean)) {
    if (!plain.includes(alias)) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:${escaped}.{0,6}支派|支派.{0,6}${escaped})`).test(plain)) {
      return ['tribe', 'polysemous_tribal_context', `和合本该节把“${alias}”置于明确的支派结构中，指支派而非同名先祖本人。`];
    }
    if (new RegExp(`(?:${escaped}(?:家|族|人|民|众人|军兵|长老|会众|百姓|子孙|后裔|后代)|(?:我的民|我民|全|众|诸).{0,3}${escaped})`).test(plain)) {
      return ['people_group', 'polysemous_collective_context', `和合本该节以“${alias}家／族／子孙／后裔”表示集体，不是同名历史人物本人。`];
    }
    if (new RegExp(`(?:${escaped}(?:地|省|山地|城)|(?:地|省|山地|城).{0,4}${escaped})`).test(plain)) {
      return ['place', 'polysemous_place_context', `和合本该节以“${alias}”表示地域或城市，不是同名历史人物本人。`];
    }
    if (new RegExp(`${escaped}(?:国|王国|王)`).test(plain)) {
      return ['nation', 'polysemous_national_context', `和合本该节以“${alias}”表示国家或王国，不是同名历史人物本人。`];
    }
  }
  return null;
}

function classifyJacobIsraelContext(passage, rawVerse) {
  const plain = normalize(String(rawVerse || '').replace(/\\[a-z0-9*+]+/giu, ''));
  const book = String(passage || '').split(' ')[0];
  const hasJacob = plain.includes('雅各');
  const hasIsrael = plain.includes('以色列');
  const hasJeshurun = plain.includes('耶书仑');
  if (!hasJacob && !hasIsrael && !hasJeshurun) return null;

  if (book === 'GEN') {
    return ['person', 'jacob_genesis_person_context', '创世记叙事在排除家族、支派、地域与集体结构后，以雅各／以色列指同一位族长本人。'];
  }

  if (hasJeshurun || (hasJacob && hasIsrael)) {
    return ['people_group', 'jacob_israel_poetic_collective', '该节以“雅各／以色列／耶书仑”的诗体平行称呼指向以色列共同体，不是族长本人在场。'];
  }

  if (hasJacob) {
    if (/(?:亚伯拉罕|以撒).{0,24}雅各|雅各.{0,24}(?:亚伯拉罕|以撒)|雅各的神|雅各.{0,8}(?:儿子|父亲|生|死|葬|骸骨|年日)/.test(plain)) {
      return ['person', 'jacob_historical_person_reference', '该节以族长链、亲属、身体、寿数或“雅各的神”等历史限定语明确指雅各本人。'];
    }
    if (!['PSA', 'ISA', 'JER', 'LAM', 'EZE', 'HOS', 'JOL', 'AMO', 'OBA', 'MIC', 'NAH', 'ZEP', 'ZEC', 'MAL'].includes(book)) {
      return ['person', 'jacob_narrative_person_reference', '叙事／谱系语境在排除家族、支派、国家和地域结构后，以“雅各”指历史人物本人。'];
    }
    return ['people_group', 'jacob_prophetic_collective', '诗歌或先知语境以“雅各”称呼以色列共同体，邻近经文没有族长本人叙事或亲属限定。'];
  }

  return ['people_group', 'israel_collective_after_genesis', '创世记以后，该处在排除族长本人语法后以“以色列”称呼百姓或共同体，不作雅各个人提及。'];
}

function classifyResidualOtEponym(passage, rawVerse, aliases, personLabel, hasDoubleOriginalToken) {
  const plain = normalize(String(rawVerse || '').replace(/\\[a-z0-9*+]+/giu, ''));
  const book = String(passage || '').split(' ')[0];
  const chapter = Number(String(passage || '').match(/\s(\d+):/)?.[1] || 0);
  const presentAliases = aliases.map(normalize).filter((alias) => alias && plain.includes(alias));
  if (!presentAliases.length) return null;

  for (const alias of presentAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:${escaped}.{0,10}(?:生|父亲|母亲|儿子|女儿|兄弟|妻子|丈夫|死|葬|坟墓|骸骨|年日|年岁)|(?:生给|生了|父亲|母亲|儿子|女儿|兄弟|妻子|丈夫).{0,10}${escaped})`).test(plain)) {
      return ['person', 'ot_eponym_explicit_person_grammar', `和合本该节以亲属、生卒、身体或寿数语法明确把“${alias}”作为历史人物，而非后来的同名群体。`];
    }
  }

  if (book === 'GEN') {
    return ['person', 'genesis_eponym_person_context', '创世记叙事在排除支派、国家、地域、后裔和集体结构后，以该名称指历史人物本人。'];
  }

  if (book === '1CH' && chapter >= 1 && chapter <= 9 && hasDoubleOriginalToken) {
    return ['person', 'chronicles_genealogy_person_token', '历代志上1至9章谱系中，TAHOT与TOTHT均有该人物自身名称编码，且邻近语境没有支派、国家或集体结构。'];
  }

  if (TRIBAL_EPONYM_LABELS.has(personLabel)) {
    return ['tribe', 'ot_residual_tribal_eponym', '创世记以后该处缺少族长本人限定语，并以支派祖名指相应支派；不作历史人物本人提及。'];
  }
  if (PEOPLE_EPONYM_LABELS.has(personLabel)) {
    return ['people_group', 'ot_residual_people_eponym', '创世记以后该处缺少祖先本人限定语，并以祖名指后裔民族或群体；不作历史人物本人提及。'];
  }
  return null;
}
function hasUnambiguousNamedPersonToken(rawVerse, aliases) {
  if (!rawVerse) return false;
  const acceptedAliases = new Set(aliases.map(normalize).filter(Boolean));
  const tokenPattern = /\\\+?pn\s+(.+?)\\\+?pn\*/g;
  let match;
  while ((match = tokenPattern.exec(rawVerse))) {
    const token = normalize(match[1]);
    if (!acceptedAliases.has(token) || EPONYMOUS_LABELS.has(token)) continue;
    const before = normalize(rawVerse.slice(Math.max(0, match.index - 32), match.index).replace(/\\[a-z0-9*+]+/giu, ''));
    const after = normalize(rawVerse.slice(tokenPattern.lastIndex, tokenPattern.lastIndex + 32).replace(/\\[a-z0-9*+]+/giu, ''));
    if (/(?:属|支派|国|地|城|山|河|海|省|谷|门|家)$/.test(before)) continue;
    if (/^(?:人|族|支派|国|地|城|山|河|海|省|谷|门|家|王|列王|子孙|后裔|众人|百姓|会众|军队|中|全地|各支派)/.test(after)) continue;
    return true;
  }
  return false;
}
function decision(mode, curated) {
  if (!curated) return { status: 'pending', mention_sense: null, mode, reason_code: 'requires_textual_sense_review', note: '须按该处经文独立判断此名称是人物、群体、支派、国家、地点或歧义用法。', reviewed_at: null };
  return { status: 'accepted', mention_sense: curated[0], mode, reason_code: curated[1], note: curated[2], reviewed_at: STAMP };
}
function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

const mentions = readJsonl(path.join(DATA, 'mentions.jsonl')).sort((a, b) => a.mention_id.localeCompare(b.mention_id));
const people = new Map(readJsonl(path.join(DATA, 'people.jsonl')).map((row) => [row.person_id, row]));
const names = readJsonl(path.join(DATA, 'names.jsonl'));
const zhAliasesByPerson = new Map();
for (const person of people.values()) {
  const canonical = String(person.canonical_chinese || '').trim();
  if (canonical) zhAliasesByPerson.set(person.person_id, [canonical]);
}
for (const name of names) {
  if (name.status !== 'accepted' || name.language !== 'zh-hans') continue;
  const aliases = zhAliasesByPerson.get(name.person_id) || [];
  if (!aliases.includes(name.name_text)) aliases.push(name.name_text);
  zhAliasesByPerson.set(name.person_id, aliases);
}
const cuvVerses = readCuvVerses();
const tahotStrongCodesByPassage = readOtStrongCodesByPassage(TAHOT_PATHS);
const tothtStrongCodesByPassage = readOtStrongCodesByPassage(TOTHT_PATHS);
const tahotProperNameLemmasByPassage = readOtProperNameLemmasByPassage(TAHOT_PATHS);
const tothtProperNameLemmasByPassage = readOtProperNameLemmasByPassage(TOTHT_PATHS);
const sblgntAudit = readJsonl(SBLGNT_NAME_AUDIT_PATH).filter((row) => row.status === 'accepted');
const sblgntMatchesByLatinizedPassage = new Map();
for (const row of sblgntAudit) {
  for (const passage of row.matched_passages || []) {
    const key = `${row.latinized}|${passage}`;
    const matches = sblgntMatchesByLatinizedPassage.get(key) || [];
    matches.push(row.person_key);
    sblgntMatchesByLatinizedPassage.set(key, matches);
  }
}
const assertions = readJsonl(path.join(DATA, 'assertions.jsonl'));
const directAssertionEndpointKeys = new Set();
for (const assertion of assertions) {
  if (assertion.status !== 'active' || assertion.inference) continue;
  for (const evidence of assertion.evidence || []) {
    if (!['ot_text', 'nt_text'].includes(evidence.evidence_level) || !evidence.passage) continue;
    directAssertionEndpointKeys.add(`${assertion.subject_person_id}|${evidence.passage}`);
    directAssertionEndpointKeys.add(`${assertion.object_person_id}|${evidence.passage}`);
  }
}
const rows = mentions.map((mention, index) => {
  const person = people.get(mention.person_id);
  if (!person) throw new Error(`missing person ${mention.person_id} for ${mention.mention_id}`);
  const key = `${mention.person_id}|${mention.passage}`;
  const personalGrammar = mention.status === 'accepted'
    && hasPersonalGrammar(cuvVerses.get(mention.passage), zhAliasesByPerson.get(mention.person_id) || []);
  const unambiguousPersonToken = mention.status === 'accepted'
    && hasUnambiguousNamedPersonToken(cuvVerses.get(mention.passage), zhAliasesByPerson.get(mention.person_id) || []);
  const aliases = zhAliasesByPerson.get(mention.person_id) || [];
  const rawVerse = cuvVerses.get(mention.passage) || '';
  const lowRiskStepPerson = mention.status === 'accepted'
    && person.status === 'accepted'
    && String(mention.location || '').startsWith('STEP Proper Names')
    && !POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
    && aliases.some((alias) => normalize(rawVerse).includes(normalize(alias)));
  const sblgntMatches = sblgntMatchesByLatinizedPassage.get(`${person.latinized}|${mention.passage}`) || [];
  const polysemousContext = POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
    ? classifyPolysemousContext(rawVerse, aliases)
    : null;
  const jacobIsraelContext = person.person_id === 'person-000135'
    ? classifyJacobIsraelContext(mention.passage, rawVerse)
    : null;
  const lowRiskSblgntPerson = mention.status === 'accepted'
    && person.status === 'accepted'
    && !POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
    && sblgntMatches.length === 1;
  const isNewTestamentPassage = /^(?:MAT|MRK|LUK|JHN|ACT|ROM|1CO|2CO|GAL|EPH|PHP|COL|1TH|2TH|1TI|2TI|TIT|PHM|HEB|JAS|1PE|2PE|1JN|2JN|3JN|JUD|REV) /.test(mention.passage);
  const lowRiskNtWithoutExplicitName = mention.status === 'accepted'
    && person.status === 'accepted'
    && isNewTestamentPassage
    && String(mention.location || '').startsWith('STEP Proper Names')
    && !POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
    && !aliases.some((alias) => normalize(rawVerse).includes(normalize(alias)))
    && sblgntMatches.length === 0;
  const ownHebrewCodes = ownHebrewStrongCodes(person);
  const tahotCodes = tahotStrongCodesByPassage.get(mention.passage) || new Set();
  const tothtCodes = tothtStrongCodesByPassage.get(mention.passage) || new Set();
  const lowRiskOtOriginalPerson = mention.status === 'accepted'
    && person.status === 'accepted'
    && !isNewTestamentPassage
    && !POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
    && ownHebrewCodes.some((code) => tahotCodes.has(code) && tothtCodes.has(code));
  const hasDoubleOtOriginalToken = ownHebrewCodes.some((code) => tahotCodes.has(code) && tothtCodes.has(code));
  const canonicalHebrew = normalizeHebrew(person.canonical_hebrew || person.canonical_aramaic);
  const hasDoubleOtProperNameLemma = canonicalHebrew.length >= 3
    && (tahotProperNameLemmasByPassage.get(mention.passage) || new Set()).has(canonicalHebrew)
    && (tothtProperNameLemmasByPassage.get(mention.passage) || new Set()).has(canonicalHebrew);
  const lowRiskOtProperNameLemma = mention.status === 'accepted'
    && person.status === 'accepted'
    && !isNewTestamentPassage
    && !POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
    && hasDoubleOtProperNameLemma;
  const otContextWithoutExplicitName = !isNewTestamentPassage
    && mention.status === 'accepted'
    && person.status === 'accepted'
    && String(mention.location || '').startsWith('STEP')
    && !aliases.some((alias) => normalize(rawVerse).includes(normalize(alias)))
    && !hasDoubleOtOriginalToken
    && !hasDoubleOtProperNameLemma;
  const residualOtEponym = !isNewTestamentPassage && POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
    ? classifyResidualOtEponym(mention.passage, rawVerse, aliases, person.canonical_chinese, hasDoubleOtOriginalToken)
    : null;
    const curated = CURATED.get(key) || (
      CURATED_PERSON_SENSE_REVIEW_IDS.has(mention.mention_id)
        ? ['person', 'curated_explicit_person_sense_review', 'independent textual person-sense review']
      : mention.status === 'accepted'
        && directAssertionEndpointKeys.has(key)
          ? ['person', 'reviewed_direct_assertion_endpoint', '该人物在同一经文定位中是已发布、非推论直接关系的审核端点。']
    : personalGrammar && !POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
            ? ['person', 'cuv_explicit_personal_grammar', '和合本该节以专名标记并使用明确人物语法；未仅凭同节出现或词形相似判定。']
    : unambiguousPersonToken && !POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese)
      ? ['person', 'cuv_unambiguous_person_token', '和合本该节存在与人物名称相符的专名标记，且不处于族属、支派、国家、地点、王国或后裔结构。']
      : polysemousContext
        ? polysemousContext
        : jacobIsraelContext
          ? jacobIsraelContext
        : residualOtEponym
          ? residualOtEponym
        : lowRiskSblgntPerson
          ? ['person', 'sblgnt_exact_person_token_match', '锁定 SBLGNT 在该节含与 STEP 人物身份和拉丁转写唯一对应的希腊文人名词形；该标签不属于人物／族群／地域多义名单。']
          : isNewTestamentPassage && POLYSEMOUS_PERSON_LABELS.has(person.canonical_chinese) && sblgntMatches.length === 1
            ? ['person', 'sblgnt_polysemous_token_without_collective_context', '锁定 SBLGNT 在该节含与 STEP 人物身份和拉丁转写唯一对应的人名词形；和合本邻近语境未出现支派、族群、国家或地域结构，判为历史人物。']
            : lowRiskStepPerson
              ? ['person', 'step_person_identity_and_cuv_name_match', 'STEP Proper Names 将该词项标为 PERSON；人物实体已通过审核，和合本该节含其已接受中文名，且该名称不在人物／族群／地域多义名单中。']
              : lowRiskNtWithoutExplicitName
                ? ['ambiguous', 'nt_context_reference_without_explicit_name', 'STEP 将该节归到此人物，但锁定和合本未出现其已接受中文名，SBLGNT 人名审计也没有该节的对应专名词形；仅保留为上下文指涉，不算明确具名人物提及。']
                : lowRiskOtOriginalPerson
                  ? ['person', 'tahot_totht_exact_person_strong_match', 'TAHOT 与 TOTHT 在同一节都含该人物自身的希伯来文 Strong 编码；人物身份已接受，且名称不属于支派／国家／地域多义标签。']
                  : lowRiskOtProperNameLemma
                    ? ['person', 'tahot_totht_exact_hebrew_name_match', 'TAHOT 与 TOTHT 在同一节都以 HNp 专名标记记录与该人物希伯来文／亚兰文主名完全相符的词元；该名称不属于支派／国家／地域多义标签。']
                    : otContextWithoutExplicitName
                      ? ['ambiguous', 'ot_context_reference_without_explicit_name', 'STEP 将该节归到此人物，但锁定和合本未出现其已接受中文名，TAHOT／TOTHT 也没有该人物自身 Strong 编码或希伯来文／亚兰文主名的双重专名匹配；仅保留上下文指涉，不算明确具名人物提及。']
                      : null
  );
  return {
    review_id: `msr-${String(index + 1).padStart(6, '0')}`,
    mention_id: mention.mention_id,
    person_id: mention.person_id,
    person_label: person.canonical_chinese || person.latinized || mention.person_id,
    passage: mention.passage,
    mention_snapshot_sha256: sha(buildMentionSourceProjection(mention)),
    round_a: decision('editorial', curated),
    round_b: decision('critic', curated),
    final_decision: decision('boardroom', curated)
  };
});
const explicitProposals = [];
for (const [index, row] of rows.entries()) {
  if (row.final_decision.status !== 'pending') continue;
  const mention = mentions[index];
  if (mention.status !== 'accepted') continue;
  const aliases = zhAliasesByPerson.get(mention.person_id) || [];
  const verse = cuvVerses.get(mention.passage);
  if (!verse) continue;
  const match = hasExplicitUnpnPersonText(verse, aliases);
  if (!match.match) continue;
  explicitProposals.push({
    proposal_id: `msp-${String(explicitProposals.length + 1).padStart(6, '0')}`,
    mention_id: mention.mention_id,
    person_id: mention.person_id,
    passage: mention.passage,
    person_alias: match.alias,
    snippet: match.snippet,
    book: mention.passage.split(' ')[0],
    rationale: '该经文中同人名存在明显明示专名语境，但未被\\pn显式标注；提议补足该提及人物识别。',
    created_at: STAMP,
    mention_snapshot_sha256: row.mention_snapshot_sha256
  });
}

const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
for (const row of rows) if (!validate(row)) throw new Error(`${row.review_id}: ${ajv.errorsText(validate.errors)}`);

const ledgerText = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
const senseCounts = Object.fromEntries(['person', 'people_group', 'tribe', 'nation', 'place', 'ambiguous'].map((sense) => [sense, rows.filter((row) => row.final_decision.mention_sense === sense).length]));
const report = {
  generated_at: STAMP,
  dataset: 'mention-sense-review',
  mention_count: mentions.length,
  review_count: rows.length,
  coverage_complete: rows.length === mentions.length,
  accepted_count: rows.filter((row) => row.final_decision.status === 'accepted').length,
  pending_count: rows.filter((row) => row.final_decision.status === 'pending').length,
  final_sense_counts: senseCounts,
  row_snapshot_sha256: crypto.createHash('sha256').update(ledgerText).digest('hex')
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
const explicitLedgerText = `${explicitProposals.map((row) => JSON.stringify(row)).join('\n')}\n`;
const explicitReport = {
  generated_at: STAMP,
  dataset: 'mention-sense-explicit-person-proposals',
  source_dataset: 'mention-sense-review',
  proposal_count: explicitProposals.length,
  mention_status_filter: 'accepted',
  decision_filter: 'final_decision= pending',
  by_book: explicitProposals.reduce((acc, proposal) => {
    acc[proposal.book] = (acc[proposal.book] || 0) + 1;
    return acc;
  }, {}),
  rationale_sample: explicitProposals.slice(0, 20).map((proposal) => ({
    proposal_id: proposal.proposal_id,
    mention_id: proposal.mention_id,
    passage: proposal.passage,
    rationale: proposal.rationale
  }))
};
const explicitReportText = `${JSON.stringify(explicitReport, null, 2)}\n`;

if (CHECK) {
  if (!fs.existsSync(LEDGER) || fs.readFileSync(LEDGER, 'utf8') !== ledgerText) throw new Error('mention sense ledger drift');
  if (!fs.existsSync(REPORT) || fs.readFileSync(REPORT, 'utf8') !== reportText) throw new Error('mention sense report drift');
  if (!fs.existsSync(EXPLICIT_LEDGER) || fs.readFileSync(EXPLICIT_LEDGER, 'utf8') !== explicitLedgerText) throw new Error('explicit proposal ledger drift');
  if (!fs.existsSync(EXPLICIT_REPORT) || fs.readFileSync(EXPLICIT_REPORT, 'utf8') !== explicitReportText) throw new Error('explicit proposal report drift');
  console.log(JSON.stringify({ ...report, mode: 'check' }));
} else {
  atomicWrite(LEDGER, ledgerText);
  atomicWrite(REPORT, reportText);
  atomicWrite(EXPLICIT_LEDGER, explicitLedgerText);
  atomicWrite(EXPLICIT_REPORT, explicitReportText);
  console.log(JSON.stringify({ ...report, mode: 'generate' }));
}
