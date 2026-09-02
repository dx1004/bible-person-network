import './style-reference.css';
import './phosphor.css';
import cytoscape from 'cytoscape';

type EvidenceLevel = 'nt_text' | 'ot_text' | 'ancient' | 'modern' | 'inference';
type ReviewState = 'confirmed' | 'reviewed_uncertain';
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
  legacyIds?: string[];
  nameZh: string;
  nameLat: string;
  sex?: 'male' | 'female' | 'mixed' | 'unknown';
  aliases: string[];
  era: string;
  books: string[];
  testaments?: Array<'nt' | 'ot'>;
  testamentCounts?: { nt: number; ot: number };
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
  evidenceLevels?: EvidenceLevel[];
  evidenceLevel: EvidenceLevel;
  reviewState?: ReviewState;
  book: string;
  books: string[];
  testaments?: Array<'nt' | 'ot'>;
  era: string;
  sources: string[];
  passages: string[];
  identityGuards?: Array<{ personId: string; allowedIdentityOptions: string[] }>;
};

type PathStep = {
  fromPersonId: string;
  toPersonId: string;
  relationshipId: string;
  relationType: string | null;
  relationSubtype: string | null;
  relationDirection: string;
  traversalDirection: 'forward' | 'reverse';
  relationLabel: string;
  evidenceLevel: EvidenceLevel;
  certainty: 'high' | 'medium' | 'low';
  reviewState: ReviewState;
  passages: string[];
  source?: string | null;
};

type PathRoute = {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  pathLength: number;
  sourceLabel: string;
  targetLabel: string;
  steps: PathStep[];
  kinshipLabel?: { label: string } | null;
  pathPurpose: 'connection' | 'kinship_explanation';
  explainsRelationshipId?: string | null;
  routeDistance: 2 | 3 | 4;
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
  focusPersonId?: string;
  graphMode?: 'focus' | 'family_tree';
  personLabels?: Record<string, string>;
  personRanks?: Record<string, number>;
  personOrder?: string[];
};
type GraphData = {
  migration?: {
    sourceIdFormat?: string;
    outputIdFormat?: string;
    preservedLegacyIds?: boolean;
  };
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
  legacyIdMap?: Record<string, string>;
};
type FilterState = {
  search: string;
  books: Set<string>;
  relations: Set<string>;
  eras: Set<string>;
  evidences: Set<EvidenceLevel>;
  personIncludes: Set<string>;
  topic: string;
  scope: 'nt' | 'ot' | 'bible';
};
type VisibleModel = {
  people: Person[];
  relationships: Relationship[];
  personMap: Map<string, Person>;
  mergedTo: Map<string, string>;
};

const GRAPH_EDGE_LIMIT = 12;
const SEARCH_RESULT_LIMIT = 80;
const ALL_EVIDENCE: EvidenceLevel[] = ['nt_text', 'ot_text', 'ancient', 'modern', 'inference'];
const DEFAULT_SHOW_DIRECT_EDGES = true;
const DEFAULT_SHOW_PATH_EDGES = false;
const BASIC_KINSHIP_SUBTYPES = new Set(['parent', 'child', 'sibling', 'spouse', 'partner', 'concubine_partner']);
const EXPLAINABLE_KINSHIP_SUBTYPES = new Set(['grandparent', 'grandchild', 'uncle_aunt', 'nephew_niece', 'cousin', 'parent_in_law', 'child_in_law', 'sibling_in_law']);
const pathDistanceColor: Record<PathRoute['routeDistance'], string> = {
  2: '#d08a1e',
  3: '#2f7f49',
  4: '#8b62d9'
};
const evidenceLabel: Record<EvidenceLevel, string> = {
  nt_text: '新约经文',
  ot_text: '旧约经文',
  ancient: '古代原始史料',
  modern: '现代权威工具书',
  inference: '推论关系'
};
const reviewStateLabel: Record<ReviewState, string> = {
  confirmed: '已确认关系',
  reviewed_uncertain: '已复核但结论不确定'
};
const evidenceColor: Record<EvidenceLevel, string> = {
  nt_text: '#3478d4',
  ot_text: '#8b62d9',
  ancient: '#2f7f49',
  modern: '#df6159',
  inference: '#a06b22'
};
const reviewStateColor: Record<ReviewState, string> = {
  confirmed: '#557995',
  reviewed_uncertain: '#B7791F'
};
const certaintyLabel = { high: '高', medium: '中', low: '低' } as const;
function inferReviewState(relationship: Relationship): ReviewState {
  if (relationship.evidenceLevel === 'inference' || relationship.evidenceLevels?.includes('inference')) return 'reviewed_uncertain';
  if (relationship.certainty === 'low') return 'reviewed_uncertain';
  return 'confirmed';
}
function relationshipTypeClass(relationship: Relationship) {
  const raw = String(relationship.rawRelationType || '').split(':')[0];
  return `relation-type-${raw.replace(/[^a-z0-9_-]/g, '') || 'other'}`;
}
const relationshipShortLabel: Record<string, string> = {
  '亲属关系-父母': '父母',
  '亲属关系-子女': '子女',
  '亲属关系-手足': '手足',
  '亲属关系-配偶': '配偶',
  '亲属关系-祖父母': '祖父母',
  '亲属关系-孙辈': '孙辈',
  '亲属关系-叔伯姑舅姨': '叔伯姑舅姨',
  '亲属关系-侄甥': '侄甥',
  '亲属关系-堂表亲': '堂表亲',
  '亲属关系-岳父母/公婆': '岳父母／公婆',
  '亲属关系-儿媳/女婿': '儿媳／女婿',
  '亲属关系-姻亲手足': '姻亲手足',
  '亲属关系-继父母': '继父母',
  '亲属关系-继子女': '继子女',
  '亲属关系-其他': '亲属',
  '长期同工': '同工',
  '师徒': '师徒',
  '接待': '接待',
  '政治权属': '权属',
  '司法行为': '司法',
  '明确敌对': '敌对'
};

function relationshipDisplayLabel(relationship: Relationship, model?: VisibleModel) {
  if (relationship.rawRelationSubType !== 'parent') return relationshipShortLabel[relationship.type] || relationship.type;
  const subject = model?.personMap.get(relationship.fromPerson) || originalPersonById.get(relationship.fromPerson);
  if (subject?.sex === 'male') return '父亲';
  if (subject?.sex === 'female') return '母亲';
  return '父母';
}

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('app container is missing');

