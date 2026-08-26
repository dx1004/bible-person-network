import './style.css';
import cytoscape from 'cytoscape';

type IdentityOption = {
  id: string;
  label: string;
  status: string;
  statusRaw?: string;
  scope?: string;
  preset?: string;
};

type Person = {
  id: string;
  nameZh: string;
  nameLat: string;
  aliases: string[];
  era: string;
  books: string[];
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
  evidenceLevel: 'nt_text' | 'ancient' | 'modern';
  book: string;
  era: string;
  sources: string[];
  passages: string[];
  identityGuards?: Array<{ personId: string; allowedIdentityOptions: string[] }>;
};

type Source = {
  id: string;
  label: string;
  kind: string;
  url?: string;
};

type TopicPreset = {
  id: string;
  name: string;
  relationTypes: string[];
  bookIncludes: string[];
  eraIncludes: string[];
  evidenceIncludes: string[];
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
  eras: Set<string>;
  relations: Set<string>;
  evidences: Set<string>;
  preset: string;
};

const relationTypeOrder = [
  '亲属关系-父母/祖先',
  '亲属关系-子女/后代',
  '亲属关系-手足',
  '亲属关系-婚姻/伴侣',
  '亲属关系-其他',
  '候选关系',
  '师徒',
  '长期同工',
  '差派',
  '接待',
  '政治权属',
  '司法行为',
  '明确敌对'
];
const evidenceLabel: Record<Relationship['evidenceLevel'], string> = {
  nt_text: '新约经文',
  ancient: '古代史料',
  modern: '现代工具书'
};

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('app container is missing');
const app = appRoot;

app.innerHTML = `
  <div class="layout fade-in">
    <main class="card">
      <header>
        <h1>新约人物关系网</h1>
        <p>静态关系图（基于 public/data/graph.json）</p>
        <p id="review-warning" style="display:none; margin:8px 0 0; padding:8px 10px; border-radius:8px; border:1px solid #f59e0b; background:#92400e33; color:#fcd34d; font-weight:600">候选资料，中文名/关系/身份仍待审，不可视为定稿。</p>
      </header>

      <div class="toolbar">
        <div class="field">
          <label for="search">人物别名/名称搜索</label>
          <input id="search" type="text" placeholder="输入中文名、别名或拉丁名" />
        </div>
        <div class="field">
          <label for="preset">专题预设</label>
          <select id="preset"></select>
        </div>
        <div class="field">
          <label for="identity-preset">身份预设</label>
          <select id="identity-preset">
            <option value="conservative">全部保守</option>
            <option value="traditional">全部传统</option>
          </select>
        </div>
      </div>

      <div class="filter-row">
        <div>
          <div class="chips" id="book-chips"></div>
        </div>
        <div class="pill-group">
          <strong>关系类型</strong>
          <div class="chips" id="relation-chips"></div>
        </div>
        <div class="pill-group">
          <strong>证据层级</strong>
          <div class="chips" id="evidence-chips"></div>
        </div>
        <div class="pill-group">
          <strong>时代</strong>
          <div class="chips" id="era-chips"></div>
        </div>
      </div>

      <div class="toolbar">
        <button class="btn" id="btn-reset">重置筛选</button>
      </div>

      <div class="graph-wrap">
        <div id="graph"></div>
      </div>
    </main>

    <aside class="card details">
      <section id="identityPanel">
        <h2>身份与关系详情</h2>
        <p class="muted">点击节点后，可在此查看关系、证据与来源；支持按人物逐项切换身份。</p>
      </section>
      <section id="detailPanel" class="fade-in"></section>
    </aside>
  </div>
`;

const graphContainer = document.getElementById('graph');
const searchInput = document.getElementById('search') as HTMLInputElement;
const presetSelect = document.getElementById('preset') as HTMLSelectElement;
const identityPresetSelect = document.getElementById('identity-preset') as HTMLSelectElement;
const reviewWarning = document.getElementById('review-warning') as HTMLParagraphElement;
const bookChips = document.getElementById('book-chips')!;
const relationChips = document.getElementById('relation-chips')!;
const evidenceChips = document.getElementById('evidence-chips')!;
const eraChips = document.getElementById('era-chips')!;
const detailPanel = document.getElementById('detailPanel')!;
const identityPanel = document.getElementById('identityPanel')!;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;

