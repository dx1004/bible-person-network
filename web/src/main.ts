import './style.css';
import './phosphor.css';
import cytoscape from 'cytoscape';

type EvidenceLevel = 'nt_text' | 'ancient' | 'modern';
type IdentityPreset = 'conservative' | 'traditional' | 'custom';
type MobilePanel = 'people' | 'graph' | 'details';

type IdentityOption = {
  id: string;
  label: string;
  status: string;
  statusRaw?: string;
  scope?: string;
  preset?: string;
  mergeGroupId?: string | null;
  mergeTargetPersonId?: string | null;
  displayLabel?: string | null;
};

type MentionLocator = { passage: string; location?: string; sourceId: string };

type Person = {
  id: string;
  nameZh: string;
  nameLat: string;
  aliases: string[];
  era: string;
  books: string[];
  mentions: MentionLocator[];
  identityOptions: IdentityOption[];
  selectedPresetDefault?: 'conservative' | 'traditional';
  notes?: string;
};

type Relationship = {
  id: string;
  fromPerson: string;
  toPerson: string;
  rawRelationType?: string;
  rawRelationSubType?: string;
  type: string;
  direction: 'outgoing' | 'incoming' | 'undirected' | 'bidirectional';
  description: string;
  certainty: 'high' | 'medium' | 'low';
  rawEvidenceLevel?: string;
  evidenceLevel: EvidenceLevel;
  book: string;
  books: string[];
  era: string;
  sources: string[];
  passages: string[];
  identityGuards?: Array<{ personId: string; allowedIdentityOptions: string[] }>;
};

type Source = { id: string; label: string; kind: EvidenceLevel; url?: string };
type TopicPreset = {
  id: string;
  name: string;
  relationTypes: string[];
  bookIncludes: string[];
  eraIncludes: string[];
  evidenceIncludes: EvidenceLevel[];
  personIncludes?: string[];
};
type GraphData = {
  meta: {
    version: string;
    generatedAt: string;
    edition: string;
    notes?: string;
    status?: unknown;
    summary?: unknown;
    editorialReviewRequired?: boolean;
  };
  people: Person[];
  relationships: Relationship[];
  sources: Source[];
  topicPresets: TopicPreset[];
};
type FilterState = {
  search: string;
  books: Set<string>;
  relations: Set<string>;
  eras: Set<string>;
  evidences: Set<EvidenceLevel>;
  personIncludes: Set<string>;
  topic: string;
};
type VisibleModel = {
  people: Person[];
  relationships: Relationship[];
  personMap: Map<string, Person>;
  mergedTo: Map<string, string>;
};

const GRAPH_EDGE_LIMIT = 14;
const SEARCH_RESULT_LIMIT = 80;
const ALL_EVIDENCE: EvidenceLevel[] = ['nt_text', 'ancient', 'modern'];
const evidenceLabel: Record<EvidenceLevel, string> = {
  nt_text: '新约经文', ancient: '古代原始史料', modern: '现代权威工具书'
};
const evidenceColor: Record<EvidenceLevel, string> = {
  nt_text: '#d5f3ff', ancient: '#d9f8e5', modern: '#e4dcff'
};
const certaintyLabel = { high: '高', medium: '中', low: '低' } as const;

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('app container is missing');