appRoot.innerHTML = `
  <div class="app-shell" data-mobile-panel="graph" data-drawer="none" aria-busy="true">
    <header class="topbar">
      <div class="brand-block">
        <div><h1>圣经人物关系网</h1><p>人物、关系与出处的可核查图谱</p></div>
      </div>
      <div class="global-search">
        <label class="sr-only" for="search">搜索人物中文名、别名、希腊文或拉丁转写</label>
        <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
        <input id="search" type="search" autocomplete="off" placeholder="搜索中文名、别名、希腊文或拉丁名" />
        <span class="search-shortcut" aria-hidden="true">⌘ K</span>
        <button id="clear-search" class="icon-button search-clear" type="button" data-onclick="direct" aria-label="清空搜索" hidden><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
      <div class="top-controls">
        <label class="compact-field" for="topic-select"><span>专题视图</span><select id="topic-select"></select></label>
        <label class="compact-field" for="scope-select"><span>范围</span><select id="scope-select"><option value="nt">新约</option><option value="ot">旧约</option><option value="bible">全圣经</option></select></label>
        <label class="compact-field" for="identity-preset"><span>身份预设</span><select id="identity-preset">
          <option value="conservative">全部保守</option><option value="traditional">常见传统</option><option value="custom" disabled>逐项自定义</option>
        </select></label>
        <div class="dataset-counts" aria-label="数据集计数">
          <div class="dataset-stat"><strong id="people-total">—</strong><span>人物</span></div>
          <div class="dataset-stat"><strong id="relations-total">—</strong><span>关系</span></div>
        </div>
        <button id="header-fit" class="header-action" type="button" data-onclick="direct"><i class="ph ph-layout" aria-hidden="true"></i><span>视图</span></button>
      <a class="header-action" href="https://github.com/dx1004/bible-person-network" target="_blank" rel="noopener noreferrer"><i class="ph ph-book-open" aria-hidden="true"></i><span>帮助</span></a>
      </div>
    </header>
    <div id="review-warning" class="review-warning reading-surface" role="status" hidden>
      <i class="ph ph-warning-circle" aria-hidden="true"></i><span>当前数据仍需要编辑审校，请勿把待审内容视为定稿。</span>
    </div>
    <nav class="mobile-tabs reading-surface" aria-label="移动端视图">
      <button type="button" data-onclick="direct" data-mobile-target="people"><i class="ph ph-users" aria-hidden="true"></i>人物</button>
      <button type="button" data-onclick="direct" data-mobile-target="graph" aria-pressed="true"><i class="ph ph-git-branch" aria-hidden="true"></i>图谱</button>
      <button type="button" data-onclick="direct" data-mobile-target="details"><i class="ph ph-book-open-text" aria-hidden="true"></i>详情</button>
    </nav>
    <main class="workspace">
      <aside class="people-pane reading-surface" aria-labelledby="people-heading">
        <div class="pane-heading"><div><p class="eyebrow">人物检索</p><h2 id="people-heading" tabindex="-1">搜索结果</h2></div><div class="pane-actions"><span id="people-result-count" class="count-badge">—</span><button class="icon-button drawer-close" type="button" data-onclick="delegated" data-drawer-close aria-label="关闭人物索引"><i class="ph ph-x" aria-hidden="true"></i></button></div></div>
        <label class="people-search" for="people-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input id="people-search" type="search" autocomplete="off" placeholder="搜索人物" /></label>
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
        <div class="graph-filterbar">
          <div class="topic-strip"><strong>专题视图：</strong><div id="topic-shortcuts" class="topic-shortcuts" aria-label="专题快捷选择"></div></div>
          <details class="graph-options">
            <summary><span><i class="ph ph-sliders-horizontal" aria-hidden="true"></i>筛选与显示</span><small id="evidence-summary-text">全部证据 · 直连关系</small><i class="ph ph-caret-down graph-options-caret" aria-hidden="true"></i></summary>
            <div class="graph-options-panel">
              <fieldset class="graph-option-group"><legend>证据层 <span>可多选</span></legend><div class="evidence-controls" role="group" aria-label="证据层筛选">
                ${ALL_EVIDENCE.map((level) => `<label class="evidence-toggle evidence-${level}"><input type="checkbox" value="${level}" checked><i class="ph ph-check-square" aria-hidden="true"></i>${evidenceLabel[level]}</label>`).join('')}
              </div></fieldset>
              <fieldset class="graph-option-group"><legend>关系显示</legend><div class="evidence-controls" role="group" aria-label="关系显示类型">
                <label class="evidence-toggle"><input type="checkbox" id="show-direct-edges" ${DEFAULT_SHOW_DIRECT_EDGES ? 'checked' : ''}><i class="ph ph-link-simple-horizontal" aria-hidden="true"></i>直连关系</label>
                <label class="evidence-toggle"><input type="checkbox" id="show-path-edges" ${DEFAULT_SHOW_PATH_EDGES ? 'checked' : ''}><i class="ph ph-path" aria-hidden="true"></i>联系路径（2-4度）</label>
              </div></fieldset>
            </div>
          </details>
        </div>
        <div class="graph-toolbar">
          <div class="focus-heading reading-surface"><p class="eyebrow">当前焦点 · 一度关系</p><h2 id="graph-heading" tabindex="-1">选择人物查看一度关系</h2><p id="focus-subtitle">点击人物节点切换焦点</p></div>
          <div class="graph-toolbar-actions">
            <button id="fit-graph" class="icon-button" type="button" data-onclick="direct" aria-label="适应画布"><i class="ph ph-arrows-out" aria-hidden="true"></i></button>
            <button id="center-focus" class="icon-button" type="button" data-onclick="direct" aria-label="回到焦点人物"><i class="ph ph-crosshair" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="graph-stage">
          <p id="graph-mode-note" class="graph-mode-note" hidden></p>
          <div id="graph" role="img" aria-label="选中人物的一度关系图；所有关系也可在右侧文字列表读取"></div>
          <div id="graph-empty" class="empty-state graph-empty" hidden><i class="ph ph-git-branch" aria-hidden="true"></i><strong>当前筛选下没有关系</strong><p>图谱已隐藏。可开启更多证据层、重置筛选，或更换焦点人物。</p></div>
          <div class="zoom-controls" aria-label="图谱缩放">
            <button id="zoom-in" class="icon-button" type="button" data-onclick="direct" aria-label="放大"><i class="ph ph-plus" aria-hidden="true"></i></button>
            <button id="zoom-out" class="icon-button" type="button" data-onclick="direct" aria-label="缩小"><i class="ph ph-minus" aria-hidden="true"></i></button>
          </div>
        </div>
        <details id="graph-legend" class="graph-legend reading-surface">
          <summary><i class="ph ph-info" aria-hidden="true"></i><span>图例</span><small>线条含义</small><i class="ph ph-caret-up graph-legend-caret" aria-hidden="true"></i></summary>
          <div class="legend-block"><section><strong>确认程度</strong><span class="legend-line review-confirmed">明确确认</span><span class="legend-line review-reviewed_uncertain">已复核／结论不确定</span></section><section><strong>线段类型</strong><span class="legend-line direct-relationship">直连关系</span><span class="legend-line path-edge">联系路径（2-4 度）</span></section><section><strong>证据来源</strong><span class="legend-line evidence-nt_text">新约经文</span><span class="legend-line evidence-ot_text">旧约经文</span><span class="legend-line evidence-ancient">古代原始史料</span><span class="legend-line evidence-modern">现代权威工具书</span><span class="legend-line evidence-inference">推论关系</span></section><section><strong>路径长度</strong><span class="legend-line path-distance-2">2 度路径</span><span class="legend-line path-distance-3">3 度路径</span><span class="legend-line path-distance-4">4 度路径</span></section></div>
        </details>
        <div class="sr-only" aria-live="polite"><strong id="evidence-ribbon-title">选择一条关系线查看出处</strong><span id="evidence-ribbon-meta">人物关系及出处会显示在右侧详情。</span><span id="graph-status">正在载入关系图…</span></div>
      </section>
      <aside class="inspector-pane reading-surface" aria-labelledby="inspector-heading">
        <div class="pane-heading inspector-heading"><div><p class="eyebrow">人物详情</p><h2 id="inspector-heading" tabindex="-1">人物与关系</h2></div><div class="pane-actions"><button id="fit-graph-inspector" class="icon-button inspector-fit" type="button" data-onclick="direct" aria-label="适应关系图"><i class="ph ph-arrows-out" aria-hidden="true"></i></button><button class="icon-button drawer-close mobile-close" type="button" data-onclick="direct" data-mobile-target="graph" data-drawer-close aria-label="关闭详情"><i class="ph ph-x" aria-hidden="true"></i></button></div></div>
        <div id="inspector-content" class="inspector-content"><div class="loading-state" role="status"><i class="ph ph-spinner-gap loader" aria-hidden="true"></i>正在载入资料…</div></div>
      </aside>
    </main>
    <footer class="site-footer">
      <div class="site-footer-metadata">
        <span id="dataset-version">数据版本载入中</span>
        <span>纯静态站点 · 不连接公开 Neo4j</span>
      </div>
      <nav class="site-footer-links" aria-label="资料与联系方式">
        <a class="site-footer-link" href="mailto:xunalinxu1004@coudx.com"><i class="ph ph-envelope-simple" aria-hidden="true"></i><span>联系：xunalinxu1004@coudx.com</span></a>
      <a class="site-footer-link" href="https://github.com/dx1004/bible-person-network" target="_blank" rel="noopener noreferrer">资料与代码 <i class="ph ph-arrow-square-out" aria-hidden="true"></i></a>
      </nav>
    </footer>
  </div>`;

const shell = document.querySelector('.app-shell') as HTMLDivElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const peopleSearchInput = document.getElementById('people-search') as HTMLInputElement;
const clearSearchButton = document.getElementById('clear-search') as HTMLButtonElement;
const topicSelect = document.getElementById('topic-select') as HTMLSelectElement;
const identityPresetSelect = document.getElementById('identity-preset') as HTMLSelectElement;
const scopeSelect = document.getElementById('scope-select') as HTMLSelectElement;
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
const graphModeNote = document.getElementById('graph-mode-note') as HTMLParagraphElement;
const focusSubtitle = document.getElementById('focus-subtitle')!;
const evidenceRibbonTitle = document.getElementById('evidence-ribbon-title')!;
const evidenceRibbonMeta = document.getElementById('evidence-ribbon-meta')!;
const evidenceSummaryText = document.getElementById('evidence-summary-text')!;
const showDirectEdgesInput = document.getElementById('show-direct-edges') as HTMLInputElement | null;
const showPathEdgesInput = document.getElementById('show-path-edges') as HTMLInputElement | null;
const inspectorContent = document.getElementById('inspector-content')!;
const reviewWarning = document.getElementById('review-warning') as HTMLDivElement;
const graphToolbarActions = document.querySelector('.graph-toolbar-actions') as HTMLDivElement;
const zoomControls = document.querySelector('.zoom-controls') as HTMLDivElement;
const fitGraphButton = document.getElementById('fit-graph') as HTMLButtonElement | null;
const headerFitButton = document.getElementById('header-fit') as HTMLButtonElement | null;
const fitGraphInspectorButton = document.getElementById('fit-graph-inspector') as HTMLButtonElement | null;
const centerFocusButton = document.getElementById('center-focus') as HTMLButtonElement | null;
const zoomInButton = document.getElementById('zoom-in') as HTMLButtonElement | null;
const zoomOutButton = document.getElementById('zoom-out') as HTMLButtonElement | null;

let data: GraphData | null = null;
let cy: cytoscape.Core | null = null;
let currentModel: VisibleModel | null = null;
let selectedPersonId = '';
let selectedRelationId = '';
let visiblePathRows: PathRoute[] = [];
let selectedPathId = '';
let showDirectEdges = DEFAULT_SHOW_DIRECT_EDGES;
let showPathEdges = DEFAULT_SHOW_PATH_EDGES;
let identityPreset: IdentityPreset = 'conservative';
let mobilePanel: MobilePanel = 'graph';
let searchTimer: number | undefined;
let isComposing = false;
const filters: FilterState = { search: '', books: new Set(), relations: new Set(), eras: new Set(), evidences: new Set(ALL_EVIDENCE), personIncludes: new Set(), topic: 'all', scope: 'bible' };
const identitySelection: Record<string, string> = {};
const originalPersonById = new Map<string, Person>();
const sourceById = new Map<string, Source>();
const mergeGroups = new Map<string, { members: Set<string>; targetPersonId: string | null }>();

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function normalize(value: unknown) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-Hans').trim(); }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function passageTestament(passage = '') {
  const book = String(passage || '').trim().toUpperCase().replace(/^STEP:/i, '').split(/\s+/)[0] || '';
  const ntSet = new Set(['LUK', 'ACT', 'MAT', 'MRK', 'JHN', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'COL', 'PHP', 'THA', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV']);
  if (ntSet.has(book)) return 'nt';
  if (!book || book === '新约') return 'nt';
  return 'ot';
}
function testamentSetFromBooks(books: string[] = []) {
  return unique(books.map((book) => passageTestament(`${book} 1:1`)));
}
function personTestaments(person: Person) {
  if (person.testaments?.length) return new Set(person.testaments);
  return new Set(testamentSetFromBooks(person.books));
}
function relationTestaments(relationship: Relationship) {
  if (relationship.testaments?.length) return new Set(relationship.testaments);
  const inferred = unique(relationship.passages.map((passage) => passageTestament(passage)));
  return new Set((inferred.length ? inferred : passageTestament(relationship.book) ? [passageTestament(relationship.book)] : []));
}
function isTraditionalOption(option: IdentityOption) {
  const status = normalize(option.statusRaw); const scope = normalize(option.scope); const preset = normalize(option.preset);
  return preset === 'traditional' || status === 'traditional' || status === 'disputed' || scope === 'common_tradition' || scope === 'common-tradition';
}
function isConservativeOption(option: IdentityOption) {
  const status = normalize(option.statusRaw); const scope = normalize(option.scope); const preset = normalize(option.preset);
  return preset === 'conservative' || status === 'independent' || status === 'conservative' || status === 'confirmed' || scope === 'default' || scope === 'conservative';
}
function isMergeTraditionalOption(option: IdentityOption) { return Boolean(option.mergeGroupId && option.mergeTargetPersonId && isTraditionalOption(option)); }
function resolvePersonId(personId: string) {
  const raw = String(personId || '').trim();
  if (!raw) return '';
  return (data?.legacyIdMap?.[raw] || raw);
}
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
  const familyTopicAcceptsKinship = (filters.topic === 'family' || filters.topic === 'herodFamily')
    && (relationship.rawRelationType === 'kinship' || relationship.rawRelationType?.startsWith('kinship:'));
  if (filters.relations.size && !filters.relations.has(relationship.type) && !familyTopicAcceptsKinship) return false;
  if (filters.eras.size) {
    const fromEra = personMap.get(relationship.fromPerson)?.era;
    const toEra = personMap.get(relationship.toPerson)?.era;
    if (!filters.eras.has(fromEra || '') && !filters.eras.has(toEra || '')) return false;
  }
  const evidenceLevels = relationship.evidenceLevels?.length ? relationship.evidenceLevels : [relationship.evidenceLevel];
  if (!evidenceLevels.some((level) => filters.evidences.has(level))) return false;
  if (filters.scope !== 'bible') {
    const relationshipScopes = relationTestaments(relationship);
    if (!relationshipScopes.has(filters.scope)) return false;
  }
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
  if (filters.scope !== 'bible') {
    people = people.filter((person) => {
      const personScopes = personTestaments(person);
      return filters.scope === 'nt' ? personScopes.has('nt') : filters.scope === 'ot' ? personScopes.has('ot') : true;
    });
  }
  if (filters.eras.size) people = people.filter((person) => filters.eras.has(person.era));
  if (relationshipNarrowed || mappedPersonIncludes.size) { const connected = new Set<string>(); relationships.forEach((relationship) => { connected.add(relationship.fromPerson); connected.add(relationship.toPerson); }); people = people.filter((person) => connected.has(person.id) || person.id === selectedPersonId); }
  people.sort((a, b) => a.nameZh.localeCompare(b.nameZh, 'zh-Hans'));
  return { people, relationships, personMap, mergedTo };
}
function personMatchesSearch(person: Person, term: string) { return !term || [personDisplayName(person), person.nameZh, person.nameLat, ...person.aliases].some((value) => normalize(value).includes(term)); }
function activeTopic() { return data?.topicPresets.find((topic) => topic.id === filters.topic); }
function personDisplayName(person?: Person) {
  if (!person) return '';
  return activeTopic()?.personLabels?.[person.id] || person.nameZh;
}