const selectedPersonState = { value: null as Person | null };
let data: GraphData | null = null;
let cy: cytoscape.Core | null = null;
const filters: FilterState = {
  search: '',
  books: new Set(),
  eras: new Set(),
  relations: new Set(),
  evidences: new Set(),
  preset: 'all'
};

const identitySelection: Record<string, string> = {};

function labelizeEvidence(level: Relationship['evidenceLevel']) {
  return evidenceLabel[level] ?? level;
}

function normalize(v: string) {
  return v.toLowerCase().trim();
}

function collectSourceLookup(sourceIds: string[]) {
  const map = new Map<string, Source>();
  for (const source of data?.sources ?? []) {
    map.set(source.id, source);
  }
  return sourceIds.map((id) => map.get(id)).filter((x): x is Source => Boolean(x));
}

function identityColor(person: Person, optionId: string): string {
  const option = person.identityOptions.find((x) => x.id === optionId);
  if (!option) return '#7dd3fc';
  const status = (option.statusRaw || option.status || '').toLowerCase();
  if (status.includes('pending') || status.includes('待判')) return '#fbbf24';
  if (status.includes('traditional') || status.includes('trad')) return '#8b5cf6';
  if (status.includes('independent') || status.includes('confirmed') || status.includes('确认') || status.includes('conservative') || status.includes('保守'))
    return '#34d399';
  return '#7dd3fc';
}

function isTraditionalOption(option: IdentityOption) {
  const status = String(option.statusRaw || '').toLowerCase();
  const scope = String(option.scope || '').toLowerCase();
  const preset = String(option.preset || '').toLowerCase();
  return preset === 'traditional' || status === 'traditional' || scope === 'traditional';
}

function isConservativeOption(option: IdentityOption) {
  const status = String(option.statusRaw || '').toLowerCase();
  const scope = String(option.scope || '').toLowerCase();
  const preset = String(option.preset || '').toLowerCase();
  return (
    preset === 'conservative' ||
    status === 'independent' ||
    status === 'conservative' ||
    status === 'confirmed' ||
    scope === 'default' ||
    scope === 'conservative'
  );
}

function pickIdentityForPreset(person: Person, preset: 'conservative' | 'traditional') {
  if (!person.identityOptions.length) return undefined;
  const explicit = person.identityOptions.find((option) => String(option.preset || '').toLowerCase() === preset);
  if (explicit) return explicit.id;
  if (preset === 'traditional') {
    const traditional = person.identityOptions.find((option) => isTraditionalOption(option));
    if (traditional) return traditional.id;
  } else {
    const conservative = person.identityOptions.find((option) => isConservativeOption(option));
    if (conservative) return conservative.id;
  }
  return person.identityOptions[0].id;
}

function isRelationActiveByIdentity(rel: Relationship) {
  if (!rel.identityGuards || rel.identityGuards.length === 0) return true;
  return rel.identityGuards.every((g) => {
    const selected = identitySelection[g.personId];
    if (!selected) return false;
    return g.allowedIdentityOptions.includes(selected);
  });
}

function relationMatchesFilters(rel: Relationship) {
  if (filters.books.size > 0 && !filters.books.has(rel.book)) return false;
  if (filters.eras.size > 0 && !filters.eras.has(rel.era)) return false;
  if (filters.relations.size > 0 && !filters.relations.has(rel.type)) return false;
  if (filters.evidences.size > 0 && !filters.evidences.has(rel.evidenceLevel)) return false;
  return true;
}

function personMatchesSearch(person: Person) {
  if (!filters.search) return true;
  const term = normalize(filters.search);
  return normalize(person.nameZh).includes(term)
    || normalize(person.nameLat).includes(term)
    || person.aliases.some((a) => normalize(a).includes(term));
}

function applyPreset(id: string) {
  const preset = data?.topicPresets.find((p) => p.id === id);
  if (!preset) return;
  filters.books = new Set(preset.bookIncludes ?? []);
  filters.eras = new Set(preset.eraIncludes ?? []);
  filters.relations = new Set(preset.relationTypes ?? []);
  filters.evidences = new Set(preset.evidenceIncludes ?? []);
  renderChips();
  renderGraph();
}

