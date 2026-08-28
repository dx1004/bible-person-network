#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyPersonEra } from './person-era.mjs';

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
  if (lowered.includes('ancient')) return 'ancient';
  if (lowered.includes('modern')) return 'modern';
  if (lowered.includes('ot') || lowered.includes('旧约')) return 'ot_text';
  if (lowered.includes('nt')) return 'nt_text';
  return 'modern';
}

function normalizeLegacyPersonId(personId) {
  const sourceId = normalizeText(personId);
  const legacyMatch = /^nt-people-(\d{4})$/i.exec(sourceId);
  if (legacyMatch) {
    return `person-00${legacyMatch[1]}`;
  }
  return sourceId;
}

function mapDirection(direction = '') {
  if (direction === 'undirected' || direction === 'incoming' || direction === 'bidirectional') return direction;
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
  if (type === 'teacher_student') return '师徒';
  if (type === 'mentor') return '师徒';
  if (type === 'discipleship') return '师徒';
  if (type === 'collegial') return '长期同工';
  if (type === 'collaboration') return '长期同工';
  if (type === 'commission') return '差派';
  if (type === 'host') return '接待';
  if (type === 'hospitality') return '接待';
  if (type === 'political') return '政治权属';
  if (type === 'authority') return '政治权属';
  if (type === 'legal') return '司法行为';
  if (type === 'judicial') return '司法行为';
  if (type === 'hostile') return '明确敌对';
  if (type === 'hostility') return '明确敌对';
  if (type === 'adversarial') return '明确敌对';
  if (type === 'succession') return '王位或职分继承';
  if (type === 'alliance') return '政治/军事同盟';
  if (type === 'military') return '军事指挥或明确交战';
  if (type === 'prophetic_confrontation') return '先知警告、责备或膏立';
  if (type === 'covenant') return '盟约';
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

function withCandidateVariants(types) {
  return unique(types.flatMap((type) => [type, type.startsWith('候选') ? type : `候选${type}`]));
}

function testamentOfBook(book = '') {
  const upper = String(book).replace(/\s+/g, '').toUpperCase();
  if (!upper) return 'nt';
  if (['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'COL', 'PHP', 'THA', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'].includes(upper)) return 'nt';
  return 'ot';
}

function buildPersonTestaments(books = []) {
  const testimonies = new Set(books.map((book) => testamentOfBook(book)));
  return [...testimonies];
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

function hasBlockingEditorialState(value) {
  const status = String(value || '').toLowerCase();
  return ['pending', 'review', 'draft', 'incomplete', 'provisional'].includes(status);
}

function inferEditorialReviewRequiredFromInputs({ people = [], names = [], mentions = [], assertions = [], identityOptions = [] }) {
  const pendingPeople = people.some((person) => hasBlockingEditorialState(person?.status) && person?.status !== 'accepted');
  const pendingNames = names.some((name) => name?.status && name.status !== 'accepted' && name.status !== 'excluded');
  const pendingMentions = mentions.some((mention) => mention?.status && mention.status !== 'accepted' && mention.status !== 'excluded');
  const pendingAssertions = assertions.some(
    (assertion) => hasBlockingEditorialState(assertion?.status) || assertion?.editorial_status === 'pending' || assertion?.editorial_status === 'review'
  );
  const disputedIdentity = identityOptions.some((opt) => opt?.status === 'disputed');

  return pendingPeople || pendingNames || pendingMentions || pendingAssertions || disputedIdentity;
}

function resolveEditorialReviewRequired(report, canonicalInputs) {
  return coerceEditorialReviewRequired(report) || inferEditorialReviewRequiredFromInputs(canonicalInputs);
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
  if (status.includes('disputed')) return '传统辨识（有争议）';
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
      if (item?.status !== 'accepted') continue;
      if (!item?.person_id) continue;
      const list = namesByPerson.get(item.person_id) ?? [];
      list.push(item);
      namesByPerson.set(item.person_id, list);
    }

    const mentionsByPerson = new Map();
    for (const item of mentions) {
      if (item?.status !== 'accepted') continue;
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
    const acceptedNames = names.filter((item) => item?.status === 'accepted');
    const acceptedMentions = mentions.filter((item) => item?.status === 'accepted');
    const nonAcceptedNames = names.filter((item) => item?.status !== 'accepted').length;
    const nonAcceptedMentions = mentions.filter((item) => item?.status !== 'accepted').length;
    if (nonAcceptedNames || nonAcceptedMentions) {
      console.warn(`[build:data] 跳过未接受条目: 名称 ${nonAcceptedNames}, 提及 ${nonAcceptedMentions}`);
    }
    const reportIdentityCount = Number(report?.counts?.identityOptions ?? identityOptionsInput.length);

    const personIdMap = new Map();
  people.forEach((person, index) => {
    const rawPersonId = String(person.person_id || '').trim();
    const normalizedPersonId = normalizeLegacyPersonId(rawPersonId);
    if (/^person-\d{6}$/.test(normalizedPersonId)) {
      personIdMap.set(rawPersonId, normalizedPersonId);
      personIdMap.set(normalizedPersonId, normalizedPersonId);
      for (const legacyId of Array.isArray(person.legacy_ids) ? person.legacy_ids : []) {
        const normalizedLegacy = String(legacyId || '').trim();
        if (/^nt-people-\d{4}$/i.test(normalizedLegacy)) {
          personIdMap.set(normalizedLegacy, normalizedPersonId);
        }
      }
      } else {
        const fallbackId = /^nt-people-(\d{4})$/i.test(rawPersonId)
          ? normalizedPersonId
          : `person-${String(index + 1).padStart(6, '0')}`;
        personIdMap.set(rawPersonId, fallbackId);
      }
    });
    const mapPersonId = (personId) => {
      const trimmed = String(personId || '').trim();
      if (!trimmed) return '';
      const normalized = normalizeLegacyPersonId(trimmed);
      if (/^person-\d{6}$/.test(normalized)) {
        return normalized;
      }
      return personIdMap.get(trimmed) || normalized;
    };

    const mapRelationPeople = (value) => mapPersonId(String(value || '').trim());

    const mapTopicPersonIds = (ids = []) => ids.map((id) => mapPersonId(id)).filter(Boolean);

    const graphPeople = people.map((person, personIndex) => {
        const personNames = acceptedNames.filter((n) => n.person_id === person.person_id);
      const personMentions = acceptedMentions.filter((item) => item.person_id === person.person_id);
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
      const personEra = classifyPersonEra(person, books);
      const sourcePersonId = String(person.person_id || '').trim();
      const canonicalPersonId = mapPersonId(sourcePersonId);

      const notes = unique([
        person.review_status?.chinese_label_note,
        usedFallback ? '中文名待审校：未命中和合本映射，当前为清洗回退名' : '',
        person.review_status?.chinese_label_status
          ? `中文名审核：${person.review_status.chinese_label_status === 'accepted' ? '已接受' : person.review_status.chinese_label_status}`
          : ''
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
              preset: identityPreset,
              mergeGroupId: raw?.merge_group_id || null,
              mergeTargetPersonId: raw?.merge_target_person_id ? mapRelationPeople(raw.merge_target_person_id) : null,
              displayLabel: raw?.display_label || null
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

      const mentionsClean = unique(
          personMentions.map((item) =>
            JSON.stringify({
              passage: passageClean(item.passage || ''),
              location: normalizeText(item.location || ''),
              sourceId: normalizeText(item.source_id || '')
            })
          )
        ).map((item) => JSON.parse(item));
      const testimonies = buildPersonTestaments(unique(mentionsClean.map((m) => passageToBook(m.passage || ''))));

      return {
        id: canonicalPersonId,
        legacyIds: unique([
          ...(Array.isArray(person.legacy_ids) ? person.legacy_ids : []),
          ...(/^nt-people-\d{4}$/i.test(sourcePersonId) ? [sourcePersonId] : [])
        ].filter((id) => /^nt-people-\d{4}$/i.test(String(id || '').trim()))),
        nameZh,
        nameLat: latinFallback || greekFallback || nameZh,
        aliases,
        era: personEra,
        books: books.length ? books : ['新约背景'],
        mentions: mentionsClean,
        testaments: testimonies,
        testamentCounts: {
          nt: testimonies.includes('nt') ? mentionsClean.filter((m) => testamentOfBook(passageToBook(m.passage)).includes('nt')).length : 0,
          ot: testimonies.includes('ot') ? mentionsClean.filter((m) => testamentOfBook(passageToBook(m.passage)).includes('ot')).length : 0
        },
        identityOptions,
        selectedPresetDefault: 'conservative',
        notes: notes.length
          ? `${notes.map((note) => String(note).replace(/[。；]+$/g, '')).join('；')}。`
          : undefined
      };
    });

    const evidenceKindsBySource = new Map();
    for (const assertion of assertions) {
      for (const evidence of assertion.evidence || []) {
        const sourceId = evidence.source_id;
        if (!sourceId) continue;
        const kinds = evidenceKindsBySource.get(sourceId) ?? new Set();
        kinds.add(mapEvidenceLevel(evidence.evidence_level));
        evidenceKindsBySource.set(sourceId, kinds);
      }
    }
    const preferredSourceKind = (sourceId) => {
      const kinds = evidenceKindsBySource.get(sourceId) ?? new Set();
      if (kinds.has('ancient')) return 'ancient';
      if (kinds.has('ot_text')) return 'ot_text';
      if (kinds.has('nt_text')) return 'nt_text';
      return 'modern';
    };

    const graphSources = unique(sources.map((source) => `${source.source_id}|${source.short_name}|${source.url || ''}`))
      .map((entry) => {
        const [id, shortName, url] = entry.split('|');
        const source = sources.find((s) => s.source_id === id);
        return {
          id,
          label: source?.short_name || shortName || '来源',
          kind: preferredSourceKind(id),
          url: source?.url || (url ? url : undefined)
        };
      });

    const publishedAssertions = assertions.filter((rel) => rel.status === 'active' && rel.editorial_status !== 'pending');
    const relationships = publishedAssertions.map((rel) => {
      const evidenceEntries = Array.isArray(rel.evidence) ? rel.evidence : [];
      const passages = unique(evidenceEntries.map((e) => passageClean(e.passage || '')));
      const books = unique(passages.map((passage) => passageToBook(passage)).filter(Boolean));
      const relationTestaments = buildPersonTestaments(books);
      const sourceIds = unique(evidenceEntries.map((e) => e.source_id || '').filter(Boolean));
      const book = books[0] || '新约';
      const rawEvidenceLevels = unique(evidenceEntries.map((e) => String(e.evidence_level || '').trim()).filter(Boolean));
      const evidenceLevels = unique(rawEvidenceLevels.map((evidenceLevel) => mapEvidenceLevel(evidenceLevel)).filter(Boolean));
      const evidenceRank = { ot_text: 4, nt_text: 3, ancient: 2, modern: 1 };
      const preferredEvidenceLevel = [...evidenceLevels]
        .sort((a, b) => (evidenceRank[b] || 0) - (evidenceRank[a] || 0))[0] || 'modern';

      const relationType = mapRelationTypeLabel(rel.relation_type, rel.relation_subtype, rel.editorial_status);
      const isPendingCandidate =
        rel.status !== 'active' || rel.editorial_status === 'pending';

      const type = isPendingCandidate ? `候选${relationType}` : relationType;
      const evidenceLevel = preferredEvidenceLevel;
      const certainty = confidenceToLevel(
        Number.isFinite(Number(rel.confidence)) ? rel.confidence : Number(evidenceEntries?.[0]?.certainty)
      );

      const descBits = [];
      if (isPendingCandidate) descBits.push(`候选关系：${rel.editorial_status || 'pending'}；状态：${rel.status || 'inactive'}`);
      if (rel.editor_note) descBits.push(rel.editor_note);
      if (rel.direction) descBits.push(`方向标记：${rel.direction}`);

      return {
        id: rel.assertion_id,
        fromPerson: mapRelationPeople(rel.subject_person_id),
        toPerson: mapRelationPeople(rel.object_person_id),
        rawRelationType: getRawRelationType(rel.relation_type, rel.relation_subtype),
        rawRelationSubType: String(rel.relation_subtype || '').trim() || undefined,
        type,
        direction: mapDirection(rel.direction),
        description: `${descBits.length ? `${descBits.join('；')}；` : ''}${passages.length ? `出处：${passages.join('；')}` : ''}`.replace(/；$/, ''),
        certainty,
        rawEvidenceLevel: rawEvidenceLevels[0] || undefined,
        evidenceLevel,
        evidenceLevels,
        sources: sourceIds,
        passages,
        book,
        books,
        testaments: relationTestaments,
        era: bookEraMap[passageToBook(book).toUpperCase()] || '待审校',
        identityGuards: []
      };
    });

    const paulPersonId = graphPeople.find((person) => person.nameZh === '保罗')?.id || 'person-000000';
    const paulTeamPersonIds = unique(
      relationships
        .filter((relationship) =>
          relationship.type === '长期同工' &&
          (relationship.fromPerson === paulPersonId || relationship.toPerson === paulPersonId)
        )
        .flatMap((relationship) => [relationship.fromPerson, relationship.toPerson])
    );

    const topicPresets = [
      { id: 'all', name: '全部', relationTypes: [], bookIncludes: [], eraIncludes: [], evidenceIncludes: [] },
      {
        id: 'herodFamily',
        name: '希律家族',
        relationTypes: [],
        bookIncludes: [],
        eraIncludes: [],
        evidenceIncludes: ['nt_text', 'ot_text', 'ancient', 'modern'],
        personIncludes: [
          ...mapTopicPersonIds(['nt-people-0014', 'nt-people-0037', 'nt-people-0059', 'nt-people-0082', 'nt-people-0124', 'nt-people-0125', 'nt-people-0126', 'nt-people-0127', 'nt-people-0275', 'nt-people-0277'])
        ]
      },
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
        bookIncludes: [],
        eraIncludes: [],
        evidenceIncludes: ['nt_text', 'ot_text', 'ancient', 'modern']
      },
      {
        id: 'discipleship',
        name: '门徒关系',
        relationTypes: withCandidateVariants(['师徒']),
        bookIncludes: [],
        eraIncludes: [],
    evidenceIncludes: ['nt_text', 'ot_text', 'ancient', 'modern']
      },
      {
        id: 'paulTeam',
        name: '保罗同工',
        relationTypes: withCandidateVariants(['长期同工']),
        bookIncludes: [],
        eraIncludes: [],
        evidenceIncludes: ['nt_text', 'ot_text', 'ancient', 'modern'],
        personIncludes: paulTeamPersonIds
      },
      {
        id: 'acts',
        name: '使徒行传专题',
        relationTypes: withCandidateVariants([
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
        ]),
        bookIncludes: ['ACT'],
        eraIncludes: [],
        evidenceIncludes: ['nt_text', 'ot_text', 'ancient', 'modern']
      }
    ];

    const version = report?.version
      ? `${report.version.major ?? 0}.${report.version.minor ?? 1}.${report.version.patch ?? 0}`
      : new Date().toISOString();

    const generatedAt = report?.generatedAt || new Date().toISOString();

    const graph = {
      migration: {
        sourceIdFormat: '^(person-\\d{6}|nt-people-\\d{4})$',
        outputIdFormat: '^person-\\d{6}$',
        preservedLegacyIds: true
      },
      legacyIdMap: Object.fromEntries(
        [...personIdMap.entries()]
          .filter(([legacyId]) => !/^person-\d{6}$/.test(String(legacyId).trim()))
          .map(([legacyId, modernId]) => [legacyId, modernId])
      ),
      meta: {
        version,
        generatedAt,
        edition: `pipeline-${report?.generatedAt ? `run-${generatedAt.slice(0, 10)}` : 'live'}`,
        status: report?.status ?? null,
        summary: report?.summary ?? null,
        editorialReviewRequired: resolveEditorialReviewRequired(report, { people, names, mentions, assertions, identityOptions: identityOptionsInput }),
        notes: `counts people=${people.length} (report ${reportPeopleCount}), names=${names.length} (report ${reportNamesCount}), mentions=${mentions.length} (report ${reportMentionsCount}), assertions=${assertions.length} (report ${reportAssertionsCount}), identityOptions=${identityOptionsInput.length} (report ${reportIdentityCount})`
      },
      people: graphPeople,
      relationships,
      sources: graphSources,
      topicPresets
    };

    const expectedPeople = reportPeopleCount;
    const expectedRelationships = Number(report?.counts?.publishedRelationships ?? publishedAssertions.length);
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