appRoot.innerHTML = `
  <div class="app-shell" data-mobile-panel="graph" data-drawer="none" aria-busy="true">
    <div class="world-backdrop" aria-hidden="true"></div>
    <header class="topbar">
      <div class="brand-block">
        <div class="brand-mark" aria-hidden="true"><i class="ph ph-sparkle"></i></div>
        <div><h1>新约人物关系网</h1><p>沿着经文的光路，看见人物之间的联系</p></div>
      </div>
      <div class="global-search">
        <label class="sr-only" for="search">搜索人物中文名、别名、希腊文或拉丁转写</label>
        <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
        <input id="search" type="search" autocomplete="off" placeholder="搜索中文名、别名、希腊文或拉丁名" />
        <button id="clear-search" class="icon-button search-clear" type="button" data-onclick="direct" aria-label="清空搜索" hidden><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
      <div class="top-controls reading-surface">
        <label class="compact-field" for="topic-select"><span>当前专题</span><select id="topic-select"></select></label>
        <label class="compact-field" for="identity-preset"><span>身份方案</span><select id="identity-preset">
          <option value="conservative">全部保守</option><option value="traditional">常见传统</option><option value="custom" disabled>逐项自定义</option>
        </select></label>
        <div class="dataset-counts" aria-label="数据集计数">
          <strong id="people-total">—</strong><span>人物</span><strong id="relations-total">—</strong><span>已发布关系</span>
        </div>
      </div>
    </header>
    <div id="review-warning" class="review-warning reading-surface" role="status" hidden>
      <i class="ph ph-warning-circle" aria-hidden="true"></i><span>当前数据仍需要编辑审校，请勿把待审内容视为定稿。</span>
    </div>
    <nav class="command-rail reading-surface" aria-label="关系网工具">
      <button type="button" data-onclick="delegated" data-drawer-target="people" aria-label="查找人物" aria-pressed="false"><i class="ph ph-users" aria-hidden="true"></i><span>人物</span></button>
      <button type="button" data-onclick="delegated" data-drawer-target="filters" aria-label="专题与筛选" aria-pressed="false"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i><span>筛选</span></button>
      <button type="button" data-onclick="delegated" data-drawer-target="details" aria-label="人物与出处" aria-pressed="false"><i class="ph ph-book-open-text" aria-hidden="true"></i><span>出处</span></button>
    </nav>
    <nav class="mobile-tabs reading-surface" aria-label="移动端视图">
      <button type="button" data-onclick="direct" data-mobile-target="people"><i class="ph ph-users" aria-hidden="true"></i>人物</button>
      <button type="button" data-onclick="direct" data-mobile-target="graph" aria-pressed="true"><i class="ph ph-git-branch" aria-hidden="true"></i>图谱</button>
      <button type="button" data-onclick="direct" data-mobile-target="details"><i class="ph ph-book-open-text" aria-hidden="true"></i>详情</button>
    </nav>
    <main class="workspace">
      <aside class="people-pane reading-surface" aria-labelledby="people-heading">
        <div class="pane-heading"><div><p class="eyebrow">人物索引</p><h2 id="people-heading" tabindex="-1">查找人物</h2></div><div class="pane-actions"><span id="people-result-count" class="count-badge">—</span><button class="icon-button drawer-close" type="button" data-onclick="delegated" data-drawer-close aria-label="关闭人物索引"><i class="ph ph-x" aria-hidden="true"></i></button></div></div>
        <div id="topic-shortcuts" class="topic-shortcuts" aria-label="专题快捷选择"></div>
        <details class="advanced-filters">
          <summary><i class="ph ph-sliders-horizontal" aria-hidden="true"></i>精细筛选</summary>
          <div class="filter-section"><div class="filter-heading"><strong>人物时代</strong><button type="button" data-onclick="direct" id="clear-eras" class="text-button">清除</button></div><div id="era-filters" class="checkbox-grid era-filter-grid"></div></div>
          <div class="filter-section"><div class="filter-heading"><strong>书卷</strong><button type="button" data-onclick="direct" id="clear-books" class="text-button">清除</button></div><div id="book-filters" class="checkbox-grid"></div></div>
          <div class="filter-section"><div class="filter-heading"><strong>关系类型</strong><button type="button" data-onclick="direct" id="clear-relations" class="text-button">清除</button></div><div id="relation-filters" class="checkbox-grid"></div></div>
          <button id="reset-filters" class="secondary-button" type="button" data-onclick="direct"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i>重置全部筛选</button>
        </details>
        <div id="people-list" class="people-list" aria-label="人物搜索结果"></div>
        <div id="people-empty" class="empty-state compact" hidden><i class="ph ph-magnifying-glass" aria-hidden="true"></i><strong>没有匹配人物</strong><p>可清空搜索或重置专题与筛选。</p></div>
      </aside>
      <section class="graph-pane" aria-labelledby="graph-heading">
        <div class="graph-toolbar">
          <div class="focus-heading reading-surface"><p class="eyebrow">当前焦点 · 一度关系</p><h2 id="graph-heading" tabindex="-1">选择人物查看一度关系</h2><p id="focus-subtitle">点击晶体人物，沿光路查看联系</p></div>
          <div class="graph-toolbar-actions">
            <button id="fit-graph" class="icon-button" type="button" data-onclick="direct" aria-label="适应画布"><i class="ph ph-arrows-out" aria-hidden="true"></i></button>
            <button id="center-focus" class="icon-button" type="button" data-onclick="direct" aria-label="回到焦点人物"><i class="ph ph-crosshair" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="evidence-controls reading-surface" role="group" aria-label="证据层筛选">
          <span>证据层</span>
          ${ALL_EVIDENCE.map((level) => `<label class="evidence-toggle evidence-${level}"><input type="checkbox" value="${level}" checked><i class="ph ph-circle evidence-dot" aria-hidden="true"></i>${evidenceLabel[level]}</label>`).join('')}
        </div>
        <div class="graph-stage">
          <div id="graph" role="img" aria-label="选中人物的一度关系图；所有关系也可在右侧文字列表读取"></div>
          <div id="graph-empty" class="empty-state graph-empty" hidden><i class="ph ph-git-branch" aria-hidden="true"></i><strong>当前筛选下没有关系</strong><p>人物仍保留在画布；可开启更多证据层或重置专题。</p></div>
          <div class="zoom-controls" aria-label="图谱缩放">
            <button id="zoom-in" class="icon-button" type="button" data-onclick="direct" aria-label="放大"><i class="ph ph-plus" aria-hidden="true"></i></button>
            <button id="zoom-out" class="icon-button" type="button" data-onclick="direct" aria-label="缩小"><i class="ph ph-minus" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="graph-footer reading-surface" aria-live="polite">
          <div class="ribbon-heading"><span>证据带</span><strong id="evidence-ribbon-title">选择一条光路查看关系</strong></div>
          <p id="evidence-ribbon-meta">人物关系及出处会显示在这里。</p>
          <p id="graph-status">正在载入关系图…</p>
          <button type="button" class="ribbon-action" data-onclick="delegated" data-drawer-target="details">查看完整出处 <i class="ph ph-arrow-right" aria-hidden="true"></i></button>
        </div>
      </section>
      <aside class="inspector-pane reading-surface" aria-labelledby="inspector-heading">
        <div class="pane-heading inspector-heading"><div><p class="eyebrow">研究详情</p><h2 id="inspector-heading" tabindex="-1">人物与出处</h2></div><button class="icon-button drawer-close mobile-close" type="button" data-onclick="direct" data-mobile-target="graph" data-drawer-close aria-label="关闭详情"><i class="ph ph-x" aria-hidden="true"></i></button></div>
        <div id="inspector-content" class="inspector-content"><div class="loading-state" role="status"><i class="ph ph-spinner-gap loader" aria-hidden="true"></i>正在载入资料…</div></div>
      </aside>
    </main>
    <footer class="site-footer"><span id="dataset-version">数据版本载入中</span><span>纯静态站点 · 不连接公开 Neo4j</span><a href="https://github.com/dx1004/new-testament-person-network" target="_blank" rel="noopener noreferrer">资料与代码 <i class="ph ph-arrow-square-out" aria-hidden="true"></i></a></footer>
  </div>`;

const shell = document.querySelector('.app-shell') as HTMLDivElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const clearSearchButton = document.getElementById('clear-search') as HTMLButtonElement;
const topicSelect = document.getElementById('topic-select') as HTMLSelectElement;
const identityPresetSelect = document.getElementById('identity-preset') as HTMLSelectElement;
const topicShortcuts = document.getElementById('topic-shortcuts')!;
const peopleList = document.getElementById('people-list')!;
const peopleEmpty = document.getElementById('people-empty') as HTMLDivElement;
const peopleResultCount = document.getElementById('people-result-count')!;
const eraFilters = document.getElementById('era-filters')!;
const bookFilters = document.getElementById('book-filters')!;
const relationFilters = document.getElementById('relation-filters')!;
const graphContainer = document.getElementById('graph')!;
const graphEmpty = document.getElementById('graph-empty') as HTMLDivElement;
const graphHeading = document.getElementById('graph-heading')!;
const graphStatus = document.getElementById('graph-status')!;
const focusSubtitle = document.getElementById('focus-subtitle')!;
const evidenceRibbonTitle = document.getElementById('evidence-ribbon-title')!;
const evidenceRibbonMeta = document.getElementById('evidence-ribbon-meta')!;
const inspectorContent = document.getElementById('inspector-content')!;
const reviewWarning = document.getElementById('review-warning') as HTMLDivElement;