function applyTopic(topicId: string, rerender = true) {
  if (!data) return; const topic = data.topicPresets.find((candidate) => candidate.id === topicId); if (!topic) return;
  filters.topic = topic.id; filters.books = new Set(topic.bookIncludes || []); filters.relations = new Set(topic.relationTypes || []); filters.eras = new Set(topic.eraIncludes || []); filters.evidences = new Set(topic.evidenceIncludes?.length ? topic.evidenceIncludes : ALL_EVIDENCE); filters.personIncludes = new Set(topic.personIncludes || []);
  topicSelect.value = topic.id;
  syncEvidenceControls();
  if (topic.id !== 'all') {
    const topicModel = buildVisibleModel();
    const currentDegree = topicModel.relationships.filter((relationship) => relationship.fromPerson === selectedPersonId || relationship.toPerson === selectedPersonId).length;
    const preferredFocus = resolvePersonId(topic.focusPersonId || '');
    if (preferredFocus && topicModel.personMap.has(preferredFocus)) {
      selectedPersonId = preferredFocus;
      selectedRelationId = '';
    } else if (currentDegree === 0 && topicModel.relationships.length) {
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
function syncEvidenceControls() {
  document.querySelectorAll<HTMLInputElement>('.evidence-toggle input[type="checkbox"][value]').forEach((input) => {
    if (ALL_EVIDENCE.includes(input.value as EvidenceLevel)) input.checked = filters.evidences.has(input.value as EvidenceLevel);
  });
  const evidenceSummary = filters.evidences.size === ALL_EVIDENCE.length
    ? '全部证据'
    : filters.evidences.size === 0
      ? '未选证据'
      : `${filters.evidences.size} 项证据`;
  const displaySummary = [showDirectEdges ? '直连' : '', showPathEdges ? '路径' : ''].filter(Boolean).join(' + ') || '未显示关系';
  evidenceSummaryText.textContent = `${evidenceSummary} · ${displaySummary}`;
}
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
  matches.sort((a, b) => Number(b.id === selectedPersonId) - Number(a.id === selectedPersonId) || personDisplayName(a).localeCompare(personDisplayName(b), 'zh-Hans'));
  const shown = matches.slice(0, SEARCH_RESULT_LIMIT);
  peopleResultCount.textContent = term ? `${matches.length} 项` : `${currentModel.people.length} 人`; peopleEmpty.hidden = matches.length > 0; peopleList.hidden = matches.length === 0;
  peopleList.innerHTML = shown.map((person) => { const relationCount = currentModel?.relationships.filter((relationship) => relationship.fromPerson === person.id || relationship.toPerson === person.id).length || 0; const displayName = personDisplayName(person); const hasContextLabel = displayName !== person.nameZh; const aliasPreview = [hasContextLabel ? person.nameZh : '', ...person.aliases.slice(0, 2)].filter(Boolean).join(' · ') || person.nameLat; return `<button type="button" data-onclick="delegated" class="person-row${hasContextLabel ? ' topic-disambiguated' : ''}" data-person-id="${escapeHtml(person.id)}" aria-pressed="${person.id === selectedPersonId}"><i class="ph ph-user-circle person-icon" aria-hidden="true"></i><span class="person-row-copy"><span class="person-name-line"><strong>${escapeHtml(displayName)}</strong><span class="era-badge">${escapeHtml(person.era)}</span></span><small>${escapeHtml(aliasPreview)}</small></span><span class="relation-count" aria-label="${relationCount} 条当前关系">${relationCount}</span></button>`; }).join('');
  if (matches.length > SEARCH_RESULT_LIMIT) peopleList.insertAdjacentHTML('beforeend', `<p class="list-limit-note">另有 ${matches.length - SEARCH_RESULT_LIMIT} 项；继续输入可缩小范围。</p>`);
}
function relationshipPriority(relationship: Relationship) {
  const kinshipPriority = relationship.type.startsWith('亲属关系') ? 100 : 0;
  return kinshipPriority + ({ nt_text: 30, ot_text: 28, ancient: 20, modern: 10, inference: 8 }[relationship.evidenceLevel]) + ({ high: 3, medium: 2, low: 1 }[relationship.certainty]);
}
function focusRelationships(model: VisibleModel) { return model.relationships.filter((relationship) => relationship.fromPerson === selectedPersonId || relationship.toPerson === selectedPersonId).sort((a, b) => relationshipPriority(b) - relationshipPriority(a) || a.type.localeCompare(b.type, 'zh-Hans')); }

function primaryRelationshipsForGraph(relationships: Relationship[]) {
  const primaryByPair = new Map<string, Relationship>();
  for (const relationship of relationships) {
    const pairKey = [relationship.fromPerson, relationship.toPerson].sort().join('|');
    const current = primaryByPair.get(pairKey);
    if (!current || relationshipPriority(relationship) > relationshipPriority(current)) {
      primaryByPair.set(pairKey, relationship);
    }
  }
  return [...primaryByPair.values()].sort((a, b) => relationshipPriority(b) - relationshipPriority(a) || a.id.localeCompare(b.id));
}

function buildPathRoutes(model: VisibleModel, sourcePersonId: string): PathRoute[] {
  if (!model.personMap.has(sourcePersonId)) return [];
  type QueueItem = { personId: string; depth: number; steps: PathStep[] };
  const adjacency = new Map<string, Array<{ to: string; relationship: Relationship; traversalDirection: 'forward' | 'reverse' }>>();
  const addEdge = (fromPersonId: string, toPersonId: string, relationship: Relationship, traversalDirection: 'forward' | 'reverse') => {
    const existing = adjacency.get(fromPersonId) || [];
    existing.push({ to: toPersonId, relationship, traversalDirection });
    adjacency.set(fromPersonId, existing);
  };
  const connect = (relationship: Relationship) => {
    addEdge(relationship.fromPerson, relationship.toPerson, relationship, 'forward');
    addEdge(relationship.toPerson, relationship.fromPerson, relationship, 'reverse');
  };
  model.relationships.forEach(connect);
  for (const edges of adjacency.values()) {
    edges.sort((a, b) => a.to.localeCompare(b.to) || a.relationship.id.localeCompare(b.relationship.id));
  }
  const sourceLabel = personDisplayName(model.personMap.get(sourcePersonId));
  const shortestDepth = new Map<string, number>([[sourcePersonId, 0]]);
  const byTarget = new Map<string, PathStep[]>();
  const queue: QueueItem[] = [{ personId: sourcePersonId, depth: 0, steps: [] }];
  for (let i = 0; i < queue.length; i += 1) {
    const { personId, depth, steps } = queue[i];
    if (depth >= 4) continue;
    for (const edge of adjacency.get(personId) || []) {
      const nextDepth = depth + 1;
      if (nextDepth > 4) continue;
      const existingDepth = shortestDepth.get(edge.to);
      if (existingDepth !== undefined && existingDepth <= nextDepth) continue;
      const relationStep: PathStep = {
        fromPersonId: personId,
        toPersonId: edge.to,
        relationshipId: edge.relationship.id,
        relationType: edge.relationship.type || null,
        relationSubtype: edge.relationship.rawRelationSubType || edge.relationship.rawRelationType || null,
        relationDirection: edge.relationship.direction,
        traversalDirection: edge.traversalDirection,
        relationLabel: relationshipDisplayLabel(edge.relationship, model),
        evidenceLevel: edge.relationship.evidenceLevel,
        certainty: edge.relationship.certainty,
        reviewState: edge.relationship.reviewState || inferReviewState(edge.relationship),
        passages: edge.relationship.passages,
        source: personDisplayName(model.personMap.get(edge.relationship.fromPerson))
      };
      const nextSteps = steps.concat([relationStep]);
      if (nextDepth >= 2) byTarget.set(edge.to, nextSteps);
      shortestDepth.set(edge.to, nextDepth);
      queue.push({ personId: edge.to, depth: nextDepth, steps: nextSteps });
    }
  }
  const rows: PathRoute[] = [];
  for (const [targetPersonId, steps] of byTarget) {
    if (steps.length < 2 || steps.length > 4) continue;
    const targetPerson = model.personMap.get(targetPersonId);
    const targetLabel = personDisplayName(targetPerson);
    const routeDistance = steps.length as 2 | 3 | 4;
    if (!targetPerson || !targetLabel) continue;
    if (targetPersonId === sourcePersonId) continue;
    rows.push({
      id: `path-${sourcePersonId}-${targetPersonId}-${steps.length}`,
      sourcePersonId,
      targetPersonId,
      sourceLabel,
      targetLabel,
      pathLength: steps.length,
      steps,
      routeDistance,
      kinshipLabel: null,
      pathPurpose: 'connection',
      explainsRelationshipId: null
    });
  }

  for (const directRelationship of model.relationships) {
    if (directRelationship.fromPerson !== sourcePersonId && directRelationship.toPerson !== sourcePersonId) continue;
    if (!EXPLAINABLE_KINSHIP_SUBTYPES.has(directRelationship.rawRelationSubType || '')) continue;
    const targetPersonId = directRelationship.fromPerson === sourcePersonId ? directRelationship.toPerson : directRelationship.fromPerson;
    const queue: QueueItem[] = [{ personId: sourcePersonId, depth: 0, steps: [] }];
    const bestDepth = new Map<string, number>([[sourcePersonId, 0]]);
    let explanationSteps: PathStep[] | null = null;
    for (let index = 0; index < queue.length && !explanationSteps; index += 1) {
      const item = queue[index];
      if (item.depth >= 4) continue;
      for (const edge of adjacency.get(item.personId) || []) {
        if (edge.relationship.id === directRelationship.id) continue;
        if (!BASIC_KINSHIP_SUBTYPES.has(edge.relationship.rawRelationSubType || '')) continue;
        const nextDepth = item.depth + 1;
        if (edge.to === sourcePersonId || item.steps.some((step) => step.toPersonId === edge.to)) continue;
        if (edge.to === targetPersonId && nextDepth === 1) continue;
        const nextStep: PathStep = {
          fromPersonId: item.personId,
          toPersonId: edge.to,
          relationshipId: edge.relationship.id,
          relationType: edge.relationship.type || null,
          relationSubtype: edge.relationship.rawRelationSubType || edge.relationship.rawRelationType || null,
          relationDirection: edge.relationship.direction,
          traversalDirection: edge.traversalDirection,
          relationLabel: relationshipDisplayLabel(edge.relationship, model),
          evidenceLevel: edge.relationship.evidenceLevel,
          certainty: edge.relationship.certainty,
          reviewState: edge.relationship.reviewState || inferReviewState(edge.relationship),
          passages: edge.relationship.passages,
          source: personDisplayName(model.personMap.get(edge.relationship.fromPerson))
        };
        const nextSteps = item.steps.concat([nextStep]);
        if (edge.to === targetPersonId && nextDepth >= 2 && nextDepth <= 4) {
          explanationSteps = nextSteps;
          break;
        }
        const previousDepth = bestDepth.get(edge.to);
        if (previousDepth !== undefined && previousDepth <= nextDepth) continue;
        bestDepth.set(edge.to, nextDepth);
        queue.push({ personId: edge.to, depth: nextDepth, steps: nextSteps });
      }
    }
    if (!explanationSteps) continue;
    const targetPerson = model.personMap.get(targetPersonId);
    if (!targetPerson) continue;
    const routeDistance = explanationSteps.length as 2 | 3 | 4;
    rows.push({
      id: `path-explain-${directRelationship.id}-${sourcePersonId}-${targetPersonId}`,
      sourcePersonId,
      targetPersonId,
      sourceLabel,
      targetLabel: personDisplayName(targetPerson),
      pathLength: explanationSteps.length,
      steps: explanationSteps,
      routeDistance,
      kinshipLabel: { label: relationshipDisplayLabel(directRelationship, model) },
      pathPurpose: 'kinship_explanation',
      explainsRelationshipId: directRelationship.id
    });
  }

  rows.sort((a, b) => Number(b.pathPurpose === 'kinship_explanation') - Number(a.pathPurpose === 'kinship_explanation') || a.pathLength - b.pathLength || a.targetLabel.localeCompare(b.targetLabel, 'zh-Hans'));
  return rows;
}
function pathRouteSummaryLabel(route: PathRoute) {
  if (!route.steps.length) return '';
  const chain = route.steps.map((step) => step.relationLabel || step.relationType || '关系').join(' → ');
  return route.pathPurpose === 'kinship_explanation' ? `构成${route.kinshipLabel?.label || '亲属关系'}：${chain}` : chain;
}

function pathDisplayElements(route: PathRoute) {
  return route.steps.map((step, index) => ({
    source: step.fromPersonId,
    target: step.toPersonId,
    id: `${route.id}-step-${index}`,
    relationLabel: index === 0 ? `路径 ${route.routeDistance} 度` : '',
    pathDistance: route.routeDistance,
    pathId: route.id,
    shortLabel: route.steps.length > 1 ? `第${index + 1}/${route.steps.length}步` : (step.relationLabel || '路径'),
    sourceArrow: step.relationDirection === 'bidirectional'
      ? 'triangle'
      : step.relationDirection === 'undirected'
        ? 'none'
        : ((step.relationDirection === 'outgoing') === (step.traversalDirection === 'reverse') ? 'triangle' : 'none'),
    targetArrow: step.relationDirection === 'bidirectional'
      ? 'triangle'
      : step.relationDirection === 'undirected'
        ? 'none'
        : ((step.relationDirection === 'outgoing') === (step.traversalDirection === 'forward') ? 'triangle' : 'none')
  }));
}

function familyRelationKind(relationship: Relationship) {
  if (['parent', 'child', 'grandparent', 'grandchild', 'step_parent', 'step_child'].includes(relationship.rawRelationSubType || '')) return 'parent';
  if (['spouse', 'partner', 'concubine_partner'].includes(relationship.rawRelationSubType || '')) return 'marriage';
  if (relationship.rawRelationType === 'kinship' || relationship.rawRelationType?.startsWith('kinship:')) return 'sibling';
  return 'other';
}
function familyTreeRelationships(model: VisibleModel) {
  const kindRank = { parent: 0, marriage: 1, sibling: 2, other: 3 } as const;
  return model.relationships
    .sort((a, b) => kindRank[familyRelationKind(a)] - kindRank[familyRelationKind(b)] || relationshipPriority(b) - relationshipPriority(a));
}

function focusFamilyRelationships(model: VisibleModel) {
  const kindRank = { parent: 0, marriage: 1, sibling: 2, other: 3 } as const;
  const direct = focusRelationships(model).filter((relationship) => familyRelationKind(relationship) !== 'other');
  const directFamilyIds = new Set([selectedPersonId, ...direct.flatMap((relationship) => [relationship.fromPerson, relationship.toPerson])]);
  const related = model.relationships.filter((relationship) =>
    familyRelationKind(relationship) !== 'other' && (directFamilyIds.has(relationship.fromPerson) || directFamilyIds.has(relationship.toPerson))
  );
  return [...new Map(related.map((relationship) => [relationship.id, relationship])).values()]
    .sort((a, b) => kindRank[familyRelationKind(a)] - kindRank[familyRelationKind(b)] || relationshipPriority(b) - relationshipPriority(a));
}

function familyTreeRanks(relationships: Relationship[], nodeIds: Set<string>, topic?: TopicPreset) {
  const ranks = new Map<string, number>();
  const parentsByChild = new Map<string, string[]>();
  const childrenByParent = new Map<string, string[]>();
  const siblings = new Set<string>();
  const partners = new Set<string>();
  for (const relationship of relationships) {
    const kind = familyRelationKind(relationship);
    if (kind === 'parent') {
      const parents = parentsByChild.get(relationship.toPerson) || [];
      const children = childrenByParent.get(relationship.fromPerson) || [];
      parents.push(relationship.fromPerson); children.push(relationship.toPerson);
      parentsByChild.set(relationship.toPerson, parents); childrenByParent.set(relationship.fromPerson, children);
    }
    const other = relationship.fromPerson === selectedPersonId ? relationship.toPerson : relationship.fromPerson;
    if (relationship.fromPerson === selectedPersonId || relationship.toPerson === selectedPersonId) {
      if (kind === 'sibling') siblings.add(other);
      if (kind === 'marriage') partners.add(other);
    }
  }
  ranks.set(selectedPersonId, 0);
  const assignLineage = (initial: string[], step: number, startRank: number) => {
    const queue = initial.map((personId) => ({ personId, rank: startRank }));
    while (queue.length) {
      const { personId, rank } = queue.shift()!;
      if (!nodeIds.has(personId) || ranks.has(personId)) continue;
      ranks.set(personId, rank);
      const next = step < 0 ? (parentsByChild.get(personId) || []) : (childrenByParent.get(personId) || []);
      next.forEach((nextPersonId) => queue.push({ personId: nextPersonId, rank: rank + step }));
    }
  };
  assignLineage(parentsByChild.get(selectedPersonId) || [], -1, -1);
  for (const siblingId of siblings) if (nodeIds.has(siblingId)) ranks.set(siblingId, 1);
  for (const partnerId of partners) if (nodeIds.has(partnerId)) ranks.set(partnerId, 0);
  assignLineage(childrenByParent.get(selectedPersonId) || [], 1, siblings.size ? 2 : 1);
  for (const personId of nodeIds) if (!ranks.has(personId)) ranks.set(personId, topic?.personRanks?.[personId] ?? 1);
  return ranks;
}

function focusRelationshipRank(relationship: Relationship) {
  if (relationship.direction === 'undirected' || relationship.direction === 'bidirectional') return 1;
  const focusIsSource = relationship.fromPerson === selectedPersonId;
  const focusStartsRelationship = relationship.direction === 'incoming' ? !focusIsSource : focusIsSource;
  return focusStartsRelationship ? 1 : -1;
}

function connectedTopicRelationships(model: VisibleModel) {
  const adjacency = new Map<string, Relationship[]>();
  for (const relationship of model.relationships) {
    const from = adjacency.get(relationship.fromPerson) || [];
    const to = adjacency.get(relationship.toPerson) || [];
    from.push(relationship); to.push(relationship);
    adjacency.set(relationship.fromPerson, from); adjacency.set(relationship.toPerson, to);
  }
  const included = new Set<string>([selectedPersonId]);
  const queue = [selectedPersonId];
  while (queue.length) {
    const personId = queue.shift()!;
    for (const relationship of adjacency.get(personId) || []) {
      const neighbor = relationship.fromPerson === personId ? relationship.toPerson : relationship.fromPerson;
      if (!included.has(neighbor)) { included.add(neighbor); queue.push(neighbor); }
    }
  }
  return model.relationships.filter((relationship) => included.has(relationship.fromPerson) && included.has(relationship.toPerson));
}

function pyramidPositions(
  relationships: Relationship[],
  width: number,
  height: number,
  compact: boolean,
  includeConnectedNetwork = false
) {
  const positions = new Map<string, { x: number; y: number }>();
  const ranks = new Map<string, number>([[selectedPersonId, 0]]);
  const priorities = new Map<string, number>();

  if (includeConnectedNetwork) {
    const adjacency = new Map<string, Relationship[]>();
    for (const relationship of relationships) {
      const from = adjacency.get(relationship.fromPerson) || [];
      const to = adjacency.get(relationship.toPerson) || [];
      from.push(relationship); to.push(relationship);
      adjacency.set(relationship.fromPerson, from); adjacency.set(relationship.toPerson, to);
    }
    const queue = [selectedPersonId];
    while (queue.length) {
      const current = queue.shift()!;
      const currentRank = ranks.get(current) || 0;
      for (const relationship of adjacency.get(current) || []) {
        const isSource = relationship.fromPerson === current;
        const next = isSource ? relationship.toPerson : relationship.fromPerson;
        if (ranks.has(next)) continue;
        const directionalStep = relationship.direction === 'undirected' || relationship.direction === 'bidirectional'
          ? (currentRank < 0 ? 1 : -1)
          : (relationship.direction === 'incoming' ? -1 : 1) * (isSource ? 1 : -1);
        ranks.set(next, currentRank + directionalStep);
        priorities.set(next, relationshipPriority(relationship));
        queue.push(next);
      }
    }
  } else {
    for (const relationship of relationships) {
      const personId = relationship.fromPerson === selectedPersonId ? relationship.toPerson : relationship.fromPerson;
      const rank = focusRelationshipRank(relationship);
      const priority = relationshipPriority(relationship);
      if (!ranks.has(personId) || priority > (priorities.get(personId) || -1)) {
        ranks.set(personId, rank);
        priorities.set(personId, priority);
      }
    }
  }

  const rows = new Map<number, string[]>();
  for (const [personId, rank] of ranks) {
    const row = rows.get(rank) || [];
    row.push(personId);
    rows.set(rank, row);
  }
  const rankValues = [...rows.keys()].sort((a, b) => a - b);
  const hasAbove = rankValues.some((rank) => rank < 0);
  const hasBelow = rankValues.some((rank) => rank > 0);
  const yByRank = new Map<number, number>();
  const top = hasAbove && hasBelow ? 0.12 : 0.22;
  const bottom = hasAbove && hasBelow ? 0.84 : 0.78;
  rankValues.forEach((rank, index) => yByRank.set(rank, rankValues.length === 1 ? height * 0.5 : height * (top + ((bottom - top) * index) / (rankValues.length - 1))));

  for (const [rank, personIds] of rows) {
    const ordered = personIds.sort((a, b) => {
      if (a === selectedPersonId) return -1;
      if (b === selectedPersonId) return 1;
      const aPerson = currentModel?.personMap.get(a) || originalPersonById.get(a);
      const bPerson = currentModel?.personMap.get(b) || originalPersonById.get(b);
      return personDisplayName(aPerson).localeCompare(personDisplayName(bPerson), 'zh-Hans');
    });
    const y = yByRank.get(rank) || height * 0.5;
    const perRow = compact ? 5 : 7;
    const chunks: string[][] = [];
    for (let index = 0; index < ordered.length; index += perRow) chunks.push(ordered.slice(index, index + perRow));
    if (rank > 0) chunks.reverse();
    const rootY = yByRank.get(0) || height * 0.5;
    const rowSpread = chunks.length > 1 ? Math.min(Math.abs(rootY - y) * 0.7, height * 0.34) : 0;
    chunks.forEach((chunk, rowIndex) => {
      const directionToFocus = Math.sign(rootY - y);
      const rowY = chunks.length === 1 ? y : y + (directionToFocus * rowSpread * rowIndex) / (chunks.length - 1);
      chunk.forEach((personId, index) => {
        const x = chunk.length === 1 ? width * 0.5 : width * ((compact ? 0.14 : 0.18) + ((compact ? 0.72 : 0.64) * index) / (chunk.length - 1));
        positions.set(personId, { x, y: rowY });
      });
    });
  }
  return positions;
}

function fitGraphComfortably() {
  if (!cy) return;
  const compact = window.innerWidth <= 620;
  cy.fit(undefined, compact ? 30 : 64);
  const comfortableMaxZoom = compact ? 0.98 : 1.08;
  if (cy.zoom() > comfortableMaxZoom) {
    cy.zoom(comfortableMaxZoom);
    cy.center();
  }
}

function renderGraph() {
  if (!currentModel) return;
  const selected = currentModel.personMap.get(selectedPersonId) || originalPersonById.get(selectedPersonId);
  if (!selected) return;
  const topic = activeTopic();
  const isFamilyTree = topic?.graphMode === 'family_tree';
  const isFamilyTopic = topic?.id === 'family';
  const isTopicPyramid = Boolean(topic && topic.id !== 'all' && filters.topic !== 'custom');
  const isPyramid = !isFamilyTree;
  const selectedName = personDisplayName(selected);
  const relationships = isFamilyTree
    ? isFamilyTopic
      ? focusFamilyRelationships(currentModel)
      : familyTreeRelationships(currentModel)
    : isTopicPyramid ? connectedTopicRelationships(currentModel) : focusRelationships(currentModel);

  const allowPathRoutes = showPathEdges;
  visiblePathRows = allowPathRoutes ? buildPathRoutes(currentModel, selectedPersonId) : [];
  const selectedPath = visiblePathRows.find((route) => route.id === selectedPathId);
  const pathRowsForRender = selectedPath
    ? [selectedPath]
    : showPathEdges && visiblePathRows.length
      ? [visiblePathRows[0]]
      : [];

  const canShowDirect = isFamilyTree || showDirectEdges;
  const allDirectRelationships = canShowDirect ? relationships : [];
  const renderDirect = primaryRelationshipsForGraph(allDirectRelationships);
  const foldedRelationshipCount = allDirectRelationships.length - renderDirect.length;
  const hasDirect = renderDirect.length > 0;
  const hasPath = pathRowsForRender.length > 0;
  const hasRenderable = hasDirect || hasPath;

  graphHeading.textContent = isFamilyTree ? `${topic?.name || '家族'}谱系` : isTopicPyramid ? `${topic?.name || '专题'}关系层级` : `${selectedName}的关系层级`;
  graphModeNote.hidden = false;
  graphModeNote.textContent = isFamilyTree
    ? '谱系视图 · 年长辈在上 · 手足在下 · 子女／后代更下 · 实线：父母／祖先 · 点线：手足 · 虚线：婚姻'
    : isTopicPyramid
      ? '专题关系层级图 · 保留焦点人物所在关系网，按方向分层排列'
      : '层级关系图 · 直连关系与路径（2-4 度）并列显示';
  graphContainer.setAttribute('aria-label', isFamilyTree ? '家族代际关系图；点选人物后可在右侧读取全部关系和出处' : '焦点人物视图；点击关系或路径后可在右侧读取类型与出处');

  if (!hasRenderable) {
    if (cy) {
      cy.destroy();
      cy = null;
    }
    graphContainer.hidden = true;
    graphToolbarActions.hidden = true;
    zoomControls.hidden = true;
    graphEmpty.hidden = false;
    focusSubtitle.textContent = `${selected.era} · 无可显示边`;
    evidenceRibbonTitle.textContent = `${selectedName} · 无可显示边`;
    evidenceRibbonMeta.textContent = '当前筛选下无可显示关系或路径，图谱已隐藏。可开启更多证据层、打开关系类型开关，或更换焦点人物。';
    graphStatus.textContent = '当前筛选下无可显示边。';
    return;
  }

  graphContainer.hidden = false;
  graphToolbarActions.hidden = false;
  zoomControls.hidden = false;
  graphEmpty.hidden = true;

  const isCompactGraph = window.innerWidth <= 620;
  const edgeLimit = isFamilyTree
    ? (isFamilyTopic ? (isCompactGraph ? 12 : 20) : (isCompactGraph ? 6 : 10))
    : isTopicPyramid ? (isCompactGraph ? 10 : 24) : (isCompactGraph ? 6 : GRAPH_EDGE_LIMIT);
  const directRelationships = renderDirect.slice(0, edgeLimit);
  const directRelationNodes = new Set<string>([selectedPersonId]);
  directRelationships.forEach((relationship) => { directRelationNodes.add(relationship.fromPerson); directRelationNodes.add(relationship.toPerson); });
  const pathNodes = new Set<string>();
  pathRowsForRender.forEach((route) => {
    pathNodes.add(route.targetPersonId);
    for (const step of route.steps) pathNodes.add(step.toPersonId);
  });
  const nodeIds = new Set([...directRelationNodes, ...pathNodes, selectedPersonId]);
  const nodes = [...nodeIds].map((personId) => currentModel?.personMap.get(personId) || originalPersonById.get(personId)).filter((person): person is Person => Boolean(person));

  const width = Math.max(graphContainer.clientWidth, 320);
  const visibleStageHeight = graphContainer.parentElement?.clientHeight || graphContainer.clientHeight;
  const height = Math.max(visibleStageHeight, 300);
  const hasPathSection = hasPath;
  graphStatus.textContent = isFamilyTree
    ? `家族图显示 ${directRelationships.length}/${currentModel.relationships.length} 条结构关系；重复手足线已折叠，点选人物可查看全部关系。`
    : hasPathSection
      ? `层级图显示 ${directRelationships.length} 条直接关系 + ${pathRowsForRender.length} 条路径；路径长度为 2–4 度。`
      : `当前显示 ${nodes.length} 人 · ${directRelationships.length} 条主要直接关系${foldedRelationshipCount ? ` · ${foldedRelationshipCount} 条并行关系可在详情展开` : ''}。`;
  focusSubtitle.textContent = isFamilyTree
    ? '年长辈在上；手足置于焦点下方；子女／后代再下移一层 · 点击人物查看详情'
    : isTopicPyramid
      ? `${topic?.name || '专题'} · ${renderDirect.length} 条连通关系 ${hasPathSection ? `，${pathRowsForRender.length} 条路径` : ''}`
      : `${selected.era} · ${renderDirect.length} 条当前关系 ${hasPathSection ? `，${pathRowsForRender.length} 条路径` : ''}`;
  evidenceRibbonTitle.textContent = isFamilyTree
    ? `${topic?.name || '家族'} · ${currentModel.relationships.length} 条已审关系`
    : `${selectedName} · ${renderDirect.length} 条直接关系 + ${pathRowsForRender.length} 条路径`;
  evidenceRibbonMeta.textContent = isFamilyTree
    ? '实线为父母／祖先，紫色点线为手足，虚线为婚姻；子女／后代比手足更靠下。点击关系查看出处。'
    : '路径仅用于显示连接方式，不表示新增关系；点击路径可查看链路。';

  const center = { x: width * 0.5, y: height * (isCompactGraph ? 0.46 : 0.48) };
  let positions = new Map<string, { x: number; y: number }>();
  if (isFamilyTree) {
    const order = new Map((topic?.personOrder || []).map((personId, index) => [personId, index]));
    const familyRanks = familyTreeRanks(directRelationships, new Set(nodes.map((node) => node.id)), topic);
    const rankGroups = new Map<number, string[]>();
    for (const node of nodes) {
      const rank = topic?.personRanks?.[node.id] ?? familyRanks.get(node.id) ?? 0;
      const group = rankGroups.get(rank) || [];
      group.push(node.id);
      rankGroups.set(rank, group);
    }
    const ranks = [...rankGroups.keys()].sort((a, b) => a - b);
    ranks.forEach((rank, rankIndex) => {
      const group = (rankGroups.get(rank) || []).sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
      const y = ranks.length === 1 ? center.y : height * (0.12 + (0.76 * rankIndex) / (ranks.length - 1));
      group.forEach((personId, index) => {
        const x = group.length === 1 ? center.x : width * (0.12 + (0.76 * index) / (group.length - 1));
        positions.set(personId, { x, y });
      });
    });
  } else if (isPyramid) {
    positions = pyramidPositions(directRelationships, width, height, isCompactGraph, isTopicPyramid);
  }

  [...nodes].forEach((node, index) => {
    if (positions.has(node.id)) return;
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    positions.set(node.id, { x: center.x + Math.cos(angle) * Math.min(width, height) * 0.36, y: center.y + Math.sin(angle) * Math.min(width, height) * 0.24 });
  });

  const relationLabelCount = new Map<string, number>();
  for (const relationship of directRelationships) {
    const label = relationshipDisplayLabel(relationship, currentModel || undefined);
    relationLabelCount.set(label, (relationLabelCount.get(label) || 0) + 1);
  }
  const firstLabelledRelation = new Set<string>();
  const pathEdgeElements = pathRowsForRender.flatMap((route) =>
    pathDisplayElements(route).map((pathEdge) => ({
      group: 'edges' as const,
      data: {
        id: pathEdge.id,
        source: pathEdge.source,
        target: pathEdge.target,
        label: pathEdge.relationLabel,
        shortLabel: pathEdge.shortLabel,
        edgeType: 'path',
        pathEdge: 1,
        pathId: pathEdge.pathId,
        pathDistance: String(pathEdge.pathDistance),
        pathColor: pathDistanceColor[pathEdge.pathDistance],
        sourceArrow: pathEdge.sourceArrow,
        targetArrow: pathEdge.targetArrow
      }
    }))
  );

  cy?.destroy();
  cy = cytoscape({
    container: graphContainer,
    elements: [
      ...nodes.map((person) => ({ group: 'nodes' as const, data: { id: person.id, label: personDisplayName(person), era: person.era, isFocus: person.id === selectedPersonId ? 1 : 0 }, position: positions.get(person.id) })),
      ...directRelationships.map((relationship) => {
        const sourceArrow = relationship.direction === 'incoming' || relationship.direction === 'bidirectional' ? 'triangle' : 'none';
        const targetArrow = relationship.direction === 'incoming' || relationship.direction === 'undirected' ? 'none' : 'triangle';
        const shortLabel = relationshipDisplayLabel(relationship, currentModel || undefined);
        const duplicateCount = relationLabelCount.get(shortLabel) || 0;
        const compressRepeatedLabels = duplicateCount > 3 && !isFamilyTree;
        const showSummaryLabel = compressRepeatedLabels && !firstLabelledRelation.has(shortLabel);
        if (showSummaryLabel) firstLabelledRelation.add(shortLabel);
        const reviewState = relationship.reviewState || inferReviewState(relationship);
        return {
          group: 'edges' as const,
          data: {
            id: relationship.id, source: relationship.fromPerson, target: relationship.toPerson, label: relationship.type,
            shortLabel: compressRepeatedLabels ? (showSummaryLabel ? `${shortLabel} × ${duplicateCount}` : '') : shortLabel,
            passage: relationship.passages[0] || '', direction: relationship.direction,
            certainty: relationship.certainty, evidenceColor: evidenceColor[relationship.evidenceLevel], reviewColor: reviewStateColor[reviewState], reviewState,
            relationKind: isFamilyTree ? familyRelationKind(relationship) : 'default', sourceArrow, targetArrow, edgeType: 'direct'
          }
        };
      }),
      ...pathEdgeElements
    ],
    style: [
      { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', color: '#16233a', 'font-family': 'Inter, PingFang SC, Noto Sans CJK SC, sans-serif', 'font-size': isCompactGraph ? 13 : 15, 'font-weight': 700, 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', 'text-max-width': (isFamilyTree || isPyramid) ? '104px' : '86px', 'background-color': '#f4f7fb', 'background-opacity': 1, 'border-color': '#6b98d8', 'border-width': 1.5, width: (isFamilyTree || isPyramid) ? (isCompactGraph ? 92 : 112) : (isCompactGraph ? 82 : 98), height: (isFamilyTree || isPyramid) ? (isCompactGraph ? 48 : 54) : (isCompactGraph ? 44 : 50), 'overlay-opacity': 0, 'underlay-opacity': 0 } },
      { selector: 'node[era = "旧约背景"]', style: { 'background-color': '#eef7ef', 'border-color': '#5e9470' } },
      { selector: 'node[era = "耶稣时期"]', style: { 'background-color': '#fff1ee', 'border-color': '#df8178' } },
      { selector: 'node[era = "时代待审"]', style: { opacity: 0.72 } },
      { selector: 'node[isFocus = 1]', style: { color: '#ffffff', 'background-color': '#3478d4', 'border-color': '#9fc4f3', 'border-width': 4, width: (isFamilyTree || isPyramid) ? (isCompactGraph ? 104 : 128) : (isCompactGraph ? 98 : 116), height: (isFamilyTree || isPyramid) ? (isCompactGraph ? 56 : 64) : (isCompactGraph ? 52 : 60), 'font-size': (isFamilyTree || isPyramid) ? (isCompactGraph ? 14 : 17) : (isCompactGraph ? 15 : 18), 'underlay-opacity': 0 } },
      { selector: 'node:selected', style: { 'border-color': '#245fae', 'border-width': 3 } },
      { selector: 'node.route-neighbor', style: { 'border-color': '#245fae', 'border-width': 3 } },
      { selector: 'edge', style: { width: (isFamilyTree || isPyramid) ? 1.8 : 1.5, 'curve-style': isFamilyTree ? 'bezier' : 'straight', 'control-point-step-size': isFamilyTree ? 34 : 40, 'line-color': 'data(reviewColor)', 'line-opacity': (isFamilyTree || isPyramid) ? 0.68 : 0.72, 'source-arrow-color': 'data(reviewColor)', 'target-arrow-color': 'data(reviewColor)', 'source-arrow-shape': 'data(sourceArrow)' as any, 'target-arrow-shape': 'data(targetArrow)' as any, 'arrow-scale': 0.62, label: 'data(shortLabel)', color: '#46546a', 'font-family': 'Inter, PingFang SC, Noto Sans CJK SC, sans-serif', 'font-size': isCompactGraph ? 10 : 11, 'font-weight': 600, 'text-rotation': isFamilyTree ? 'autorotate' : 'none', 'text-background-color': '#fffefa', 'text-background-opacity': 0.98, 'text-background-padding': '4', 'text-background-shape': 'roundrectangle', 'text-border-color': '#dfe5ec', 'text-border-width': 0.7, 'text-border-opacity': 0.9, 'overlay-opacity': 0, 'underlay-opacity': 0 } },
      { selector: 'edge[pathEdge = 1]', style: { 'line-color': 'data(pathColor)', 'source-arrow-color': 'data(pathColor)', 'target-arrow-color': 'data(pathColor)', width: 1.8, 'line-style': 'dashed', 'line-opacity': 0.8 } },
      { selector: 'edge[edgeType = "path"]', style: { 'line-style': 'dashed', 'width': 2.0 } },
      { selector: 'edge[edgeType = "direct"]', style: { 'line-style': 'solid', 'width': 1.8 } },
      { selector: 'edge[pathEdge = 1][pathDistance = "2"]', style: { width: 2.0 } },
      { selector: 'edge[pathEdge = 1][pathDistance = "3"]', style: { width: 1.8, 'line-style': 'dotted' } },
      { selector: 'edge[pathEdge = 1][pathDistance = "4"]', style: { width: 1.6, 'line-style': 'solid' } },
      { selector: 'edge[relationKind = "parent"]', style: { width: 2.2 } },
      { selector: 'edge[relationKind = "marriage"]', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none', 'source-arrow-shape': 'none' } },
      { selector: 'edge[relationKind = "sibling"]', style: { width: 1.6, 'line-style': 'dotted', 'target-arrow-shape': 'none', 'source-arrow-shape': 'none' } },
      { selector: 'edge[certainty = "low"]', style: { 'line-opacity': 0.72 } },
      { selector: 'edge[reviewState = "reviewed_uncertain"][relationKind = "default"]', style: { 'line-style': 'dashed' } },
      { selector: 'edge[reviewState = "reviewed_uncertain"][relationKind = "parent"]', style: { 'line-style': 'solid' } },
      { selector: 'edge[reviewState = "reviewed_uncertain"][relationKind = "sibling"]', style: { 'line-style': 'dotted' } },
      { selector: 'edge.is-hovered, edge:selected, edge.path-selected', style: { width: 3.2, 'line-opacity': 1, 'arrow-scale': 0.72, 'font-size': isCompactGraph ? 11 : 12, 'text-background-opacity': 1, 'underlay-color': '#d9e7fb', 'underlay-opacity': 0.45, 'underlay-padding': 3, 'z-index': 20 } }
    ],
    layout: { name: 'preset', fit: false, animate: false },
    minZoom: 0.25,
    maxZoom: 2.5,
    selectionType: 'single'
  });
  fitGraphComfortably();
  cy.on('tap', 'node', (event) => selectPerson(String(event.target.id()), true));
  cy.on('tap', 'edge', (event) => {
    const edge = event.target;
    if (!edge) return;
    const pathId = edge.data('pathId');
    if (edge.data('pathEdge') === 1 || edge.data('pathEdge') === '1') {
      selectPath(String(pathId || ''), true);
      return;
    }
    if (typeof pathId === 'string') selectPath(pathId, true);
    else selectRelationship(String(edge.id()), true);
  });
  cy.on('mouseover', 'edge', (event) => {
    const edge = event.target;
    edge.addClass('is-hovered');
    edge.connectedNodes().not('[isFocus = 1]').addClass('route-neighbor');
  });
  cy.on('mouseout', 'edge', (event) => {
    const edge = event.target;
    edge.removeClass('is-hovered');
    const isPathEdge = edge.data('pathEdge') === 1 || edge.data('pathEdge') === '1';
    if (!edge.selected() && !isPathEdge) edge.connectedNodes().not('[isFocus = 1]').removeClass('route-neighbor');
  });

  if (selectedRelationId && !selectedRelationId.startsWith('path-')) {
    const selectedEdge = cy.$id(selectedRelationId);
    selectedEdge.select();
    selectedEdge.connectedNodes().not('[isFocus = 1]').addClass('route-neighbor');
  } else if (selectedPathId) {
    cy.$(`edge[pathId="${selectedPathId}"]`).addClass('path-selected');
  }
}

function sourceLink(sourceId: string) {
  const source = sourceById.get(sourceId); if (!source) return `<span>${escapeHtml(sourceId)}</span>`; if (!source.url) return `<span>${escapeHtml(source.label)}</span>`;
  return `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)} <i class="ph ph-arrow-square-out" aria-hidden="true"></i></a>`;
}
function relationshipDirection(relationship: Relationship, personId: string) {
  if (relationship.direction === 'undirected' || relationship.direction === 'bidirectional') return '双向／无方向';
  if (relationship.direction === 'incoming') return relationship.fromPerson === personId ? '指向此人物' : '由此人物指向';
  return relationship.fromPerson === personId ? '由此人物指向' : '指向此人物';
}
function renderInspector() {
  if (!currentModel) return; const person = currentModel.personMap.get(selectedPersonId) || originalPersonById.get(selectedPersonId);
  if (!person) { inspectorContent.innerHTML = '<div class="empty-state"><strong>请选择人物</strong><p>可从左侧索引或图中节点进入。</p></div>'; return; }
  const relationships = focusRelationships(currentModel); const identityPerson = originalPersonById.get(person.id) || person; const selectedIdentity = getSelectedIdentity(identityPerson); const selectedRelationship = relationships.find((relationship) => relationship.id === selectedRelationId);
  const selectedPath = visiblePathRows.find((path) => path.id === selectedPathId);
  const selectedRelationshipHtml = selectedRelationship ? (() => {
    const otherId = selectedRelationship.fromPerson === person.id ? selectedRelationship.toPerson : selectedRelationship.fromPerson; const other = currentModel?.personMap.get(otherId) || originalPersonById.get(otherId);
    const from = currentModel?.personMap.get(selectedRelationship.fromPerson) || originalPersonById.get(selectedRelationship.fromPerson);
    const to = currentModel?.personMap.get(selectedRelationship.toPerson) || originalPersonById.get(selectedRelationship.toPerson);
    const headline = selectedRelationship.direction === 'undirected' || selectedRelationship.direction === 'bidirectional'
      ? `${personDisplayName(from)} ↔ ${personDisplayName(to)}`
      : `${personDisplayName(from)} → ${personDisplayName(to)}`;
    const selectedReviewState = selectedRelationship.reviewState || inferReviewState(selectedRelationship);
    return `<section class="selected-relation" aria-label="选中关系"><div class="section-kicker"><i class="ph ph-circle evidence-dot evidence-${selectedRelationship.evidenceLevel}" aria-hidden="true"></i>${escapeHtml(evidenceLabel[selectedRelationship.evidenceLevel])}<span class="relation-type-chip ${relationshipTypeClass(selectedRelationship)}">${escapeHtml(selectedRelationship.type)}</span><span class="relation-review-chip review-${selectedReviewState}">${escapeHtml(reviewStateLabel[selectedReviewState])}</span></div><h3>${escapeHtml(headline)}</h3><p>${escapeHtml(relationshipDirection(selectedRelationship, person.id))} · ${certaintyLabel[selectedRelationship.certainty]}确定度</p><div class="passage-list">${selectedRelationship.passages.map((passage) => `<code>${escapeHtml(passage)}</code>`).join('')}</div><div class="source-links">${selectedRelationship.sources.map(sourceLink).join('')}</div>${other ? `<button type="button" data-onclick="delegated" class="secondary-button" data-go-person="${escapeHtml(other.id)}">转到${escapeHtml(personDisplayName(other))}</button>` : ''}</section>`;
  })() : '';
  if (selectedRelationship) {
    const from = currentModel.personMap.get(selectedRelationship.fromPerson) || originalPersonById.get(selectedRelationship.fromPerson);
    const to = currentModel.personMap.get(selectedRelationship.toPerson) || originalPersonById.get(selectedRelationship.toPerson);
    const selectedReviewState = selectedRelationship.reviewState || inferReviewState(selectedRelationship);
    evidenceRibbonTitle.textContent = `${personDisplayName(from) || selectedRelationship.fromPerson} · ${selectedRelationship.type} · ${personDisplayName(to) || selectedRelationship.toPerson}`;
    evidenceRibbonMeta.textContent = `${evidenceLabel[selectedRelationship.evidenceLevel]} · ${reviewStateLabel[selectedReviewState]} · ${certaintyLabel[selectedRelationship.certainty]}确定度 · ${selectedRelationship.passages.join('、') || '出处待补'}`;
  }
  const selectedPathHtml = selectedPath ? (() => {
    const pathKind = selectedPath.pathPurpose === 'kinship_explanation' ? '亲属构成路径' : '联系路径';
    return `<section class="selected-relation" aria-label="选中路径"><div class="section-kicker"><i class="ph ph-git-branch"></i>${pathKind}（${selectedPath.routeDistance} 度）</div><h3>${escapeHtml(`${selectedPath.sourceLabel} → ${selectedPath.targetLabel}`)}</h3><p>${escapeHtml(pathRouteSummaryLabel(selectedPath))}</p><button type="button" data-onclick="delegated" class="secondary-button" data-go-person="${escapeHtml(selectedPath.targetPersonId)}">跳转到 ${escapeHtml(selectedPath.targetLabel)}</button></section>`;
  })() : '';
  if (selectedPath) {
    evidenceRibbonTitle.textContent = `${selectedPath.sourceLabel} → ${selectedPath.targetLabel}`;
    evidenceRibbonMeta.textContent = `路径长度：${selectedPath.routeDistance} 度 · 节点数：${selectedPath.steps.length + 1} · ${selectedPath.steps.map((step) => step.relationLabel || step.relationType || '关系').join(' → ')}`;
  }
  const relationRows = relationships.map((relationship) => {
    const otherId = relationship.fromPerson === person.id ? relationship.toPerson : relationship.fromPerson; const other = currentModel?.personMap.get(otherId) || originalPersonById.get(otherId);
    const relationshipState = relationship.reviewState || inferReviewState(relationship);
    return `<button type="button" data-onclick="delegated" class="relation-row evidence-border-${relationship.evidenceLevel} review-${relationshipState}" data-relation-id="${escapeHtml(relationship.id)}" aria-pressed="${relationship.id === selectedRelationId}"><span class="relation-row-main"><strong>${escapeHtml(personDisplayName(other) || otherId)}</strong><small><span class="relation-type-chip ${relationshipTypeClass(relationship)}">${escapeHtml(relationship.type)}</span>${escapeHtml(relationshipDirection(relationship, person.id))}</small></span><span class="relation-row-meta"><span>${escapeHtml(evidenceLabel[relationship.evidenceLevel])}</span><span>${escapeHtml(reviewStateLabel[relationshipState])}</span><span>${relationship.passages.length} 处</span><i class="ph ph-caret-right" aria-hidden="true"></i></span></button>`;
  }).join('');
  const scopedMentions = person.mentions.filter((mention) => {
    if (filters.scope === 'bible') return true;
    return passageTestament(mention.passage) === filters.scope;
  });
  const mentionRows = scopedMentions.slice(0, 24).map((mention) => `<li><code>${escapeHtml(mention.passage)}</code><span>${sourceLink(mention.sourceId)}</span></li>`).join('');
  const moreMentions = Math.max(0, scopedMentions.length - 24);
  const mentionScopeTitle = filters.scope === 'ot' ? '旧约' : filters.scope === 'nt' ? '新约' : '全书';
  const hasNT = (person.testamentCounts?.nt || 0) > 0;
  const hasOT = (person.testamentCounts?.ot || 0) > 0;
  const scopeSwitcher = filters.scope === 'nt'
    ? (hasNT && hasOT ? '<div class="alias-line"><button type="button" class="secondary-button" data-go-scope="ot">查看其旧约出处</button></div>' : '')
    : filters.scope === 'ot'
      ? (hasNT && hasOT ? '<div class="alias-line"><button type="button" class="secondary-button" data-go-scope="nt">查看其新约出处</button></div>' : '')
      : '';
  const pathRows = visiblePathRows.map((path) => `<button type="button" data-onclick="delegated" class="relation-row path-row${path.pathPurpose === 'kinship_explanation' ? ' kinship-explanation-row' : ''}" data-path-id="${escapeHtml(path.id)}" aria-pressed="${path.id === selectedPathId}"><span class="relation-row-main"><strong>${escapeHtml(path.targetLabel)}</strong><small>${escapeHtml(pathRouteSummaryLabel(path))}</small></span><span class="relation-row-meta"><span>${path.pathPurpose === 'kinship_explanation' ? '亲属构成' : '联系'} ${path.routeDistance} 度</span><span>${path.steps.length + 1} 节点</span><i class="ph ph-caret-right" aria-hidden="true"></i></span></button>`).join('');
  inspectorContent.innerHTML = `
      <section class="person-summary"><div class="person-title-row"><i class="ph ph-user-circle large-person-icon" aria-hidden="true"></i><div><p class="eyebrow">选中人物</p><h3>${escapeHtml(personDisplayName(person))}</h3><p>${escapeHtml(person.nameLat || '')}</p></div></div><div class="person-era-line"><span class="era-badge prominent">${escapeHtml(person.era)}</span>${person.era === '旧约背景' ? '<span>此人物生活在旧约时期，但因被新约点名而收录。</span>' : ''}</div><div class="alias-line">${personDisplayName(person) !== person.nameZh ? `<span>${escapeHtml(person.nameZh)}</span>` : ''}${person.aliases.slice(0, 8).map((alias) => `<span>${escapeHtml(alias)}</span>`).join('')}</div><label class="identity-field" for="person-identity"><span>身份选项</span><select id="person-identity" ${identityPerson.identityOptions.length < 2 ? 'disabled' : ''}>${identityPerson.identityOptions.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === selectedIdentity?.id ? 'selected' : ''}>${escapeHtml(option.label)} · ${escapeHtml(option.status)}</option>`).join('')}</select></label>${person.notes ? `<p class="editor-note"><i class="ph ph-info" aria-hidden="true"></i>${escapeHtml(person.notes)}</p>` : ''}</section>
    <section class="inspector-section"><div class="section-heading"><h3>关系总览</h3><span>${relationships.length}</span></div><div class="relation-list">${relationRows || '<div class="empty-state compact"><strong>无匹配关系</strong><p>可调整专题或证据层。</p></div>'}</div></section>
    <section class="inspector-section"><div class="section-heading"><h3>路径总览</h3><span>${visiblePathRows.length}</span></div><div class="relation-list">${pathRows || '<div class="empty-state compact"><strong>无可视路径</strong><p>可打开路径显示后查看 2-4 度关系链。</p></div>'}</div></section>
    ${selectedRelationshipHtml}
    ${selectedPathHtml}
    <details class="mention-details"><summary>${mentionScopeTitle}出现位置 <span>${scopedMentions.length}</span></summary><ul class="mention-list">${mentionRows}</ul>${moreMentions ? `<p class="list-limit-note">另有 ${moreMentions} 处；完整位置保存在公开数据文件中。</p>` : ''}</details>${scopeSwitcher}`;
  const identitySelect = document.getElementById('person-identity') as HTMLSelectElement | null; if (identitySelect) identitySelect.onchange = () => applyPersonIdentity(person.id, identitySelect.value);
}
function renderCountsAndMeta() {
  if (!data) return; document.getElementById('people-total')!.textContent = String(data.people.length); document.getElementById('relations-total')!.textContent = String(data.relationships.length); document.getElementById('dataset-version')!.textContent = `${data.meta.edition} · v${data.meta.version}`; reviewWarning.hidden = !data.meta.editorialReviewRequired;
}
function renderDataViews() {
  if (!data) return; const mappedSelected = computeMergeMapping().get(selectedPersonId); if (mappedSelected) selectedPersonId = mappedSelected; currentModel = buildVisibleModel();
  if (!currentModel.people.some((person) => person.id === selectedPersonId)) { const fallback = currentModel.people[0] || data.people.find((person) => person.nameZh === '保罗') || data.people[0]; selectedPersonId = fallback?.id || ''; currentModel = buildVisibleModel(); }
  const directRelationships = focusRelationships(currentModel);
  if (selectedRelationId && !directRelationships.some((relationship) => relationship.id === selectedRelationId)) selectedRelationId = '';
  if (!selectedRelationId && showDirectEdges) selectedRelationId = directRelationships[0]?.id || '';
  if (!showDirectEdges) selectedRelationId = '';
  if (!showPathEdges) selectedPathId = '';
  renderTopicControls(); renderAdvancedFilters(); renderPeopleList(); renderGraph(); renderInspector(); syncEvidenceControls(); syncUrlState();
}
function selectPerson(personId: string, switchPanel = false) {
  if (!currentModel) return;
  const resolved = resolvePersonId(personId);
  const mapped = currentModel.mergedTo.get(resolved) || resolved;
  if (!currentModel.personMap.has(mapped) && !originalPersonById.has(mapped)) return;
  selectedPersonId = mapped; selectedRelationId = focusRelationships(currentModel)[0]?.id || ''; selectedPathId = ''; renderPeopleList(); renderGraph(); renderInspector(); syncUrlState(); if (switchPanel && window.matchMedia('(max-width: 900px)').matches) setMobilePanel('graph', true); else if (switchPanel) setDrawer('none');
}
function selectRelationship(relationshipId: string, switchPanel = false) {
  selectedRelationId = relationshipId;
  selectedPathId = '';
  cy?.$('[pathId]').removeClass('path-selected');
  cy?.elements().unselect();
  cy?.nodes().removeClass('route-neighbor');
  const edge = cy?.$id(relationshipId);
  edge?.select();
  edge?.connectedNodes().not('[isFocus = 1]').addClass('route-neighbor');
  renderInspector();
  if (switchPanel && window.matchMedia('(max-width: 900px)').matches) setMobilePanel('details', true);
}
function selectPath(pathId: string, switchPanel = false) {
  if (!pathId) return;
  selectedPathId = pathId;
  selectedRelationId = '';
  cy?.$('[pathId]').removeClass('path-selected');
  cy?.elements().unselect();
  cy?.nodes().removeClass('route-neighbor');
  renderGraph();
  cy?.$(`edge[pathId="${pathId}"]`).addClass('path-selected');
  renderInspector();
  if (switchPanel && window.matchMedia('(max-width: 900px)').matches) setMobilePanel('details', true);
}
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
  set('q', filters.search);
  set('topic', filters.topic, 'all');
  set('identity', identityPreset, 'conservative');
  set('person', selectedPersonId);
  set('scope', filters.scope, 'bible');
  set('direct', showDirectEdges ? '1' : '0', '1');
  set('paths', showPathEdges ? '1' : '0', '0');
  set('evidence', evidenceValue, [...ALL_EVIDENCE].sort().join(','));
  const persistManualFilters = filters.topic === 'custom';
  set('eras', persistManualFilters ? [...filters.eras].sort().join(',') : '');
  set('books', persistManualFilters ? [...filters.books].sort().join(',') : '');
  set('types', persistManualFilters ? [...filters.relations].sort().join(',') : '');
  window.history.replaceState(null, '', url);
}
function loadUrlState() {
  if (!data) return; const params = new URLSearchParams(window.location.search); const requestedTopic = params.get('topic') || 'all'; const initialTopic = data.topicPresets.some((topic) => topic.id === requestedTopic) ? requestedTopic : 'all'; applyTopic(initialTopic, false);
  filters.search = params.get('q') || ''; searchInput.value = filters.search; peopleSearchInput.value = filters.search; clearSearchButton.hidden = !filters.search;
  const rawEvidence = params.get('evidence'); const evidence = rawEvidence?.split(',').filter((value): value is EvidenceLevel => ALL_EVIDENCE.includes(value as EvidenceLevel)); if (rawEvidence === 'none') filters.evidences = new Set(); else if (evidence?.length) filters.evidences = new Set(evidence);
  const rawScope = params.get('scope');
  filters.scope = rawScope === 'nt' || rawScope === 'ot' || rawScope === 'bible' ? rawScope : 'bible';
  scopeSelect.value = filters.scope;
  showDirectEdges = params.get('direct') !== '0';
  showPathEdges = params.get('paths') === '1';
  if (showDirectEdgesInput) showDirectEdgesInput.checked = showDirectEdges;
  if (showPathEdgesInput) showPathEdgesInput.checked = showPathEdges;
  const eras = params.get('eras')?.split(',').filter(Boolean); const books = params.get('books')?.split(',').filter(Boolean); const types = params.get('types')?.split(',').filter(Boolean); if (initialTopic === 'all' && (eras?.length || books?.length || types?.length)) { filters.eras = new Set(eras || []); filters.books = new Set(books || []); filters.relations = new Set(types || []); markFiltersCustom(); }
  const preset = params.get('identity'); setIdentityPreset(preset === 'traditional' ? 'traditional' : 'conservative', false);
  const requestedPerson = params.get('person');
  selectedPersonId = resolvePersonId(requestedPerson || '') || selectedPersonId || data.people.find((person) => person.nameZh === '保罗')?.id || data.people[0]?.id || '';
}
function renderLoadError(message: string) {
  shell.setAttribute('aria-busy', 'false'); inspectorContent.innerHTML = `<div class="error-state" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i><strong>资料载入失败</strong><p>${escapeHtml(message)}</p><button id="retry-load" class="primary-button" type="button" data-onclick="direct">重新载入</button></div>`; document.getElementById('retry-load')?.addEventListener('click', () => void loadGraphData());
}
async function loadGraphData() {
  shell.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('./data/graph.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loadedData = (await response.json()) as Omit<GraphData, 'relationships'> & { relationships: Relationship[] };
    const hydratedRelationships = loadedData.relationships.map((relationship) => ({
      ...relationship,
      reviewState: relationship.reviewState || inferReviewState(relationship)
    }));
    data = { ...loadedData, relationships: hydratedRelationships };
    rebuildIndexes();
    loadUrlState();
    renderCountsAndMeta();
    renderDataViews();
    shell.setAttribute('aria-busy', 'false');
  }
  catch (error) { renderLoadError(error instanceof Error ? error.message : '未知错误'); }
}
function updateSearch(value: string) { filters.search = value.trim(); searchInput.value = value; peopleSearchInput.value = value; clearSearchButton.hidden = !filters.search; renderPeopleList(); if (filters.search && !window.matchMedia('(max-width: 900px)').matches) setDrawer('people'); syncUrlState(); }

searchInput.addEventListener('compositionstart', () => { isComposing = true; });
searchInput.addEventListener('compositionend', () => { isComposing = false; window.clearTimeout(searchTimer); updateSearch(searchInput.value); });
searchInput.addEventListener('input', () => { if (isComposing) return; window.clearTimeout(searchTimer); if (!searchInput.value) updateSearch(''); else searchTimer = window.setTimeout(() => updateSearch(searchInput.value), 300); });
peopleSearchInput.addEventListener('compositionstart', () => { isComposing = true; });
peopleSearchInput.addEventListener('compositionend', () => { isComposing = false; window.clearTimeout(searchTimer); updateSearch(peopleSearchInput.value); });
peopleSearchInput.addEventListener('input', () => { if (isComposing) return; window.clearTimeout(searchTimer); if (!peopleSearchInput.value) updateSearch(''); else searchTimer = window.setTimeout(() => updateSearch(peopleSearchInput.value), 300); });
clearSearchButton.addEventListener('click', () => { searchInput.value = ''; updateSearch(''); searchInput.focus(); });
topicSelect.addEventListener('change', () => { if (topicSelect.value !== 'custom') applyTopic(topicSelect.value); });
identityPresetSelect.addEventListener('change', () => { if (identityPresetSelect.value === 'conservative' || identityPresetSelect.value === 'traditional') setIdentityPreset(identityPresetSelect.value); });
scopeSelect.addEventListener('change', () => {
  if (scopeSelect.value === 'nt' || scopeSelect.value === 'ot' || scopeSelect.value === 'bible') {
    filters.scope = scopeSelect.value;
    markFiltersCustom();
    renderDataViews();
  }
});
topicShortcuts.addEventListener('click', (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-topic]'); if (button?.dataset.topic) applyTopic(button.dataset.topic); });
peopleList.addEventListener('click', (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-person-id]'); if (button?.dataset.personId) selectPerson(button.dataset.personId, true); });
peopleList.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return; const buttons = [...peopleList.querySelectorAll<HTMLButtonElement>('[data-person-id]')]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'ArrowDown' ? Math.min(buttons.length - 1, current + 1) : Math.max(0, current - 1); if (buttons[next]) { event.preventDefault(); buttons[next].focus(); }
});
inspectorContent.addEventListener('click', (event) => {
  const relationButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-relation-id]');
  const pathButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-path-id]');
  const personButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-go-person]');
  const scopeButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-go-scope]');
  if (relationButton?.dataset.relationId) selectRelationship(relationButton.dataset.relationId);
  if (pathButton?.dataset.pathId) selectPath(pathButton.dataset.pathId);
  if (personButton?.dataset.goPerson) selectPerson(personButton.dataset.goPerson);
  if (scopeButton?.dataset.goScope === 'nt' || scopeButton?.dataset.goScope === 'ot') {
    filters.scope = scopeButton.dataset.goScope;
    scopeSelect.value = filters.scope;
    markFiltersCustom();
    renderDataViews();
  }
});
document.querySelector('.evidence-controls')?.addEventListener('change', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"]');
  if (!input || !(ALL_EVIDENCE.includes(input.value as EvidenceLevel))) return;
  const level = input.value as EvidenceLevel;
  if (input.checked) filters.evidences.add(level);
  else filters.evidences.delete(level);
  markFiltersCustom();
  renderDataViews();
});
showDirectEdgesInput?.addEventListener('change', (event) => {
  if (!showDirectEdgesInput) return;
  showDirectEdges = showDirectEdgesInput.checked;
  selectedRelationId = showDirectEdges ? selectedRelationId : '';
  syncEvidenceControls();
  renderDataViews();
});
showPathEdgesInput?.addEventListener('change', (event) => {
  if (!showPathEdgesInput) return;
  showPathEdges = showPathEdgesInput.checked;
  selectedPathId = '';
  syncEvidenceControls();
  renderDataViews();
});
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
zoomInButton?.addEventListener('click', () => {
  if (!cy) return;
  cy.zoom({ level: Math.min(2.5, cy.zoom() * 1.2), renderedPosition: { x: graphContainer.clientWidth / 2, y: graphContainer.clientHeight / 2 } });
});
zoomOutButton?.addEventListener('click', () => {
  if (!cy) return;
  cy.zoom({ level: Math.max(0.25, cy.zoom() / 1.2), renderedPosition: { x: graphContainer.clientWidth / 2, y: graphContainer.clientHeight / 2 } });
});
fitGraphButton?.addEventListener('click', fitGraphComfortably);
headerFitButton?.addEventListener('click', fitGraphComfortably);
fitGraphInspectorButton?.addEventListener('click', fitGraphComfortably);
centerFocusButton?.addEventListener('click', () => { const focus = cy?.$id(selectedPersonId); if (focus?.length) cy?.animate({ center: { eles: focus }, zoom: Math.max(cy.zoom(), 0.9), duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220 }); });
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); } });
let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (currentModel) renderGraph(); }, 160);
});
void loadGraphData();
