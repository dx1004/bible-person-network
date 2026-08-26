#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(process.cwd(), '..');
const exportsDir = path.join(rootDir, 'exports');

const inputFiles = {
  people: 'people.json',
  names: 'names.json',
  mentions: 'mentions.json',
  assertions: 'assertions.json',
  sources: 'sources.json',
  identityOptions: 'identity-options.json',
  report: 'report.json'
};

function fail(message, error) {
  console.error(`[build:data] ${message}`);
  if (error) {
    console.error(error?.stack || error);
  }
  process.exitCode = 1;
}

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripNameDecorators(text) {
  return normalizeText(text)
    .replace(/@[^\s]*/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function mapEvidenceLevel(level = '') {
  const lowered = String(level).toLowerCase();
  if (lowered.includes('nt')) return 'nt_text';
  if (lowered.includes('ancient')) return 'ancient';
  if (lowered.includes('modern')) return 'modern';
  return 'modern';
}

function mapDirection(direction = '') {
  if (direction === 'undirected') return 'undirected';
  return 'outgoing';
}

function mapRelationTypeLabel(rawType, rawSubType, editorStatus) {
  const type = String(rawType || '').toLowerCase();
  const subType = String(rawSubType || '').toLowerCase();
  if (type === 'kinship') {
    if (subType === 'parent') return '亲属关系-父母/祖先';
    if (subType === 'child') return '亲属关系-子女/后代';
    if (subType === 'sibling') return '亲属关系-手足';
    if (subType === 'partner') return '亲属关系-婚姻/伴侣';
    return '亲属关系-其他';
  }
  if (type === 'mentor') return '师徒';
  if (type === 'discipleship') return '师徒';
  if (type === 'collaboration') return '长期同工';
  if (type === 'commission') return '差派';
  if (type === 'hospitality') return '接待';
  if (type === 'authority') return '政治权属';
  if (type === 'judicial') return '司法行为';
  if (type === 'hostility') return '明确敌对';
  if (type === 'adversarial') return '明确敌对';
  if (editorStatus === 'pending' || editorStatus === 'review') return '候选关系';
  if (type === 'candidate') return '候选关系';
  return type ? `关系-${type}` : '候选关系';
}

function getRawRelationType(rawType, rawSubType) {
  const type = String(rawType || '').toLowerCase();
  const subType = String(rawSubType || '').toLowerCase();
  if (type === 'kinship') {
    if (subType) return `${type}:${subType}`;
    return type;
  }
  return type || 'relation';
}

function confidenceToLevel(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 'medium';
  if (v >= 0.85) return 'high';
  if (v >= 0.65) return 'medium';
  return 'low';
}

function coerceEditorialReviewRequired(report) {
  const status = report?.status;
  if (typeof status === 'boolean') return status;
  if (status && typeof status === 'object') {
    const direct =
      status.editorial_review_required ??
      status.editorialReviewRequired ??
      status.review_required ??
      status.draft ??
      status.pending;
    if (typeof direct === 'boolean') return direct;
    if (typeof direct === 'string') return direct.toLowerCase() === 'true';
  }
  if (typeof report?.editorial_review_required === 'boolean') return report.editorial_review_required;
  const summary = report?.summary;
  if (summary && typeof summary === 'object') {
    const summaryFlag = summary.editorial_review_required ?? summary.editorialReviewRequired ?? summary.review_required;
    if (typeof summaryFlag === 'boolean') return summaryFlag;
    if (typeof summaryFlag === 'string') return summaryFlag.toLowerCase() === 'true';
  }
  const rawStatus = String(status || '').toLowerCase();
  return (
    rawStatus.includes('review') ||
    rawStatus.includes('pending') ||
    rawStatus.includes('draft') ||
    rawStatus.includes('candidate') ||
    rawStatus.includes('incomplete')
  );
}

function passageToBook(passage = '') {
  const normalized = normalizeText(passage).replace(/^STEP:/i, '');
  const match = normalized.match(/^([A-Za-z0-9]+)\b/);
  return match ? match[1] : '新约';
}

function passageClean(passage = '') {
  return normalizeText(passage).replace(/^STEP:/i, '');
}

const bookEraMap = {
  LUK: '使徒时代',
  ACT: '使徒时代',
  MAT: '使徒时代',
  MRK: '使徒时代',
  JHN: '使徒时代',
  ROM: '使徒时代',
  '1CO': '使徒时代',
  '2CO': '使徒时代',
  GAL: '使徒时代',
  EPH: '使徒时代',
  COL: '使徒时代',
  PHP: '使徒时代',
  THA: '使徒时代',
  '1TH': '使徒时代',
  '2TH': '使徒时代',
  '1TI': '使徒时代',
  '2TI': '使徒时代',
  TIT: '使徒时代',
  PHM: '使徒时代',
  HEB: '使徒时代',
  JAS: '使徒时代',
  '1PE': '使徒时代',
  '2PE': '使徒时代',
  '1JN': '使徒时代',
  '2JN': '使徒时代',
  '3JN': '使徒时代',
  JUD: '使徒时代',
  REV: '使徒时代',
  GEN: '旧约背景',
  EXO: '旧约背景',
  LEV: '旧约背景',
  NUM: '旧约背景',
  DEU: '旧约背景',
  JOS: '旧约背景',
  JUDG: '旧约背景',
  JDA: '旧约背景',
  RUT: '旧约背景',
  RUTH: '旧约背景',
  '1SA': '旧约背景',
  '2SA': '旧约背景',
  '1KI': '旧约背景',
  '2KI': '旧约背景'
};

function parseErasFromBooks(books) {
  if (!Array.isArray(books) || books.length === 0) return ['待审校'];
  const eras = new Set();
  for (const b of books) {
    const upper = String(b).replace(/\s+/g, '').toUpperCase();
    eras.add(bookEraMap[upper] || '待审校');
  }
  return [...eras];
}

function statusToChineseIdentity(raw = '') {
  const status = String(raw).toLowerCase();
  if (status.includes('traditional') || status.includes('merge')) return '传统同一';
  if (status.includes('pending')) return '待判';
  if (status.includes('conservative')) return '保守';
  if (status.includes('independent')) return '独立';
  return '独立';
}

async function loadJSON(fileName, fallback = []) {
  try {
    const filePath = path.join(exportsDir, fileName);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

(async () => {
  try {
    const people = await loadJSON(inputFiles.people, []);
    const names = await loadJSON(inputFiles.names, []);
    const mentions = await loadJSON(inputFiles.mentions, []);
    const assertions = await loadJSON(inputFiles.assertions, []);
    const sources = await loadJSON(inputFiles.sources, []);
    const identityOptionsInput = await loadJSON(inputFiles.identityOptions, []);
    const report = await loadJSON(inputFiles.report, null);

    const namesByPerson = new Map();
    for (const item of names) {
      if (!item?.person_id) continue;
      const list = namesByPerson.get(item.person_id) ?? [];
      list.push(item);
      namesByPerson.set(item.person_id, list);
    }

    const mentionsByPerson = new Map();
    for (const item of mentions) {
      if (!item?.person_id) continue;
      const list = mentionsByPerson.get(item.person_id) ?? [];
      list.push(item);
      mentionsByPerson.set(item.person_id, list);
    }

    const identityByPerson = new Map();
    for (const item of identityOptionsInput) {
      if (!item?.person_id) continue;
      const list = identityByPerson.get(item.person_id) ?? [];
      list.push(item);
      identityByPerson.set(item.person_id, list);
    }

    const reportPeopleCount = Number(report?.counts?.people ?? people.length);
    const reportNamesCount = Number(report?.counts?.names ?? names.length);
    const reportMentionsCount = Number(report?.counts?.mentions ?? mentions.length);
    const reportAssertionsCount = Number(report?.counts?.assertions ?? assertions.length);
    const reportIdentityCount = Number(report?.counts?.identityOptions ?? identityOptionsInput.length);

    const graphPeople = people.map((person) => {
      const personNames = namesByPerson.get(person.person_id) ?? [];
      const personMentions = mentionsByPerson.get(person.person_id) ?? [];
      const personIdentityOptions = identityByPerson.get(person.person_id) ?? [];

      const chinesePrimary = normalizeText(person.canonical_chinese || '');
      let usedFallback = false;
      const latinFallback = normalizeText(person.latinized || '');
      const greekFallback = normalizeText(person.canonical_greek || '');
      let nameZh = chinesePrimary;
      if (!nameZh) {
        const acceptedName = personNames
          .map((item) => stripNameDecorators(item.name_text))
          .find((n) => n && /[A-Za-z]/.test(n));
        nameZh = acceptedName || latinFallback || greekFallback || stripNameDecorators(person.person_id);
        usedFallback = true;
      }

      const allNames = personNames
        .map((item) => stripNameDecorators(item.name_text))
        .map(normalizeText)
        .filter(Boolean);

      const aliases = unique(allNames.filter((name) => name !== nameZh)).slice(0, 40);
      const books = unique(personMentions.map((item) => passageToBook(item.passage || '')).filter(Boolean));
      const eras = parseErasFromBooks(books);

      const notes = unique([
        person.review_status?.chinese_label_note,
        usedFallback ? '中文名待审校：未命中和合本映射，当前为清洗回退名' : '',
        person.review_status?.chinese_label_status ? `中文名审核：${person.review_status.chinese_label_status}` : ''
      ]).filter(Boolean);

      const identityOptions = personIdentityOptions.length
        ? unique(personIdentityOptions.map((opt) => opt.option_id)).map((optionId) => {
            const raw = personIdentityOptions.find((opt) => opt.option_id === optionId);
            const identityStatus = normalizeText(raw?.status);
            const identityScope = normalizeText(raw?.identity_scope || 'default');
            const identityPreset = normalizeText(raw?.identity_preset || '');
            return {
              id: raw?.option_id || `${person.person_id}-opt-${optionId}`,
              label: stripNameDecorators(raw?.identity_key || nameZh),
              status: statusToChineseIdentity(identityStatus),
              statusRaw: identityStatus,
              scope: identityScope,
              preset: identityPreset
            };
          })
        : [
            {
              id: `${person.person_id}-main`,
              label: nameZh,
              status: '独立',
              statusRaw: 'independent',
              scope: 'default'
            }
          ];

      return {
        id: person.person_id,
        nameZh,
        nameLat: latinFallback || greekFallback || nameZh,
        aliases,
        era: eras[0] || '待审校',
        books: books.length ? books : ['新约背景'],
        identityOptions,
        selectedPresetDefault: 'conservative',
        notes: notes.length ? notes.join('；') : undefined
      };
    });

    const graphSources = unique(sources.map((source) => `${source.source_id}|${source.short_name}|${source.url || ''}`))
      .map((entry) => {
        const [id, shortName, url] = entry.split('|');
        const source = sources.find((s) => s.source_id === id);
        return {
          id,
          label: source?.short_name || shortName || '来源',
          kind: mapEvidenceLevel(source?.scope || source?.license || ''),
          url: source?.url || (url ? url : undefined)
        };
      });

    const relationships = assertions.map((rel) => {
      const evidenceEntries = Array.isArray(rel.evidence) ? rel.evidence : [];
      const passages = unique(evidenceEntries.map((e) => passageClean(e.passage || '')));
      const sourceIds = unique(evidenceEntries.map((e) => e.source_id || '').filter(Boolean));
      const book = passages.length ? passageToBook(passages[0]) : '新约';
      const rawEvidenceLevels = unique(evidenceEntries.map((e) => String(e.evidence_level || '').trim()).filter(Boolean));

      const relationType = mapRelationTypeLabel(rel.relation_type, rel.relation_subtype, rel.editorial_status);
      const isPendingCandidate =
        rel.status !== 'active' || rel.editorial_status === 'pending' || rel.relation_type === 'kinship';

      const type = isPendingCandidate ? `候选${relationType}` : relationType;
      const evidenceLevel = unique(evidenceEntries.map((e) => mapEvidenceLevel(e.evidence_level)))[0] || 'modern';
      const certainty = confidenceToLevel(
        Number.isFinite(Number(rel.confidence)) ? rel.confidence : Number(evidenceEntries?.[0]?.certainty)
      );

      const descBits = [];
      if (isPendingCandidate) descBits.push(`候选关系：${rel.editorial_status || 'pending'}；状态：${rel.status || 'inactive'}`);
      if (rel.editor_note) descBits.push(rel.editor_note);
      if (rel.direction) descBits.push(`方向标记：${rel.direction}`);

      return {
        id: rel.assertion_id,
        fromPerson: rel.subject_person_id,
        toPerson: rel.object_person_id,
        rawRelationType: getRawRelationType(rel.relation_type, rel.relation_subtype),
        rawRelationSubType: String(rel.relation_subtype || '').trim() || undefined,
        type,
        direction: mapDirection(rel.direction),
        description: `${descBits.length ? `${descBits.join('；')}；` : ''}${passages.length ? `出处：${passages.join('；')}` : ''}`.replace(/；$/, ''),
        certainty,
        rawEvidenceLevel: rawEvidenceLevels[0] || undefined,
        evidenceLevel,
        sources: sourceIds,
        passages,
        book,
        era: bookEraMap[passageToBook(book).toUpperCase()] || '待审校',
        identityGuards: []
      };
    });

    const topicPresets = [
      { id: 'all', name: '全部', relationTypes: [], bookIncludes: [], eraIncludes: [], evidenceIncludes: [] },
      {
        id: 'family',
        name: '家谱/亲属',
        relationTypes: [
          '亲属关系-父母/祖先',
          '亲属关系-子女/后代',
          '亲属关系-手足',
          '亲属关系-婚姻/伴侣',
          '亲属关系-其他',
          '候选亲属关系-父母/祖先',
          '候选亲属关系-子女/后代',
          '候选亲属关系-手足',
          '候选亲属关系-婚姻/伴侣',
          '候选亲属关系-其他'
        ],
        bookIncludes: ['GEN', 'EXO', 'LUK', 'MAT', 'MRK', 'JHN', 'ACT'],
        eraIncludes: ['使徒时代', '旧约背景', '待审校'],
        evidenceIncludes: ['modern']
      },
      {
        id: 'discipleship',
        name: '门徒关系',
        relationTypes: ['师徒', '长期同工'],
        bookIncludes: ['MAT', 'MRK', 'LUK', 'ACT', 'JHN'],
        eraIncludes: ['使徒时代'],
        evidenceIncludes: ['nt_text', 'ancient', 'modern']
      },
      {
        id: 'paulTeam',
        name: '保罗同工',
        relationTypes: ['长期同工'],
        bookIncludes: ['ROM', '1CO', '2CO', 'GAL', 'EPH', 'COL', 'PHP', 'THA', '1TI', '2TI'],
        eraIncludes: ['使徒时代'],
        evidenceIncludes: ['nt_text', 'ancient', 'modern']
      },
      {
        id: 'acts',
        name: '使徒行传专题',
        relationTypes: [
          '长期同工',
          '师徒',
          '差派',
          '接待',
          '司法行为',
          '候选亲属关系-父母/祖先',
          '候选亲属关系-子女/后代',
          '候选亲属关系-手足',
          '候选亲属关系-婚姻/伴侣',
          '候选亲属关系-其他'
        ],
        bookIncludes: ['ACT'],
        eraIncludes: ['使徒时代'],
        evidenceIncludes: ['nt_text', 'ancient', 'modern']
      }
    ];

    const version = report?.version
      ? `${report.version.major ?? 0}.${report.version.minor ?? 1}.${report.version.patch ?? 0}`
      : new Date().toISOString();

    const generatedAt = report?.generatedAt || new Date().toISOString();

    const graph = {
      meta: {
        version,
        generatedAt,
        edition: `pipeline-${report?.generatedAt ? `run-${generatedAt.slice(0, 10)}` : 'live'}`,
        status: report?.status ?? null,
        summary: report?.summary ?? null,
        editorialReviewRequired: coerceEditorialReviewRequired(report),
        notes: `counts people=${people.length} (report ${reportPeopleCount}), names=${names.length} (report ${reportNamesCount}), mentions=${mentions.length} (report ${reportMentionsCount}), assertions=${assertions.length} (report ${reportAssertionsCount}), identityOptions=${identityOptionsInput.length} (report ${reportIdentityCount})`
      },
      people: graphPeople,
      relationships,
      sources: graphSources,
      topicPresets
    };

    const expectedPeople = reportPeopleCount;
    const expectedRelationships = reportAssertionsCount;
    const peopleCount = graph.people.length;

    if (!Number.isFinite(expectedPeople) || expectedPeople <= 0) {
      fail('缺少有效的人物计数基线');
    }
    if (!Number.isFinite(expectedRelationships) || expectedRelationships <= 0) {
      fail('缺少有效的关系计数基线');
    }
    if (peopleCount !== expectedPeople) fail(`人物计数不一致：${peopleCount} != ${expectedPeople}`);
    if (relationships.length !== expectedRelationships)
      fail(`关系计数不一致：${relationships.length} != ${expectedRelationships}`);

    const outDir = path.join(process.cwd(), 'public', 'data');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'graph.json');
    await fs.writeFile(outPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

    console.log(`[build:data] generated ${outPath}`);
    console.log(
      `[build:data] records: people=${graph.people.length}, relationships=${relationships.length}, sources=${graphSources.length}, assertions=${assertions.length}`
    );
  } catch (error) {
    fail('构建图谱数据失败', error);
    process.exitCode = 1;
  }
})();