let data: GraphData | null = null;
let cy: cytoscape.Core | null = null;
let currentModel: VisibleModel | null = null;
let selectedPersonId = '';
let selectedRelationId = '';
let identityPreset: IdentityPreset = 'conservative';
let mobilePanel: MobilePanel = 'graph';
let searchTimer: number | undefined;
let isComposing = false;
const filters: FilterState = { search: '', books: new Set(), relations: new Set(), eras: new Set(), evidences: new Set(ALL_EVIDENCE), personIncludes: new Set(), topic: 'all' };
const identitySelection: Record<string, string> = {};
const originalPersonById = new Map<string, Person>();
const sourceById = new Map<string, Source>();
const mergeGroups = new Map<string, { members: Set<string>; targetPersonId: string | null }>();

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function normalize(value: unknown) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-Hans').trim(); }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function isTraditionalOption(option: IdentityOption) {
  const status = normalize(option.statusRaw); const scope = normalize(option.scope); const preset = normalize(option.preset);
  return preset === 'traditional' || status === 'traditional' || status === 'disputed' || scope === 'common_tradition' || scope === 'common-tradition';
}
function isConservativeOption(option: IdentityOption) {
  const status = normalize(option.statusRaw); const scope = normalize(option.scope); const preset = normalize(option.preset);
  return preset === 'conservative' || status === 'independent' || status === 'conservative' || status === 'confirmed' || scope === 'default' || scope === 'conservative';
}
function isMergeTraditionalOption(option: IdentityOption) { return Boolean(option.mergeGroupId && option.mergeTargetPersonId && isTraditionalOption(option)); }
function pickIdentityForPreset(person: Person, preset: Exclude<IdentityPreset, 'custom'>) {
  if (!person.identityOptions.length) return undefined;
  const explicit = person.identityOptions.find((option) => normalize(option.preset) === preset);
  if (explicit) return explicit.id;
  if (preset === 'traditional') return person.identityOptions.find(isTraditionalOption)?.id || person.identityOptions.find(isConservativeOption)?.id || person.identityOptions[0].id;
  return person.identityOptions.find(isConservativeOption)?.id || person.identityOptions[0].id;
}
function getSelectedIdentity(person: Person) { return person.identityOptions.find((option) => option.id === identitySelection[person.id]) || person.identityOptions[0]; }

function rebuildIndexes() {
  originalPersonById.clear(); sourceById.clear(); mergeGroups.clear();
  for (const person of data?.people ?? []) {
    originalPersonById.set(person.id, person);
    for (const option of person.identityOptions) {
      if (!isMergeTraditionalOption(option) || !option.mergeGroupId) continue;
      const group = mergeGroups.get(option.mergeGroupId) || { members: new Set<string>(), targetPersonId: option.mergeTargetPersonId || null };
      group.members.add(person.id); group.targetPersonId ||= option.mergeTargetPersonId || null; mergeGroups.set(option.mergeGroupId, group);
    }
  }
  for (const source of data?.sources ?? []) sourceById.set(source.id, source);
}
function resetMergeGroup(groupId: string) {
  const group = mergeGroups.get(groupId); if (!group) return;
  for (const personId of group.members) { const person = originalPersonById.get(personId); const optionId = person ? pickIdentityForPreset(person, 'conservative') : undefined; if (optionId) identitySelection[personId] = optionId; }
}
function syncTraditionalGroup(option: IdentityOption) {
  if (!option.mergeGroupId) return; const group = mergeGroups.get(option.mergeGroupId); if (!group) return;
  for (const personId of group.members) { const person = originalPersonById.get(personId); const matching = person?.identityOptions.find((candidate) => candidate.mergeGroupId === option.mergeGroupId && isMergeTraditionalOption(candidate)); if (matching) identitySelection[personId] = matching.id; }
}
function setIdentityPreset(preset: Exclude<IdentityPreset, 'custom'>, rerender = true) {
  identityPreset = preset;
  for (const person of data?.people ?? []) { const optionId = pickIdentityForPreset(person, preset); if (!optionId) continue; identitySelection[person.id] = optionId; const option = person.identityOptions.find((candidate) => candidate.id === optionId); if (preset === 'traditional' && option) syncTraditionalGroup(option); }
  if (preset === 'conservative') for (const groupId of mergeGroups.keys()) resetMergeGroup(groupId);
  identityPresetSelect.value = preset; if (rerender) renderDataViews();
}
function applyPersonIdentity(personId: string, optionId: string) {
  const person = originalPersonById.get(personId); const option = person?.identityOptions.find((candidate) => candidate.id === optionId); if (!person || !option) return;
  const previous = getSelectedIdentity(person); identitySelection[personId] = optionId;
  if (option.mergeGroupId) syncTraditionalGroup(option); else if (previous?.mergeGroupId) resetMergeGroup(previous.mergeGroupId);
  identityPreset = 'custom'; identityPresetSelect.value = 'custom'; renderDataViews();
}
function relationActiveForIdentity(relationship: Relationship) { return (relationship.identityGuards || []).every((guard) => guard.allowedIdentityOptions.includes(identitySelection[guard.personId])); }
function computeMergeMapping() {
  const mergedTo = new Map<string, string>();
  for (const [groupId, group] of mergeGroups.entries()) {
    if (!group.targetPersonId || group.members.size < 2) continue;
    const allSelected = [...group.members].every((personId) => { const person = originalPersonById.get(personId); const option = person ? getSelectedIdentity(person) : undefined; return option?.mergeGroupId === groupId && option.mergeTargetPersonId === group.targetPersonId; });
    if (allSelected) for (const personId of group.members) if (personId !== group.targetPersonId) mergedTo.set(personId, group.targetPersonId);
  }
  return mergedTo;
}
function relationMatchesFilters(relationship: Relationship, mappedPersonIncludes: Set<string>, personMap: Map<string, Person>) {
  const books = relationship.books?.length ? relationship.books : [relationship.book].filter(Boolean);
  if (filters.books.size && !books.some((book) => filters.books.has(book))) return false;
  if (filters.relations.size && !filters.relations.has(relationship.type)) return false;
  if (filters.eras.size) {
    const fromEra = personMap.get(relationship.fromPerson)?.era;
    const toEra = personMap.get(relationship.toPerson)?.era;
    if (!filters.eras.has(fromEra || '') && !filters.eras.has(toEra || '')) return false;
  }
  if (!filters.evidences.has(relationship.evidenceLevel)) return false;
  if (mappedPersonIncludes.size && (!mappedPersonIncludes.has(relationship.fromPerson) || !mappedPersonIncludes.has(relationship.toPerson))) return false;
  return true;
}
function buildVisibleModel(): VisibleModel {
  if (!data) return { people: [], relationships: [], personMap: new Map(), mergedTo: new Map() };
  const mergedTo = computeMergeMapping(); const buckets = new Map<string, Set<string>>();
  for (const person of data.people) { const representative = mergedTo.get(person.id) || person.id; const members = buckets.get(representative) || new Set<string>(); members.add(person.id); buckets.set(representative, members); }
  const personMap = new Map<string, Person>();
  for (const [representativeId, members] of buckets.entries()) {
    const base = originalPersonById.get(representativeId); if (!base) continue;
    const aliases = new Set(base.aliases); const books = new Set(base.books); const mentions = new Map<string, MentionLocator>();
    const representativeIdentity = getSelectedIdentity(base);
    let displayName = representativeIdentity?.mergeTargetPersonId === representativeId && representativeIdentity.displayLabel
      ? representativeIdentity.displayLabel
      : base.nameZh;
    for (const memberId of members) { const member = originalPersonById.get(memberId); if (!member) continue; aliases.add(member.nameZh); member.aliases.forEach((alias) => aliases.add(alias)); member.books.forEach((book) => books.add(book)); member.mentions.forEach((mention) => mentions.set(`${mention.sourceId}|${mention.passage}`, mention)); }
    personMap.set(representativeId, {
      ...base,
      nameZh: displayName,
      aliases: [...aliases].filter((alias) => Boolean(alias) && alias !== displayName),
      books: [...books],
      mentions: [...mentions.values()]
    });
  }
  const mappedPersonIncludes = new Set([...filters.personIncludes].map((personId) => mergedTo.get(personId) || personId));
  const relationships = data.relationships.filter(relationActiveForIdentity).map((relationship) => ({ ...relationship, fromPerson: mergedTo.get(relationship.fromPerson) || relationship.fromPerson, toPerson: mergedTo.get(relationship.toPerson) || relationship.toPerson })).filter((relationship) => relationship.fromPerson !== relationship.toPerson).filter((relationship) => relationMatchesFilters(relationship, mappedPersonIncludes, personMap));
  const relationshipNarrowed = filters.books.size > 0 || filters.relations.size > 0 || filters.evidences.size < ALL_EVIDENCE.length;
  let people = [...personMap.values()];
  if (filters.eras.size) people = people.filter((person) => filters.eras.has(person.era));
  if (relationshipNarrowed || mappedPersonIncludes.size) { const connected = new Set<string>(); relationships.forEach((relationship) => { connected.add(relationship.fromPerson); connected.add(relationship.toPerson); }); people = people.filter((person) => connected.has(person.id) || person.id === selectedPersonId); }
  people.sort((a, b) => a.nameZh.localeCompare(b.nameZh, 'zh-Hans'));
  return { people, relationships, personMap, mergedTo };
}
function personMatchesSearch(person: Person, term: string) { return !term || [person.nameZh, person.nameLat, ...person.aliases].some((value) => normalize(value).includes(term)); }

