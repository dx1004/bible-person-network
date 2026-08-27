#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function normalize(v = '') {
  return String(v).toLowerCase().trim();
}

function statusText(option) {
  return normalize(option?.statusRaw || '');
}

function scopeText(option) {
  return normalize(option?.scope || '');
}

function presetText(option) {
  return normalize(option?.preset || '');
}

function isTraditionalOption(option) {
  const status = statusText(option);
  const scope = scopeText(option);
  const preset = presetText(option);
  return (
    preset === 'traditional' ||
    status === 'traditional' ||
    status === 'disputed' ||
    scope === 'common_tradition' ||
    scope === 'common-tradition'
  );
}

function isConservativeOption(option) {
  const status = statusText(option);
  const scope = scopeText(option);
  const preset = presetText(option);
  return (
    preset === 'conservative' ||
    status === 'independent' ||
    status === 'conservative' ||
    status === 'confirmed' ||
    scope === 'default' ||
    scope === 'conservative'
  );
}

function isMergeTraditionalOption(option) {
  return Boolean(
    option?.mergeGroupId &&
      option.mergeTargetPersonId &&
      (scopeText(option) === 'common_tradition' || scopeText(option) === 'common-tradition' || statusText(option) === 'disputed')
  );
}

function pickPresetIdentity(person, preset) {
  if (!person.identityOptions?.length) return undefined;
  const explicit = person.identityOptions.find((option) => presetText(option) === preset);
  if (explicit) return explicit.id;
  if (preset === 'traditional') {
    const traditional = person.identityOptions.find((option) => isTraditionalOption(option));
    if (traditional) return traditional.id;
    return pickPresetIdentity(person, 'conservative');
  }
  return person.identityOptions.find((option) => isConservativeOption(option))?.id || person.identityOptions[0]?.id;
}

function pickTraditionalIdentity(person) {
  return pickPresetIdentity(person, 'traditional');
}

function pickConservativeIdentity(person) {
  return pickPresetIdentity(person, 'conservative');
}

function personMatchesSearch(person, term) {
  if (!term) return true;
  return normalize(person.nameZh).includes(term) || normalize(person.nameLat).includes(term) || person.aliases.some((a) => normalize(a).includes(term));
}

function getMergeGroups(people) {
  const groups = new Map();
  for (const person of people) {
    for (const option of person.identityOptions) {
      if (!option || !isMergeTraditionalOption(option)) continue;
      const key = option.mergeGroupId;
      const group = groups.get(key) || { members: new Set(), targetPersonId: option.mergeTargetPersonId };
      group.members.add(person.id);
      group.targetPersonId = group.targetPersonId || option.mergeTargetPersonId;
      groups.set(key, group);
    }
  }
  return groups;
}

function computeSelections(graph, preset) {
  const selection = new Map();
  for (const person of graph.people) {
    const chosenId = preset === 'traditional' ? pickTraditionalIdentity(person) : pickConservativeIdentity(person);
    if (chosenId) selection.set(person.id, chosenId);
  }
  return selection;
}

function computeMergedVisibleIds(graph, selection, mergeGroups) {
  const mapped = new Map();
  const selectedByPerson = new Map();
  for (const person of graph.people) {
    const chosenId = selection.get(person.id);
    if (!chosenId) continue;
    const option = person.identityOptions.find((item) => item.id === chosenId);
    selectedByPerson.set(person.id, option ? option : undefined);
  }

  for (const [groupId, group] of mergeGroups.entries()) {
    if (!group || group.members.size < 2 || !group.targetPersonId) continue;
    const target = group.targetPersonId;
    let targetConsistent = true;
    for (const memberId of group.members) {
      const option = selectedByPerson.get(memberId);
      if (!option || option.mergeGroupId !== groupId || option.mergeTargetPersonId !== target) {
        targetConsistent = false;
        break;
      }
    }
    if (!targetConsistent) continue;
    for (const memberId of group.members) {
      if (memberId !== target) mapped.set(memberId, target);
    }
  }

  const visibleIds = new Set();
  for (const person of graph.people) {
    visibleIds.add(mapped.get(person.id) ?? person.id);
  }
  return { mapped, visibleIds };
}