function renderChips() {
  if (!data) return;
  const renderChoiceGroup = (el: HTMLElement, values: string[], activeSet: Set<string>, key: 'books' | 'eras' | 'relations' | 'evidences') => {
    el.innerHTML = '';
    for (const value of values) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chip ${activeSet.has(value) ? 'active' : ''}`;
      btn.textContent = value;
      btn.onclick = () => {
        if (activeSet.has(value)) activeSet.delete(value);
        else activeSet.add(value);
        // preset切换被手动覆盖时，保持 preset 为 custom
        filters.preset = 'custom';
        renderChips();
        renderGraph();
      };
      el.append(btn);
    }
  };

  const books = Array.from(new Set(data.relationships.map((r) => r.book))).sort();
  const eras = Array.from(new Set(data.relationships.map((r) => r.era))).sort();
  const relations = Array.from(new Set([...relationTypeOrder, ...data.relationships.map((r) => r.type)])).filter(Boolean).sort();
  const evidences = ['nt_text', 'ancient', 'modern'];

  renderChoiceGroup(bookChips, books, filters.books, 'books');
  renderChoiceGroup(eraChips, eras, filters.eras, 'eras');
  renderChoiceGroup(relationChips, relations, filters.relations, 'relations');
  renderChoiceGroup(evidenceChips, evidences, filters.evidences, 'evidences');
}

function renderIdentitySection(person: Person) {
  identityPanel.innerHTML = `
    <h2>身份选择</h2>
    <p>当前人物身份可手动切换，关系显示将按身份约束实时更新。</p>
  `;
  if (person.identityOptions.length <= 1) {
    identityPanel.insertAdjacentHTML(
      'beforeend',
      `<p><span class="tag">默认身份</span>${person.identityOptions[0].label}</p>`
    );
    return;
  }

  const current = identitySelection[person.id] ?? person.identityOptions[0].id;
  const rows = person.identityOptions
    .map((o) => `<option value="${o.id}" ${o.id === current ? 'selected' : ''}>${o.label}（${o.status}）</option>`)
    .join('');
  identityPanel.insertAdjacentHTML(
    'beforeend',
    `
    <div class="identity">
      <div class="row">
        <label for="identity-select-${person.id}">人物身份</label>
        <select class="small" id="identity-select-${person.id}">
          ${rows}
        </select>
      </div>
      <p>切换后，含有该人物身份约束的关系会被重新过滤。</p>
    </div>`
  );
  const sel = document.getElementById(`identity-select-${person.id}`) as HTMLSelectElement;
  sel.onchange = () => {
    identitySelection[person.id] = sel.value;
    renderGraph();
    renderPersonDetail(person.id);
  };
}

function applyIdentityPreset(preset: 'conservative' | 'traditional') {
  if (!data) return;
  for (const person of data.people) {
    const chosen = pickIdentityForPreset(person, preset) ?? person.identityOptions[0].id;
    identitySelection[person.id] = chosen;
  }
  renderGraph();
  if (selectedPersonState.value) renderPersonDetail(selectedPersonState.value.id);
}

function buildRelationshipList(personId: string) {
  if (!data) return [];
  return data.relationships.filter(
    (rel) =>
      isRelationActiveByIdentity(rel) &&
      relationMatchesFilters(rel) &&
      (rel.fromPerson === personId || rel.toPerson === personId)
  );
}

function renderPersonDetail(personId: string) {
  if (!data) return;
  const person = data.people.find((p) => p.id === personId);
  if (!person) return;
  selectedPersonState.value = person;
  const selectedIdentity = identitySelection[person.id] ?? person.identityOptions[0].id;
  const selected = person.identityOptions.find((x) => x.id === selectedIdentity)?.label ?? person.identityOptions[0].label;
  const rels = buildRelationshipList(person.id);
  const personById = new Map(data.people.map((p) => [p.id, p]));
  const relHtml = rels
    .map((rel) => {
      const otherPersonId = rel.fromPerson === person.id ? rel.toPerson : rel.fromPerson;
      const source = personById.get(otherPersonId);
      if (!source) return '';
      const srcs = collectSourceLookup(rel.sources);
      return `
        <article class="relation-item">
          <h3>${rel.type} · ${source.nameZh}</h3>
          <p>${rel.description}</p>
          <small>${rel.book} / ${rel.era} / ${labelizeEvidence(rel.evidenceLevel)} / ${rel.certainty === 'high' ? '高' : rel.certainty === 'medium' ? '中' : '低'}确定度</small>
          ${rel.passages.length ? `<p class="muted">出处：${rel.passages.join('；')}</p>` : ''}
          ${
            srcs.length
              ? `<p>来源：${srcs
                  .map(
                    (s) => `
            <span class="tag">${s.label}</span>`
                  )
                  .join('')}
              </p>`
              : ''
          }
        </article>
      `;
    })
    .join('');

  detailPanel.innerHTML = `
    <div class="person-meta">
      <h2>${person.nameZh}</h2>
      <div>${person.aliases.map((a) => `<span class="tag">${a}</span>`).join('')}</div>
      <p class="muted">${person.nameLat} / ${person.era}</p>
      <p><span class="tag">${selected}</span><span class="tag">身份策略：${identitySelection[person.id] === undefined ? '默认' : '手动'}</span></p>
      <div class="chips">${person.books.map((b) => `<span class="tag">${b}</span>`).join('')}</div>
      ${person.notes ? `<p>${person.notes}</p>` : ''}
    </div>
    <h3>相关关系（${rels.length}）</h3>
    <div class="list">${relHtml || '<p class="muted">当前筛选下无匹配关系。</p>'}</div>
  `;
  renderIdentitySection(person);
}

function renderLegend() {
  const title = document.createElement('div');
  title.innerHTML = `<h3>图例</h3>`;
  const list = relationTypeOrder.map((x) => `<span class="tag">${x}</span>`)
    .join('');
  title.insertAdjacentHTML('beforeend', `<p>${list}</p>`);
  detailPanel.appendChild(title);
}

function renderGraph() {
  if (!data || !graphContainer) return;
  const visiblePeople = data.people.filter(personMatchesSearch);
  const visiblePeopleIds = new Set(visiblePeople.map((p) => p.id));
  const personColorById = new Map(
    visiblePeople.map((person) => [person.id, identityColor(person, identitySelection[person.id] ?? person.identityOptions[0].id)])
  );
  const visibleRels = data.relationships.filter(
    (rel) =>
      visiblePeopleIds.has(rel.fromPerson) &&
      visiblePeopleIds.has(rel.toPerson) &&
      relationMatchesFilters(rel) &&
      isRelationActiveByIdentity(rel)
  );

  const style: cytoscape.StylesheetJson = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        color: '#e2e8f0',
        'font-size': '11px',
        'text-wrap': 'wrap',
        'text-max-width': '110px',
        'text-background-color': '#0b1020',
        'text-background-opacity': 0.75,
        'text-background-shape': 'roundrectangle',
        'background-color': 'data(color)',
        'background-opacity': 0.95,
        'border-width': '2px',
        'border-color': '#7dd3fc',
        width: '48px',
        height: '48px'
      }
    },
    {
      selector: 'node:selected',
      style: {
        'border-color': '#fbbf24',
        width: '54px',
        height: '54px'
      }
    },
    {
      selector: 'edge',
      style: {
        width: '2.5px',
        'curve-style': 'bezier',
        'line-color': '#60a5fa',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#60a5fa',
        'source-arrow-shape': 'triangle',
        'source-arrow-color': '#60a5fa',
        label: 'data(label)',
        'font-size': 9,
        color: '#c7d2fe',
        'text-background-color': '#020617',
        'text-background-opacity': 1
      }
    },
    {
      selector: 'edge[certainty = "low"]',
      style: {
        'line-style': 'dashed',
        opacity: 0.7
      }
    }
  ];

  const elements: Array<cytoscape.NodeDefinition | cytoscape.EdgeDefinition> = [
    ...visiblePeople.map((person) => ({
      group: 'nodes' as const,
      data: {
        id: person.id,
        label: person.nameZh,
        color: personColorById.get(person.id) ?? '#7dd3fc'
      }
    })),
    ...visibleRels.map((rel) => {
      const source = rel.fromPerson;
      const target = rel.toPerson;
      const label = `${rel.type}·${labelizeEvidence(rel.evidenceLevel)}`;
      return {
        group: 'edges' as const,
        data: {
          id: `e-${rel.id}`,
          source,
          target,
          label,
          certainty: rel.certainty,
          kind: rel.type,
          direction: rel.direction
        }
      };
    })
  ];

  if (!cy) {
    cy = cytoscape({
      container: graphContainer,
      elements,
      style,
      layout: {
        name: 'cose',
        fit: true,
        padding: 12,
        nodeRepulsion: 32000,
        idealEdgeLength: 140,
        animate: true
      }
    });
    cy.on('tap', 'node', (event) => {
      const id = event.target.id();
      const person = data?.people.find((p) => p.id === id);
      if (person) renderPersonDetail(person.id);
    });
    cy.on('mouseover', 'edge', (event) => {
      const id = event.target.id();
      const relId = id.replace(/^e-/, '');
      const rel = data?.relationships.find((r) => r.id === relId);
      if (!rel) return;
      event.target.style('label', `${rel.type} · ${labelizeEvidence(rel.evidenceLevel)} · ${rel.book}`);
    });
  } else {
    cy.elements().remove();
    cy.add(elements);
    cy.layout({ name: 'cose', fit: true, padding: 12, nodeRepulsion: 32000, idealEdgeLength: 140, animate: true }).run();
  }

  cy.zoomingEnabled(true);
  cy.panningEnabled(true);
}

function renderSourceHeader() {
  if (!data) return;
  const identityCount = Object.keys(identitySelection).length;
  identityPanel.insertAdjacentHTML(
    'beforeend',
    `<p class="muted">版本：${data.meta.edition}（${data.meta.version}）/ 图谱记录 ${data.relationships.length} 条 · 人物 ${data.people.length} 人 · 已设置身份 ${identityCount}</p>`
  );
}

function renderReviewWarning() {
  if (!data || !reviewWarning) return;
  if (data.meta.editorialReviewRequired) {
    reviewWarning.style.display = 'block';
  } else {
    reviewWarning.style.display = 'none';
  }
}

function renderFilters(changedPreset = false) {
  renderChips();
  renderGraph();
  if (changedPreset) {
    detailPanel.innerHTML = '<p class="muted">专题变化已应用，点击左图节点查看关系。</p>';
  }
}

function wireUpControls() {
  searchInput.addEventListener('input', () => {
    filters.search = searchInput.value;
    renderFilters();
  });
  btnReset.addEventListener('click', () => {
    filters.search = '';
    filters.books.clear();
    filters.eras.clear();
    filters.relations.clear();
    filters.evidences.clear();
    searchInput.value = '';
    presetSelect.value = 'all';
    applyPreset('all');
    renderPersonDetailFallback();
  });
  presetSelect.addEventListener('change', () => {
    filters.preset = presetSelect.value;
    applyPreset(filters.preset);
    renderFilters(true);
  });
  identityPresetSelect.addEventListener('change', () => {
    applyIdentityPreset(identityPresetSelect.value as 'conservative' | 'traditional');
    if (!selectedPersonState.value) {
      renderFilters();
    }
  });
}

function renderPersonDetailFallback() {
  detailPanel.innerHTML = `
    <p class="muted">当前未选择人物。点击图中的节点可查看关系与出处；可切换“身份预设”观察身份依赖关系变化。</p>
  `;
  renderSourceHeader();
}

async function boot() {
  const response = await fetch('/data/graph.json');
  if (!response.ok) {
    app.innerHTML = `<p class=\"error\">读取图谱数据失败：${response.status} ${response.statusText}</p>`;
    return;
  }
  data = (await response.json()) as GraphData;

  // default identity
  for (const person of data.people) {
    const preset = (person.selectedPresetDefault || 'conservative') as 'conservative' | 'traditional';
    identitySelection[person.id] = pickIdentityForPreset(person, preset) ?? person.identityOptions[0].id;
  }

  presetSelect.innerHTML = data.topicPresets.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  presetSelect.value = data.topicPresets[0]?.id ?? 'all';
  filters.preset = presetSelect.value;
  applyPreset(filters.preset);
  renderSourceHeader();
  renderReviewWarning();
  renderGraph();
  wireUpControls();
  renderPersonDetailFallback();
}

boot();