function applyTopic(topicId: string, rerender = true) {
  if (!data) return; const topic = data.topicPresets.find((candidate) => candidate.id === topicId); if (!topic) return;
  filters.topic = topic.id; filters.books = new Set(topic.bookIncludes || []); filters.relations = new Set(topic.relationTypes || []); filters.eras = new Set(topic.eraIncludes || []); filters.evidences = new Set(topic.evidenceIncludes?.length ? topic.evidenceIncludes : ALL_EVIDENCE); filters.personIncludes = new Set(topic.personIncludes || []);
  topicSelect.value = topic.id;
  syncEvidenceControls();
  if (rerender && topic.id !== 'all') {
    const topicModel = buildVisibleModel();
    const currentDegree = topicModel.relationships.filter((relationship) => relationship.fromPerson === selectedPersonId || relationship.toPerson === selectedPersonId).length;
    if (currentDegree === 0 && topicModel.relationships.length) {
      const degrees = new Map<string, number>();
      topicModel.relationships.forEach((relationship) => {
        degrees.set(relationship.fromPerson, (degrees.get(relationship.fromPerson) || 0) + 1);
        degrees.set(relationship.toPerson, (degrees.get(relationship.toPerson) || 0) + 1);
      });
      selectedPersonId = [...degrees.entries()].sort((a, b) => b[1] - a[1])[0][0];
      selectedRelationId = '';
    }
  }
  if (rerender) renderDataViews();
}
function markFiltersCustom() {
  filters.topic = 'custom';
  if (!topicSelect.querySelector('option[value="custom"]')) { const option = document.createElement('option'); option.value = 'custom'; option.textContent = '自定义筛选'; topicSelect.append(option); }
  topicSelect.value = 'custom';
}
function syncEvidenceControls() { document.querySelectorAll<HTMLInputElement>('.evidence-toggle input').forEach((input) => { input.checked = filters.evidences.has(input.value as EvidenceLevel); }); }
function renderTopicControls() {
  if (!data) return;
  topicSelect.innerHTML = data.topicPresets.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</option>`).join('');
  if (filters.topic === 'custom') topicSelect.insertAdjacentHTML('beforeend', '<option value="custom">自定义筛选</option>');
  topicSelect.value = filters.topic;
  topicShortcuts.innerHTML = data.topicPresets.filter((topic) => topic.id !== 'all').map((topic) => `<button type="button" data-topic="${escapeHtml(topic.id)}" aria-pressed="${filters.topic === topic.id}">${escapeHtml(topic.name)}</button>`).join('');
}
function renderAdvancedFilters() {
  if (!data) return;
  const books = unique(data.relationships.flatMap((relationship) => relationship.books?.length ? relationship.books : [relationship.book])).filter(Boolean).sort();
  const relationTypes = unique(data.relationships.map((relationship) => relationship.type)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
  const eras = unique(data.people.map((person) => person.era)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
  eraFilters.innerHTML = eras.map((era) => `<label><input type="checkbox" data-filter-kind="era" value="${escapeHtml(era)}" ${filters.eras.has(era) ? 'checked' : ''}><span>${escapeHtml(era)}</span></label>`).join('');
  bookFilters.innerHTML = books.map((book) => `<label><input type="checkbox" data-filter-kind="book" value="${escapeHtml(book)}" ${filters.books.has(book) ? 'checked' : ''}><span>${escapeHtml(book)}</span></label>`).join('');
  relationFilters.innerHTML = relationTypes.map((type) => `<label><input type="checkbox" data-filter-kind="relation" value="${escapeHtml(type)}" ${filters.relations.has(type) ? 'checked' : ''}><span>${escapeHtml(type)}</span></label>`).join('');
}
function renderPeopleList() {
  if (!currentModel) return; const term = normalize(filters.search); const matches = currentModel.people.filter((person) => personMatchesSearch(person, term));
  matches.sort((a, b) => Number(b.id === selectedPersonId) - Number(a.id === selectedPersonId) || a.nameZh.localeCompare(b.nameZh, 'zh-Hans'));
  const shown = matches.slice(0, SEARCH_RESULT_LIMIT);
  peopleResultCount.textContent = term ? `${matches.length} 项` : `${currentModel.people.length} 人`; peopleEmpty.hidden = matches.length > 0; peopleList.hidden = matches.length === 0;
  peopleList.innerHTML = shown.map((person) => { const relationCount = currentModel?.relationships.filter((relationship) => relationship.fromPerson === person.id || relationship.toPerson === person.id).length || 0; const aliasPreview = person.aliases.slice(0, 3).join(' · ') || person.nameLat; return `<button type="button" data-onclick="delegated" class="person-row" data-person-id="${escapeHtml(person.id)}" aria-pressed="${person.id === selectedPersonId}"><i class="ph ph-user-circle person-icon" aria-hidden="true"></i><span class="person-row-copy"><span class="person-name-line"><strong>${escapeHtml(person.nameZh)}</strong><span class="era-badge">${escapeHtml(person.era)}</span></span><small>${escapeHtml(aliasPreview)}</small></span><span class="relation-count" aria-label="${relationCount} 条当前关系">${relationCount}</span></button>`; }).join('');
  if (matches.length > SEARCH_RESULT_LIMIT) peopleList.insertAdjacentHTML('beforeend', `<p class="list-limit-note">另有 ${matches.length - SEARCH_RESULT_LIMIT} 项；继续输入可缩小范围。</p>`);
}
function relationshipPriority(relationship: Relationship) { return ({ nt_text: 30, ancient: 20, modern: 10 }[relationship.evidenceLevel]) + ({ high: 3, medium: 2, low: 1 }[relationship.certainty]); }
function focusRelationships(model: VisibleModel) { return model.relationships.filter((relationship) => relationship.fromPerson === selectedPersonId || relationship.toPerson === selectedPersonId).sort((a, b) => relationshipPriority(b) - relationshipPriority(a) || a.type.localeCompare(b.type, 'zh-Hans')); }

function renderGraph() {
  if (!currentModel) return; const selected = currentModel.personMap.get(selectedPersonId) || originalPersonById.get(selectedPersonId); if (!selected) return;
  graphHeading.textContent = `${selected.nameZh}的一度关系`; const relationships = focusRelationships(currentModel); const isCompactGraph = window.innerWidth <= 620; const edgeLimit = isCompactGraph ? 6 : GRAPH_EDGE_LIMIT; const displayedRelationships = relationships.slice(0, edgeLimit); const nodeIds = new Set<string>([selectedPersonId]);
  displayedRelationships.forEach((relationship) => { nodeIds.add(relationship.fromPerson); nodeIds.add(relationship.toPerson); });
  const nodes = [...nodeIds].map((personId) => currentModel?.personMap.get(personId) || originalPersonById.get(personId)).filter((person): person is Person => Boolean(person));
  graphEmpty.hidden = relationships.length > 0; const capped = relationships.length > displayedRelationships.length;
  focusSubtitle.textContent = `${selected.era} · ${relationships.length} 条当前关系 · 点击人物切换焦点`;
  evidenceRibbonTitle.textContent = `${selected.nameZh} · ${relationships.length} 条一度关系`;
  evidenceRibbonMeta.textContent = '点击一条发光路径，查看关系类型、经文位置和资料来源。';
  graphStatus.textContent = capped ? `画布显示 ${displayedRelationships.length}/${relationships.length} 条一度关系；右侧列表保留全部 ${relationships.length} 条。` : `当前显示 ${nodes.length} 人 · ${relationships.length} 条一度关系。`;
  const width = Math.max(graphContainer.clientWidth, 320); const height = Math.max(graphContainer.clientHeight, 520);
  const neighborIds = nodes.filter((person) => person.id !== selectedPersonId).map((person) => person.id);
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(selectedPersonId, { x: width * 0.36, y: height * 0.7 });
  const columnCount = Math.ceil(neighborIds.length / 2);
  neighborIds.forEach((personId, index) => {
    const column = Math.floor(index / 2);
    const progress = (column + 1) / (columnCount + 1);
    const upperLane = index % 2 === 0;
    const pathY = height * (0.68 - progress * 0.46);
    const branchOffset = height * (0.08 + (column % 2) * 0.012);
    positions.set(personId, {
      x: width * (0.45 + progress * 0.43) + (upperLane ? -8 : 14),
      y: pathY + (upperLane ? -branchOffset : branchOffset)
    });
  });
  const relationshipIndex = new Map(displayedRelationships.map((relationship, index) => [relationship.id, index]));
  cy?.destroy();
  cy = cytoscape({
    container: graphContainer,
    elements: [
      ...nodes.map((person) => ({ group: 'nodes' as const, data: { id: person.id, label: person.nameZh, era: person.era, isFocus: person.id === selectedPersonId ? 1 : 0 }, position: positions.get(person.id) })),
      ...displayedRelationships.map((relationship) => {
        const otherId = relationship.fromPerson === selectedPersonId ? relationship.toPerson : relationship.fromPerson;
        const index = relationshipIndex.get(relationship.id) || 0;
        const column = Math.floor(index / 2);
        const upperLane = index % 2 === 0;
        const bend = (upperLane ? -1 : 1) * (30 + column * 7);
        const pointsAwayFromFocus = relationship.fromPerson === selectedPersonId;
        const targetArrow = relationship.direction === 'undirected' ? 'none' : relationship.direction === 'bidirectional' || pointsAwayFromFocus ? 'triangle' : 'none';
        const sourceArrow = relationship.direction === 'bidirectional' || (!pointsAwayFromFocus && relationship.direction !== 'undirected') ? 'triangle' : 'none';
        return { group: 'edges' as const, data: { id: relationship.id, source: selectedPersonId, target: otherId, label: relationship.type, direction: relationship.direction, certainty: relationship.certainty, evidenceColor: evidenceColor[relationship.evidenceLevel], routeDistances: `${bend} ${Math.round(bend * 0.42)}`, routeWeights: '0.16 0.72', sourceArrow, targetArrow } };
      })
    ],
    style: [
      { selector: 'node', style: { label: 'data(label)', color: '#ffffff', 'font-family': 'Inter, PingFang SC, Noto Sans CJK SC, sans-serif', 'font-size': 14, 'font-weight': 700, 'text-valign': 'bottom', 'text-margin-y': 11, 'text-wrap': 'wrap', 'text-max-width': '118px', 'text-outline-color': '#081127', 'text-outline-width': 4, 'background-color': '#000000', 'background-opacity': 0, 'background-image': '/assets/crystal-node.png', 'background-image-opacity': 1, 'background-fit': 'cover', 'background-clip': 'node', 'border-width': 0, width: 54, height: 54, 'overlay-opacity': 0, 'underlay-opacity': 0 } },
      { selector: 'node[era = "旧约背景"]', style: { 'underlay-color': '#c5a7ff' } },
      { selector: 'node[era = "耶稣时期"]', style: { 'underlay-color': '#ffe89a' } },
      { selector: 'node[era = "时代待审"]', style: { opacity: 0.72 } },
      { selector: 'node[isFocus = 1]', style: { 'background-image': '/assets/crystal-focus.png', width: 108, height: 108, 'font-size': 19, 'text-margin-y': 13 } },
      { selector: 'node:selected', style: { 'border-color': '#fff0bd', 'border-width': 2 } },
      { selector: 'node.route-neighbor', style: { 'underlay-color': '#ffe7a8', 'underlay-opacity': 0.2, 'underlay-padding': 11 } },
      { selector: 'edge', style: { width: 1.35, 'curve-style': 'unbundled-bezier', 'control-point-distances': 'data(routeDistances)', 'control-point-weights': 'data(routeWeights)', 'line-color': 'data(evidenceColor)', 'line-opacity': 0.47, 'source-arrow-color': 'data(evidenceColor)', 'target-arrow-color': 'data(evidenceColor)', 'source-arrow-shape': 'data(sourceArrow)' as any, 'target-arrow-shape': 'data(targetArrow)' as any, 'arrow-scale': 0.52, label: '', 'overlay-opacity': 0, 'underlay-opacity': 0 } },
      { selector: 'edge[certainty = "low"]', style: { 'line-style': 'dashed', 'line-opacity': 0.28 } },
      { selector: 'edge.is-hovered, edge:selected', style: { width: 3.1, 'line-color': '#ffe7a8', 'line-opacity': 0.94, 'source-arrow-color': '#ffe7a8', 'target-arrow-color': '#ffe7a8', 'arrow-scale': 0.72, 'underlay-color': '#8bdcff', 'underlay-opacity': 0.14, 'underlay-padding': 5, 'z-index': 20 } }
    ],
    layout: { name: 'preset', fit: false, animate: false },
    minZoom: 0.25, maxZoom: 2.5, selectionType: 'single'
  });
  cy.on('tap', 'node', (event) => selectPerson(String(event.target.id()), true));
  cy.on('tap', 'edge', (event) => selectRelationship(String(event.target.id()), true));
  cy.on('mouseover', 'edge', (event) => { const edge = event.target; edge.addClass('is-hovered'); edge.connectedNodes().not('[isFocus = 1]').addClass('route-neighbor'); });
  cy.on('mouseout', 'edge', (event) => { const edge = event.target; edge.removeClass('is-hovered'); if (!edge.selected()) edge.connectedNodes().not('[isFocus = 1]').removeClass('route-neighbor'); });
  if (selectedRelationId) { const selectedEdge = cy.$id(selectedRelationId); selectedEdge.select(); selectedEdge.connectedNodes().not('[isFocus = 1]').addClass('route-neighbor'); }
}

function sourceLink(sourceId: string) {
  const source = sourceById.get(sourceId); if (!source) return `<span>${escapeHtml(sourceId)}</span>`; if (!source.url) return `<span>${escapeHtml(source.label)}</span>`;
  return `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)} <i class="ph ph-arrow-square-out" aria-hidden="true"></i></a>`;
}
function relationshipDirection(relationship: Relationship, personId: string) { if (relationship.direction === 'undirected' || relationship.direction === 'bidirectional') return '双向／无方向'; return relationship.fromPerson === personId ? '由此人物指向' : '指向此人物'; }
function renderInspector() {
  if (!currentModel) return; const person = currentModel.personMap.get(selectedPersonId) || originalPersonById.get(selectedPersonId);
  if (!person) { inspectorContent.innerHTML = '<div class="empty-state"><strong>请选择人物</strong><p>可从左侧索引或图中节点进入。</p></div>'; return; }
  const relationships = focusRelationships(currentModel); const identityPerson = originalPersonById.get(person.id) || person; const selectedIdentity = getSelectedIdentity(identityPerson); const selectedRelationship = relationships.find((relationship) => relationship.id === selectedRelationId);
  const selectedRelationshipHtml = selectedRelationship ? (() => {
    const otherId = selectedRelationship.fromPerson === person.id ? selectedRelationship.toPerson : selectedRelationship.fromPerson; const other = currentModel?.personMap.get(otherId) || originalPersonById.get(otherId);
    const from = currentModel?.personMap.get(selectedRelationship.fromPerson) || originalPersonById.get(selectedRelationship.fromPerson);
    const to = currentModel?.personMap.get(selectedRelationship.toPerson) || originalPersonById.get(selectedRelationship.toPerson);
    const headline = selectedRelationship.direction === 'undirected'
      ? `${from?.nameZh || selectedRelationship.fromPerson} — ${to?.nameZh || selectedRelationship.toPerson}`
      : `${from?.nameZh || selectedRelationship.fromPerson} → ${to?.nameZh || selectedRelationship.toPerson}`;
    return `<section class="selected-relation" aria-label="选中关系"><div class="section-kicker"><i class="ph ph-circle evidence-dot evidence-${selectedRelationship.evidenceLevel}" aria-hidden="true"></i>${escapeHtml(evidenceLabel[selectedRelationship.evidenceLevel])}</div><h3>${escapeHtml(headline)}</h3><p>${escapeHtml(selectedRelationship.type)} · ${escapeHtml(relationshipDirection(selectedRelationship, person.id))} · ${certaintyLabel[selectedRelationship.certainty]}确定度</p><div class="passage-list">${selectedRelationship.passages.map((passage) => `<code>${escapeHtml(passage)}</code>`).join('')}</div><div class="source-links">${selectedRelationship.sources.map(sourceLink).join('')}</div>${other ? `<button type="button" data-onclick="delegated" class="secondary-button" data-go-person="${escapeHtml(other.id)}">转到${escapeHtml(other.nameZh)}</button>` : ''}</section>`;
  })() : '';
  if (selectedRelationship) {
    const from = currentModel.personMap.get(selectedRelationship.fromPerson) || originalPersonById.get(selectedRelationship.fromPerson);
    const to = currentModel.personMap.get(selectedRelationship.toPerson) || originalPersonById.get(selectedRelationship.toPerson);
    evidenceRibbonTitle.textContent = `${from?.nameZh || selectedRelationship.fromPerson} · ${selectedRelationship.type} · ${to?.nameZh || selectedRelationship.toPerson}`;
    evidenceRibbonMeta.textContent = `${evidenceLabel[selectedRelationship.evidenceLevel]} · ${certaintyLabel[selectedRelationship.certainty]}确定度 · ${selectedRelationship.passages.join('、') || '出处待补'}`;
  }
  const relationRows = relationships.map((relationship) => {
    const otherId = relationship.fromPerson === person.id ? relationship.toPerson : relationship.fromPerson; const other = currentModel?.personMap.get(otherId) || originalPersonById.get(otherId);
    return `<button type="button" data-onclick="delegated" class="relation-row evidence-border-${relationship.evidenceLevel}" data-relation-id="${escapeHtml(relationship.id)}" aria-pressed="${relationship.id === selectedRelationId}"><span class="relation-row-main"><strong>${escapeHtml(other?.nameZh || otherId)}</strong><small>${escapeHtml(relationship.type)} · ${escapeHtml(relationshipDirection(relationship, person.id))}</small></span><span class="relation-row-meta"><span>${escapeHtml(evidenceLabel[relationship.evidenceLevel])}</span><span>${relationship.passages.length} 处</span><i class="ph ph-caret-right" aria-hidden="true"></i></span></button>`;
  }).join('');
  const mentionRows = person.mentions.slice(0, 24).map((mention) => `<li><code>${escapeHtml(mention.passage)}</code><span>${sourceLink(mention.sourceId)}</span></li>`).join(''); const moreMentions = Math.max(0, person.mentions.length - 24);
  inspectorContent.innerHTML = `
    <section class="person-summary"><div class="person-title-row"><i class="ph ph-user-circle large-person-icon" aria-hidden="true"></i><div><p class="eyebrow">选中人物</p><h3>${escapeHtml(person.nameZh)}</h3><p>${escapeHtml(person.nameLat || '')}</p></div></div><div class="person-era-line"><span class="era-badge prominent">${escapeHtml(person.era)}</span>${person.era === '旧约背景' ? '<span>此人物生活在旧约时期，但因被新约点名而收录。</span>' : ''}</div><div class="alias-line">${person.aliases.slice(0, 8).map((alias) => `<span>${escapeHtml(alias)}</span>`).join('')}</div><label class="identity-field" for="person-identity"><span>身份选项</span><select id="person-identity" ${identityPerson.identityOptions.length < 2 ? 'disabled' : ''}>${identityPerson.identityOptions.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === selectedIdentity?.id ? 'selected' : ''}>${escapeHtml(option.label)} · ${escapeHtml(option.status)}</option>`).join('')}</select></label>${person.notes ? `<p class="editor-note"><i class="ph ph-info" aria-hidden="true"></i>${escapeHtml(person.notes)}</p>` : ''}</section>
    ${selectedRelationshipHtml}
    <section class="inspector-section"><div class="section-heading"><h3>一度关系</h3><span>${relationships.length}</span></div><div class="relation-list">${relationRows || '<div class="empty-state compact"><strong>无匹配关系</strong><p>可调整专题或证据层。</p></div>'}</div></section>
    <details class="mention-details"><summary>新约出现位置 <span>${person.mentions.length}</span></summary><ul class="mention-list">${mentionRows}</ul>${moreMentions ? `<p class="list-limit-note">另有 ${moreMentions} 处；完整位置保存在公开数据文件中。</p>` : ''}</details>`;
  const identitySelect = document.getElementById('person-identity') as HTMLSelectElement | null; if (identitySelect) identitySelect.onchange = () => applyPersonIdentity(person.id, identitySelect.value);
}
function renderCountsAndMeta() {
  if (!data) return; document.getElementById('people-total')!.textContent = String(data.people.length); document.getElementById('relations-total')!.textContent = String(data.relationships.length); document.getElementById('dataset-version')!.textContent = `${data.meta.edition} · v${data.meta.version}`; reviewWarning.hidden = !data.meta.editorialReviewRequired;
}
function renderDataViews() {
  if (!data) return; const mappedSelected = computeMergeMapping().get(selectedPersonId); if (mappedSelected) selectedPersonId = mappedSelected; currentModel = buildVisibleModel();
  if (!currentModel.people.some((person) => person.id === selectedPersonId)) { const fallback = currentModel.people[0] || data.people.find((person) => person.nameZh === '保罗') || data.people[0]; selectedPersonId = fallback?.id || ''; currentModel = buildVisibleModel(); }
  if (selectedRelationId && !focusRelationships(currentModel).some((relationship) => relationship.id === selectedRelationId)) selectedRelationId = '';
  renderTopicControls(); renderAdvancedFilters(); renderPeopleList(); renderGraph(); renderInspector(); syncEvidenceControls(); syncUrlState();
}
function selectPerson(personId: string, switchPanel = false) {
  if (!currentModel) return; const mapped = currentModel.mergedTo.get(personId) || personId; if (!currentModel.personMap.has(mapped) && !originalPersonById.has(mapped)) return;
  selectedPersonId = mapped; selectedRelationId = ''; renderPeopleList(); renderGraph(); renderInspector(); syncUrlState(); if (switchPanel && window.matchMedia('(max-width: 900px)').matches) setMobilePanel('graph', true); else if (switchPanel) setDrawer('none');
}
function selectRelationship(relationshipId: string, switchPanel = false) { selectedRelationId = relationshipId; cy?.elements().unselect(); cy?.nodes().removeClass('route-neighbor'); const edge = cy?.$id(relationshipId); edge?.select(); edge?.connectedNodes().not('[isFocus = 1]').addClass('route-neighbor'); renderInspector(); if (switchPanel && window.matchMedia('(max-width: 900px)').matches) setMobilePanel('details', true); }
function setMobilePanel(panel: MobilePanel, focusPanel = false) {
  mobilePanel = panel; shell.dataset.mobilePanel = panel; document.querySelectorAll<HTMLButtonElement>('[data-mobile-target]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mobileTarget === panel)));
  if (!focusPanel || !window.matchMedia('(max-width: 900px)').matches) return;
  window.requestAnimationFrame(() => {
    const target = panel === 'details'
      ? document.getElementById('inspector-heading')
      : panel === 'people'
        ? document.getElementById('people-heading')
        : document.getElementById('graph-heading');
    target?.focus();
  });
}
function setDrawer(drawer: 'none' | 'people' | 'filters' | 'details', focusDrawer = false) {
  shell.dataset.drawer = drawer;
  document.querySelectorAll<HTMLButtonElement>('[data-drawer-target]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.drawerTarget === drawer)));
  if (!focusDrawer || drawer === 'none') return;
  window.requestAnimationFrame(() => (drawer === 'people' ? document.getElementById('people-heading') : document.getElementById('inspector-heading'))?.focus());
}
function syncUrlState() {
  const url = new URL(window.location.href); const set = (key: string, value: string, defaultValue = '') => value && value !== defaultValue ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  const evidenceValue = filters.evidences.size ? [...filters.evidences].sort().join(',') : 'none';
  set('q', filters.search); set('topic', filters.topic, 'all'); set('identity', identityPreset, 'conservative'); set('person', selectedPersonId); set('evidence', evidenceValue, [...ALL_EVIDENCE].sort().join(',')); set('eras', [...filters.eras].sort().join(',')); set('books', [...filters.books].sort().join(',')); set('types', [...filters.relations].sort().join(',')); window.history.replaceState(null, '', url);
}
function loadUrlState() {
  if (!data) return; const params = new URLSearchParams(window.location.search); const initialTopic = params.get('topic') || 'all'; applyTopic(data.topicPresets.some((topic) => topic.id === initialTopic) ? initialTopic : 'all', false);
  filters.search = params.get('q') || ''; searchInput.value = filters.search; clearSearchButton.hidden = !filters.search;
  const rawEvidence = params.get('evidence'); const evidence = rawEvidence?.split(',').filter((value): value is EvidenceLevel => ALL_EVIDENCE.includes(value as EvidenceLevel)); if (rawEvidence === 'none') filters.evidences = new Set(); else if (evidence?.length) filters.evidences = new Set(evidence);
  const eras = params.get('eras')?.split(',').filter(Boolean); const books = params.get('books')?.split(',').filter(Boolean); const types = params.get('types')?.split(',').filter(Boolean); if (eras?.length || books?.length || types?.length) { filters.eras = new Set(eras || []); filters.books = new Set(books || []); filters.relations = new Set(types || []); markFiltersCustom(); }
  const preset = params.get('identity'); setIdentityPreset(preset === 'traditional' ? 'traditional' : 'conservative', false); selectedPersonId = params.get('person') || data.people.find((person) => person.nameZh === '保罗')?.id || data.people[0]?.id || '';
}
function renderLoadError(message: string) {
  shell.setAttribute('aria-busy', 'false'); inspectorContent.innerHTML = `<div class="error-state" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i><strong>资料载入失败</strong><p>${escapeHtml(message)}</p><button id="retry-load" class="primary-button" type="button" data-onclick="direct">重新载入</button></div>`; document.getElementById('retry-load')?.addEventListener('click', () => void loadGraphData());
}
async function loadGraphData() {
  shell.setAttribute('aria-busy', 'true');
  try { const response = await fetch('./data/graph.json', { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); data = await response.json() as GraphData; rebuildIndexes(); loadUrlState(); renderCountsAndMeta(); renderDataViews(); shell.setAttribute('aria-busy', 'false'); }
  catch (error) { renderLoadError(error instanceof Error ? error.message : '未知错误'); }
}
function updateSearch(value: string) { filters.search = value.trim(); clearSearchButton.hidden = !filters.search; renderPeopleList(); if (filters.search && !window.matchMedia('(max-width: 900px)').matches) setDrawer('people'); syncUrlState(); }

searchInput.addEventListener('compositionstart', () => { isComposing = true; });
searchInput.addEventListener('compositionend', () => { isComposing = false; window.clearTimeout(searchTimer); updateSearch(searchInput.value); });
searchInput.addEventListener('input', () => { if (isComposing) return; window.clearTimeout(searchTimer); if (!searchInput.value) updateSearch(''); else searchTimer = window.setTimeout(() => updateSearch(searchInput.value), 300); });
clearSearchButton.addEventListener('click', () => { searchInput.value = ''; updateSearch(''); searchInput.focus(); });
topicSelect.addEventListener('change', () => { if (topicSelect.value !== 'custom') applyTopic(topicSelect.value); });
identityPresetSelect.addEventListener('change', () => { if (identityPresetSelect.value === 'conservative' || identityPresetSelect.value === 'traditional') setIdentityPreset(identityPresetSelect.value); });
topicShortcuts.addEventListener('click', (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-topic]'); if (button?.dataset.topic) applyTopic(button.dataset.topic); });
peopleList.addEventListener('click', (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-person-id]'); if (button?.dataset.personId) selectPerson(button.dataset.personId, true); });
peopleList.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return; const buttons = [...peopleList.querySelectorAll<HTMLButtonElement>('[data-person-id]')]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'ArrowDown' ? Math.min(buttons.length - 1, current + 1) : Math.max(0, current - 1); if (buttons[next]) { event.preventDefault(); buttons[next].focus(); }
});
inspectorContent.addEventListener('click', (event) => { const relationButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-relation-id]'); const personButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-go-person]'); if (relationButton?.dataset.relationId) selectRelationship(relationButton.dataset.relationId); if (personButton?.dataset.goPerson) selectPerson(personButton.dataset.goPerson); });
document.querySelector('.evidence-controls')?.addEventListener('change', (event) => { const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"]'); if (!input) return; const level = input.value as EvidenceLevel; if (input.checked) filters.evidences.add(level); else filters.evidences.delete(level); markFiltersCustom(); renderDataViews(); });
document.querySelector('.advanced-filters')?.addEventListener('change', (event) => { const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-filter-kind]'); if (!input) return; const targetSet = input.dataset.filterKind === 'book' ? filters.books : input.dataset.filterKind === 'era' ? filters.eras : filters.relations; if (input.checked) targetSet.add(input.value); else targetSet.delete(input.value); markFiltersCustom(); renderDataViews(); });
document.getElementById('clear-eras')?.addEventListener('click', () => { filters.eras.clear(); markFiltersCustom(); renderDataViews(); });
document.getElementById('clear-books')?.addEventListener('click', () => { filters.books.clear(); markFiltersCustom(); renderDataViews(); });
document.getElementById('clear-relations')?.addEventListener('click', () => { filters.relations.clear(); markFiltersCustom(); renderDataViews(); });
document.getElementById('reset-filters')?.addEventListener('click', () => applyTopic('all'));
document.querySelectorAll<HTMLButtonElement>('[data-mobile-target]').forEach((button) => button.addEventListener('click', () => setMobilePanel(button.dataset.mobileTarget as MobilePanel, button.classList.contains('mobile-close'))));
document.querySelectorAll<HTMLButtonElement>('[data-drawer-target]').forEach((button) => button.addEventListener('click', () => {
  if (window.matchMedia('(max-width: 900px)').matches) { setMobilePanel(button.dataset.drawerTarget === 'details' ? 'details' : 'people', true); return; }
  const target = button.dataset.drawerTarget === 'details' ? 'details' : button.dataset.drawerTarget === 'filters' ? 'filters' : 'people';
  setDrawer(shell.dataset.drawer === target ? 'none' : target, true);
  if (button.dataset.drawerTarget === 'filters') document.querySelector<HTMLDetailsElement>('.advanced-filters')?.setAttribute('open', '');
}));
document.querySelectorAll<HTMLButtonElement>('[data-drawer-close]').forEach((button) => button.addEventListener('click', () => setDrawer('none')));
document.getElementById('zoom-in')?.addEventListener('click', () => cy?.zoom({ level: Math.min(2.5, cy.zoom() * 1.2), renderedPosition: { x: graphContainer.clientWidth / 2, y: graphContainer.clientHeight / 2 } }));
document.getElementById('zoom-out')?.addEventListener('click', () => cy?.zoom({ level: Math.max(0.25, cy.zoom() / 1.2), renderedPosition: { x: graphContainer.clientWidth / 2, y: graphContainer.clientHeight / 2 } }));
document.getElementById('fit-graph')?.addEventListener('click', () => cy?.fit(undefined, 56));
document.getElementById('center-focus')?.addEventListener('click', () => { const focus = cy?.$id(selectedPersonId); if (focus?.length) cy?.animate({ center: { eles: focus }, zoom: Math.max(cy.zoom(), 0.9), duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220 }); });
let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (currentModel) renderGraph(); }, 160);
});
void loadGraphData();