function computeVisibleState(graph, preset, searchTerm) {
  const term = normalize(searchTerm);
  const selection = computeSelections(graph, preset);
  const mergeGroups = getMergeGroups(graph.people);
  const { mapped, visibleIds: mergedVisibleIds } = computeMergedVisibleIds(graph, selection, mergeGroups);
  const bucket = new Map();
  for (const person of graph.people) {
    const rep = mapped.get(person.id) ?? person.id;
    const members = bucket.get(rep) || new Set();
    members.add(person.id);
    bucket.set(rep, members);
  }
  const visiblePeople = new Set();
  for (const [visibleId, memberIds] of bucket.entries()) {
    for (const memberId of memberIds) {
      const person = graph.people.find((x) => x.id === memberId);
      if (!person) continue;
      if (personMatchesSearch(person, term)) {
        visiblePeople.add(visibleId);
        break;
      }
    }
  }
  const visibleRelations = (graph.relationships || []).filter((rel) => {
    const from = mapped.get(rel.fromPerson) ?? rel.fromPerson;
    const to = mapped.get(rel.toPerson) ?? rel.toPerson;
    return visiblePeople.has(from) && visiblePeople.has(to) && from !== to;
  });
  return { visiblePeople, visibleRelations };
}

function collectTerms(graph) {
  return [...new Set(
    graph.people.flatMap((person) => [person.nameZh, person.nameLat, ...(person.aliases || [])])
      .filter(Boolean)
      .map((value) => String(value))
  )];
}

function relationshipBooks(relation) {
  return Array.isArray(relation.books) && relation.books.length ? relation.books : [relation.book].filter(Boolean);
}

async function main() {
  const dataPath = path.resolve(process.cwd(), 'public', 'data', 'graph.json');
  const raw = await fs.readFile(dataPath, 'utf8');
  const graph = JSON.parse(raw);

  const validPersonEras = new Set(['旧约背景', '耶稣时期', '使徒时期', '时代待审']);
  for (const person of graph.people) {
    if (!validPersonEras.has(person.era)) throw new Error(`person ${person.id} has invalid era ${person.era}`);
  }
  const moses = graph.people.find((person) => person.nameLat === 'Moses');
  const jesus = graph.people.find((person) => person.nameLat === 'Jesus');
  const paulByLatin = graph.people.find((person) => person.nameLat === 'Paul');
  if (moses?.era !== '旧约背景') throw new Error(`Moses era mismatch: ${moses?.era}`);
  if (jesus?.era !== '耶稣时期') throw new Error(`Jesus era mismatch: ${jesus?.era}`);
  if (paulByLatin?.era !== '使徒时期') throw new Error(`Paul era mismatch: ${paulByLatin?.era}`);
  console.log(`[era-check] Moses=${moses.era}; Jesus=${jesus.era}; Paul=${paulByLatin.era}`);

  const selectionConservative = computeSelections(graph, 'conservative');
  const mergeGroups = getMergeGroups(graph.people);
  const conservativeVisible = computeMergedVisibleIds(graph, selectionConservative, mergeGroups).visibleIds.size;
  const selectionTraditional = computeSelections(graph, 'traditional');
  const traditionalVisible = computeMergedVisibleIds(graph, selectionTraditional, mergeGroups).visibleIds.size;
  const expectedConservative = graph.people.length;
  const expectedTraditional = graph.people.length - Array.from(mergeGroups.values())
    .reduce((total, group) => total + Math.max(0, group.members.size - 1), 0);
  console.log(`[identity-check] conservative=${conservativeVisible}, traditional=${traditionalVisible}`);
  if (conservativeVisible !== expectedConservative) {
    throw new Error(`conservative count mismatch: ${conservativeVisible} != ${expectedConservative}`);
  }
  if (traditionalVisible !== expectedTraditional) {
    throw new Error(`traditional count mismatch: ${traditionalVisible} != ${expectedTraditional}`);
  }

  const terms = collectTerms(graph);
  for (const preset of ['conservative', 'traditional']) {
    for (const term of terms) {
      const { visiblePeople, visibleRelations } = computeVisibleState(graph, preset, term);
      for (const rel of visibleRelations) {
        if (!visiblePeople.has(rel.fromPerson) || !visiblePeople.has(rel.toPerson)) {
          throw new Error(`search hidden-node check failed for preset=${preset} term="${term}" on edge ${rel.id}`);
        }
      }
    }
  }

  console.log(`[identity-check] search-hidden-node invariant passed (${terms.length} terms × conservative/traditional)`);

  for (const person of graph.people) {
    if (!Array.isArray(person.mentions) || !person.mentions.length) {
      throw new Error(`person ${person.id} has no public mention locators`);
    }
    for (const mention of person.mentions) {
      if (!mention.passage || !mention.sourceId) throw new Error(`person ${person.id} has an incomplete mention locator`);
    }
    for (const option of person.identityOptions || []) {
      if ((scopeText(option) === 'common_tradition' || statusText(option) === 'disputed') && option.status === '独立') {
        throw new Error(`traditional identity option ${option.id} is incorrectly labelled 独立`);
      }
    }
  }

  const josephusSource = graph.sources.find((source) => source.id === 'source:0004');
  if (!josephusSource) throw new Error('Josephus source source:0004 is missing from the published graph');
  if (josephusSource.kind !== 'ancient') {
    throw new Error(`Josephus source source:0004 kind mismatch: ${josephusSource.kind} != ancient`);
  }
  const josephusAssertions = graph.relationships.filter((relation) => relation.sources.includes('source:0004'));
  if (!graph.meta.editorialReviewRequired && !josephusAssertions.length) {
    throw new Error('ready graph contains no published Josephus assertion');
  }
  for (const assertion of josephusAssertions) {
    if (assertion.evidenceLevel !== 'ancient') {
      throw new Error(`historical assertion ${assertion.id} evidence mismatch: ${assertion.evidenceLevel} != ancient`);
    }
  }

  const activeKinship = graph.relationships.filter((relation) => String(relation.rawRelationType || '').startsWith('kinship:'));
  if (!activeKinship.length) throw new Error('published graph contains no active kinship relationships');
  for (const relation of activeKinship) {
    if (String(relation.type || '').startsWith('候选')) {
      throw new Error(`active kinship relationship ${relation.id} is incorrectly labelled as a candidate`);
    }
  }
  console.log(`[evidence-check] Josephus-source=ancient; published-Josephus=${josephusAssertions.length}; active-kinship=${activeKinship.length}`);

  for (const topic of graph.topicPresets || []) {
    if (topic.id === 'all') continue;
    const includedPeople = new Set(topic.personIncludes || []);
    for (const personId of includedPeople) {
      if (!graph.people.some((person) => person.id === personId)) {
        throw new Error(`topic preset ${topic.id} references missing person ${personId}`);
      }
    }
    const matches = graph.relationships.filter((rel) => {
      if (topic.relationTypes.length && !topic.relationTypes.includes(rel.type)) return false;
      if (topic.bookIncludes.length && !relationshipBooks(rel).some((book) => topic.bookIncludes.includes(book))) return false;
      if (topic.eraIncludes.length && !topic.eraIncludes.includes(rel.era)) return false;
      if (topic.evidenceIncludes.length && !topic.evidenceIncludes.includes(rel.evidenceLevel)) return false;
      if (includedPeople.size && (!includedPeople.has(rel.fromPerson) || !includedPeople.has(rel.toPerson))) return false;
      return true;
    });
    if (!matches.length) throw new Error(`topic preset ${topic.id} has no matching relationships`);
    console.log(`[topic-check] ${topic.id}=${matches.length}`);
  }

  const familyTopic = graph.topicPresets.find((topic) => topic.id === 'family');
  const allKinship = graph.relationships.filter((relation) => String(relation.rawRelationType || '').startsWith('kinship:'));
  const familyMatches = graph.relationships.filter((relation) => familyTopic.relationTypes.includes(relation.type));
  if (familyMatches.length !== allKinship.length) {
    throw new Error(`family topic is incomplete: ${familyMatches.length} != ${allKinship.length}`);
  }

  const discipleshipTopic = graph.topicPresets.find((topic) => topic.id === 'discipleship');
  const discipleshipMatches = graph.relationships.filter((relation) => discipleshipTopic.relationTypes.includes(relation.type));
  if (discipleshipMatches.some((relation) => relation.type === '长期同工')) {
    throw new Error('discipleship topic incorrectly includes coworker relationships');
  }
  if (discipleshipMatches.length !== graph.relationships.filter((relation) => relation.type === '师徒').length) {
    throw new Error('discipleship topic does not cover every published 师徒 relationship');
  }

  const paul = graph.people.find((person) => person.nameZh === '保罗');
  const paulTeamTopic = graph.topicPresets.find((topic) => topic.id === 'paulTeam');
  const paulCoworker = graph.relationships.filter((relation) =>
    relation.type === '长期同工' && (relation.fromPerson === paul.id || relation.toPerson === paul.id)
  );
  const paulTeamSet = new Set(paulTeamTopic.personIncludes || []);
  const paulTeamMatches = graph.relationships.filter((relation) =>
    paulTeamTopic.relationTypes.includes(relation.type) && paulTeamSet.has(relation.fromPerson) && paulTeamSet.has(relation.toPerson)
  );
  if (paulTeamMatches.length !== paulCoworker.length) {
    throw new Error(`Paul coworker topic is incomplete: ${paulTeamMatches.length} != ${paulCoworker.length}`);
  }
  console.log(`[topic-completeness] family=${familyMatches.length}; discipleship=${discipleshipMatches.length}; paulTeam=${paulTeamMatches.length}`);
}

main().catch((error) => {
  console.error(`[identity-check] 失败：${error?.message || error}`);
  process.exitCode = 1;
});
