# Design QA — New Testament People Network

## QA target

- Reference direction: `/Users/dx/.codex/generated_images/01a03fe2-e5be-7482-a61f-1b2d679c532d/exec-99dc50f4-b373-4c7b-ae4b-bd9fd652921d.png` (1487 × 1058).
- Desktop implementation: `/tmp/nt-people-audit/16-desktop-final.png` (1440 × 900).
- Mobile implementation: `/tmp/nt-people-audit/15-mobile-final.png` (390 × 844).
- Full comparison: `/tmp/nt-people-audit/17-reference-current-final.png`.
- Focused graph comparison: `/tmp/nt-people-audit/11-graph-comparison.png`.
- Focused inspector comparison: `/tmp/nt-people-audit/12-inspector-comparison.png`.
- Tested state: conservative identity preset, all evidence layers enabled, Paul selected, one-degree network view.

The selected option supplied the information architecture: searchable people index, central relationship canvas, evidence filters, and a provenance inspector. The final dark translucent treatment is an intentional deviation requested after selection: a Final Fantasy XIII-inspired crystalline light-path feeling, created with original assets and tokens rather than copied game artwork.

## Iteration history

### Pass 1

- **P1 — hidden empty states remained visible over populated content.** The stylesheet's `.empty-state { display: grid }` overrode the HTML `hidden` attribute. Added a global `[hidden] { display: none !important; }` rule and rechecked both list and graph states.
- **P2 — the selected person was buried in the alphabetical list.** The current person now remains pinned at the top, keeping list, graph, and inspector context aligned.
- **P2 — mobile evidence controls clipped at 390 px.** The filter group now wraps, retaining practical tap targets and readable labels.
- **P2 — a custom identity merge could show the other member's display label.** Merged models now prefer the representative person's selected identity label; the Bartholomew/Nathanael custom switch was browser-tested after correction.
- **P3 — duplicate canonical aliases and repeated note punctuation created visual noise.** Canonical aliases are removed from chips and editorial notes are normalized.
- Removed custom wheel sensitivity after the graph library warned about non-standard zoom behavior.

### Pass 2

- Full and focused comparison inputs were inspected together at original detail.
- Desktop preserves the reference hierarchy while increasing visual separation through translucent panes and luminous network paths.
- The graph is intentionally one-degree rather than the reference's denser multi-hop view. This keeps labels readable, preserves the research flow, and still exposes every matching relationship in the accessible inspector list.
- Mobile uses People / Graph / Details tabs instead of compressing three panes into one viewport. No horizontal clipping was observed at 390 × 844.
- Typography, borders, radii, spacing, icon family, contrast, selected states, empty states, and source-link treatments are internally consistent with `DESIGN.md`.
- The generated crystalline background is original, correctly cropped, and visually subordinate to the research content.

## Interaction and accessibility evidence

- Search accepts Chinese names, aliases, Greek, and Latin transliterations; composition-safe debouncing and immediate clear were exercised.
- Topic shortcuts were exercised for family and Paul coworker views; each auto-focused a relevant connected person.
- Evidence-layer empty and recovery states were exercised.
- Conservative and common-tradition presets were exercised (364 and 362 visible identities respectively), including URL-state persistence.
- The person-era filter was exercised for `旧约背景`; it exposes all 148 matching people, retains relationship filtering separately, and corrects an incompatible focused person when loading a filtered URL.
- Per-person disputed identity selection was exercised for Bartholomew/Nathanael; custom mode and representative display labeling behaved correctly after the fix.
- Relationship-row selection exposed exact passage/source evidence in the inspector.
- People, Graph, and Details mobile tabs were exercised.
- The people index uses native buttons and implements Arrow Up / Arrow Down focus movement; focus-visible styling, semantic labels, reduced-motion behavior, and graph text alternatives are present.
- The final browser console showed no current errors or warnings.

## Remaining low-severity note

- **P3 — dense labels at narrow mobile width may require the supplied zoom controls.** This is acceptable because the complete relationship set remains available in the accessible text inspector and the graph has explicit zoom/fit controls.

## Final result

**passed**

---

# Design QA — Compact Header Controls and Canonical Light System

## Scope and visual truth

- Source crops: `/Users/dx/Desktop/Screenshot 2026-08-27 at 6.41.38 PM.png` (792 × 158) and `/Users/dx/Desktop/Screenshot 2026-08-27 at 6.41.40 PM.png` (336 × 160).
- Rendered implementation: `/tmp/nt-people-compact-header-qa/01-desktop-final.png` at 1487 × 900 CSS pixels, 1× capture density.
- Responsive evidence: `/tmp/nt-people-compact-header-qa/03-mid-final.png` at 1192 × 754 and `/tmp/nt-people-compact-header-qa/04-mobile-final.png` at 500 × 844.
- State: light research atlas; 保罗 selected; query `保罗`; all topics; conservative identity preset.
- Focused comparison inspected the original control/action crops against the rendered 80px desktop header. A persistent montage was not generated because the browser rejected the local data-URL comparison surface; the source and rendered images remained directly inspectable in the same QA run.

## Findings and fixes

- Earlier P2: global search, topic/identity controls, and View/Help actions felt vertically heavy relative to the requested compact header rhythm.
- Fix: search is 44px high; topic and identity selects are 38px; labels are 12px at 14.4px line height; View/Help actions are 52 × 44px with 18px icons.
- Fix: introduced explicit runtime tokens `--control-sm: 38px` and `--control-search: 44px`; desktop and mobile search now consume the same search-height token.
- Post-fix desktop measurements: search 454 × 44; topic 148 × 38; identity 142 × 38; actions 52 × 44; zero horizontal overflow.
- Post-fix 1192px measurements: search 464 × 44; controls remain 38px; low-priority View/Help actions are hidden; zero horizontal overflow.
- Post-fix 500px measurements: search 480 × 44; topic and identity 190 × 38; header 178px; zero horizontal overflow.
- P0/P1/P2 remaining: none.

## Interaction and browser validation

- Clear search empties immediately, hides the clear action, returns focus to `#search`, and removes `q` from the URL; re-entering `保罗` restores the query.
- Topic select changes to `paulTeam`, updates URL state, and returns cleanly to `all`.
- Browser console contained only Vite connection debug entries; no error entries.
- Desktop, compact desktop, and mobile captures preserve the graph, list, and inspector without content overlap caused by this header pass.

## Reconcile drift

| DESIGN.md rule | Runtime evidence | Verdict | Action |
|---|---|---|---|
| Former dark crystal palette | Active `web/src/style-reference.css` uses a warm-white canvas and paper research surface | DRIFT resolved | Adopted the approved light research-atlas system in `DESIGN.md` |
| Former runtime owner `web/src/style.css` | `web/src/main.ts` imports `style-reference.css` | DRIFT resolved | Documented Model B ownership at `web/src/style-reference.css` |
| Search/select/action dimensions | `44 / 38 / 52×44` in runtime tokens and shared header styles | MATCH | Kept canonical tokens and runtime consumers aligned |

## Validation evidence

- `npx -p @google/design.md designmd lint DESIGN.md`: 0 errors, 0 warnings.
- `npm run typecheck:web`: passed.
- Frontend Design Premium strict audit: 0 findings.
- `npm run check`: passed, including data validation, deterministic STEP regressions, production build, person-era and identity checks.
- `git diff --check`: passed.

## Final result

**passed**

---

# Design QA — UX/UI Detail Refinement

## Evaluation result

- Previous score: **68/100**.
- Current score: **86/100**.
- Visual hierarchy: **18/20** — the brand, global search, graph focus, and inspector read in a stable order at desktop and compact-desktop widths.
- Typography: **18/20** — the live interface now uses a six-step 12/13/14/16/20/26 px scale and 400/500/600/700 weights; measured visible text has a 12 px minimum.
- Spacing and control consistency: **17/20** — primary search is 48 px, standard controls are 42 px, and compact spacing remains consistent without collapsing touch targets.
- Graph readability: **16/20** — normal links are thinner and quieter, selected links use restrained emphasis, labels obscure less of their connectors, and one- or two-neighbor layouts avoid the former vertical stack.
- Responsive and accessible behavior: **17/20** — 1192 px gains a 672 px graph column with no horizontal overflow; 500 px uses the single-panel flow with no horizontal overflow and retains visible focus states.

## Source and implementation comparison

- Selected visual target: `/var/folders/6x/d1g8hh216r57md7fjqfn1qw00000gn/T/codex-clipboard-91a1279d-9cbf-4169-a0ae-c83d5df5cffc.png` (1487 × 1058).
- Final implementation capture: `/tmp/nt-people-ux-audit/12-wide-final.png` (1487 × 1058).
- Side-by-side comparison input: `/tmp/nt-people-ux-audit/13-reference-vs-final.jpg`.
- Matching state: desktop research shell, Paul search, Paul selected, evidence layers visible, inspector and selected relationship visible. The live graph remains internally consistent around Paul instead of reproducing the reference mock's intentionally mixed data state.
- The implementation matches the target's light archival tone, three-column proportions, restrained evidence colors, strong central focus, compact inspector, and sans/serif hierarchy while preserving the reviewed live data.

## Responsive evidence

- Compact desktop: `/tmp/nt-people-ux-audit/08-mid-refined.png` (1192 × 754), no horizontal overflow.
- Mobile graph: `/tmp/nt-people-ux-audit/09-mobile-refined.png` (500 × 844), no horizontal overflow.
- Mobile details: `/tmp/nt-people-ux-audit/10-mobile-details-refined.png` (500 × 844).
- Visible-text measurement: minimum 12 px; no visible text below 12 px in the checked mobile state.

## Severity review

- P0: none.
- P1: none.
- P2: none.
- P3 follow-up: the live graph is intentionally more data-driven and less diagrammatically staged than the visual mock; further aesthetic staging can be explored without changing information architecture.

## Validation evidence

- Full `npm run check` passed, including data validation, relationship-review checks, deterministic STEP regressions, TypeScript, production build, era checks, and identity checks.
- Frontend Design Premium strict audit passed with zero findings.
- `git diff --check` passed.
- Published data remains 364 people and 222 accepted relationships; 83 assertions remain pending and 50 rejected assertions remain retained for audit.
- `DESIGN.md` remains unchanged because adopting the already-rendered light trial as the canonical design standard requires a separate design approval gate.

## Final result

**passed**

---

# Design QA — Luminous Pilgrimage Redesign (Option 2)

## QA target

- User-selected reference: `/Users/dx/.codex/generated_images/01a03fe2-e5be-7482-a61f-1b2d679c532d/exec-d23edffb-818b-498d-a00e-91d17ce865c1.png` (1487 × 1058).
- Desktop capture: `/tmp/nt-people-redesign-qa/desktop-reviewed.png` (1440 × 1024).
- Corrected desktop capture: `/tmp/nt-people-redesign-qa/desktop-clean.png` (1440 × 1024).
- Same-viewport comparison: `/tmp/nt-people-redesign-qa/reference-vs-build.png` (2880 × 1024).
- Mobile breakpoint tested at 390 × 844.
- Tested state: conservative identity preset, all evidence layers enabled, Paul selected, one-degree network view.

## Readability changes

- Replaced the three persistent columns with a full-screen relationship world, a slim command rail, and two optional high-contrast reading drawers.
- Kept names, relationship types, review warnings, filters, and passage evidence on dark stable surfaces instead of placing body text directly over the illustrated background.
- Limited desktop graph density to 22 displayed relationships and mobile density to 6; the complete relationship set remains available in the accessible detail list.
- Hid edge labels on compact mobile screens and preserved exact relationship text in the evidence ribbon and detail panel.
- Increased the selected-person hierarchy with a larger original crystal asset, a stable focus heading, and a fixed evidence ribbon.
- Removed the dark square artifacts around crystal assets by using a transparent image layer without node underlays.

## Visual comparison result

- The build matches the selected direction's indigo pilgrimage world, diagonal light path, large foreground focus crystal, sparse command rail, top search, and bottom evidence band.
- The build intentionally uses fewer visible nodes than the concept image so Chinese names and relation labels remain readable.
- All visible crystals and the world background are original generated assets; no Final Fantasy artwork or brand asset is copied.
- Typography, spacing, borders, drawer surfaces, evidence colors, and selected states are consistent across the desktop and mobile layouts.

## Interaction and accessibility evidence

- Desktop command-rail controls open and close the People and Details drawers.
- Search, person selection, identity presets, topic presets, evidence toggles, relationship selection, zoom, fit, and focus controls retain their existing data behavior.
- Selecting a relationship updates the fixed evidence ribbon with people, relationship type, evidence level, certainty, and passage locations.
- At 390 × 844, People / Graph / Details remain separate readable views with no horizontal page overflow (`scrollWidth = 390`).
- Native controls, accessible labels, keyboard focus styles, graph text alternatives, and reduced-motion handling remain present.
- TypeScript, production build, identity-state checks, and full project validation pass after the redesign.

## Remaining note

- `DESIGN.md` still documents the prior canonical layout. Updating that canonical design record requires a separate explicit approval under the repository design-governance rule; the runtime redesign and this superseding QA record are complete.

## Final result

**passed**

# Design QA — Relationship Route Readability Refinement

## QA target

- Baseline capture: `/tmp/nt-people-line-audit/01-before.png` (1280 × 720).
- Final desktop capture: `/tmp/nt-people-line-audit/09-desktop-final.png` (1280 × 720).
- Selected-route capture: `/tmp/nt-people-line-audit/11-selected-final.png` (1280 × 720).
- Final mobile capture: `/tmp/nt-people-line-audit/12-mobile-final.png` (390 × 844).
- Reference comparison: `/tmp/nt-people-line-audit/10-reference-vs-final.png` (2560 × 720).
- Tested state: conservative identity preset, all evidence layers enabled, Paul selected, one-degree network view.

## Superseding route changes

- Removed persistent relationship labels from graph edges; exact relationship text remains in the fixed evidence ribbon and accessible detail list.
- Replaced the dense diagonal spoke layout with paired upper/lower route branches that follow the illustrated pilgrimage direction.
- Reduced default line weight and saturation, retained subtle evidence-level color, and reserved the strong pearl-gold treatment for hover and selection.
- Highlighting one route also highlights its destination node; directional arrows now point correctly even though every visual route is drawn outward from the focus node.
- Reduced the desktop display cap from 22 to 14 relationships while retaining the complete relationship list in the inspector.

## Validation evidence

- Clicking the tested route produced `亚居拉 · 接待 · 保罗` and `新约经文 · 高确定度 · ACT 18:2-3` in the evidence ribbon.
- Desktop and 390 × 844 mobile captures show readable names without persistent edge-label collisions.
- Browser console inspection returned no errors or warnings.
- Frontend Design Premium strict audit passed with zero findings.
- Full repository validation, TypeScript checking, production build, person-era checks, and identity checks passed.

## Governance note

- This is a readability refinement within the already selected luminous-pilgrimage runtime direction. `DESIGN.md` remains unchanged pending explicit approval to update the canonical design record.

## Final result

**passed**

---

# Design QA — Pale Astral Atlas Trial

## Reference and implementation

- Visual reference: `/var/folders/6x/d1g8hh216r57md7fjqfn1qw00000gn/T/codex-clipboard-18ca57bc-c1bf-4702-9468-9d586c47c74e.png` (1487 × 1058).
- Generated a text-free, high-key silver-blue astral background and stored the production asset at `web/public/assets/astral-atlas-world.png`.
- Rebuilt the main graph as a radial one-degree relationship view with a centered focus person, evenly distributed neighboring people, restrained straight evidence lines, and a persistent research inspector.
- Kept the result intentionally lighter than the supplied reference in response to the requested pale visual direction.

## Visual evidence

- Exact reference-size desktop capture: `/tmp/nt-people-light-atlas-qa/04-reference-size.png`.
- Side-by-side reference comparison: `/tmp/nt-people-light-atlas-qa/05-reference-vs-build.png`.
- Mobile capture after compact radial recentering: `/tmp/nt-people-light-atlas-qa/07-final-mobile-scale1.png`.
- Desktop inspection confirmed that the focus crystal, all visible neighboring labels, relationship labels, and the complete right-hand detail panel remain readable without page overflow.
- Mobile keeps the three-panel navigation, places the evidence ribbon inside the safe viewport, hides edge labels, and reduces the ring radius to protect node labels at narrow widths.

## Interaction and accessibility evidence

- Search, topic selection, identity presets, evidence-level filters, graph fitting, focus recentering, zoom controls, person navigation, and relationship selection retain their existing handlers.
- The selected person automatically exposes a first relationship in both the evidence ribbon and the detailed source card.
- Every graph relationship remains available as text in the inspector; keyboard focus states and reduced-motion behavior remain defined.
- The production build completed with the static graph data and no public Neo4j dependency.

## Validation evidence

- Frontend Design Premium strict audit passed with zero findings.
- TypeScript checking, derived-data validation, deterministic STEP boundary tests, production build, person-era checks, and identity checks passed.
- Published data remains consistent at 364 people and 222 accepted relationships; 83 assertions remain pending and 50 rejected assertions remain retained for audit.

## Governance note

- This is a reversible runtime trial based on the supplied screenshot. `DESIGN.md` remains unchanged until the pale astral-atlas direction is explicitly adopted as the canonical design.

## Final result

**passed**

---

# Design QA — Three-column Research Atlas

## Reference and implementation

- Selected reference: `/var/folders/6x/d1g8hh216r57md7fjqfn1qw00000gn/T/codex-clipboard-90663ba2-428a-4b31-8124-742c5a930cfa.png` (1487 × 1058).
- Recreated the reference's white research-tool shell: full-width search and presets, persistent person index, central evidence graph, persistent person inspector, and bottom relationship legend.
- Preserved the current static Cytoscape data architecture and current reviewed counts rather than copying the stale mock counts.

## Visual evidence

- Final desktop capture: `/tmp/nt-people-reference-layout-qa/02-desktop.png`.
- Matching Paul-search state: `/tmp/nt-people-reference-layout-qa/05-desktop-search.png`.
- Same-size reference comparison: `/tmp/nt-people-reference-layout-qa/04-reference-vs-build.png`.
- Responsive capture: `/tmp/nt-people-reference-layout-qa/03-mobile.png`.
- The final screen matches the reference's primary hierarchy, column proportions, restrained blue/green/red evidence palette, circular nodes, labeled connectors, dense inspector, and research-first tone.

## Interaction and accessibility evidence

- Global and left-panel search inputs stay synchronized and retain IME-safe debouncing.
- Topic shortcuts, evidence checkboxes, identity presets, person selection, relationship selection, zoom, fit, and source links remain functional.
- Keyboard focus states, localized accessible names, text alternatives, reduced-motion behavior, loading, empty, and error states remain present.
- All relationships remain readable in the inspector even when the graph limits visible nodes for clarity.

## Validation evidence

- Frontend Design Premium strict audit passed with zero findings.
- Full data validation, TypeScript checking, deterministic STEP regressions, production build, person-era checks, and identity checks passed.
- Published data remains 364 people and 222 accepted relationships; 83 assertions remain pending and 50 rejected assertions remain retained for audit.

## Governance note

- `DESIGN.md` still records the earlier dark crystal palette. This implementation treats the supplied light three-column direction as a runtime trial until the canonical design record is separately approved.

## Final result

**passed**

---

# Design QA — Reference CSS Fidelity Pass

## Scope

- Refined the selected three-column research layout against `/var/folders/6x/d1g8hh216r57md7fjqfn1qw00000gn/T/codex-clipboard-91a1279d-9cbf-4169-a0ae-c83d5df5cffc.png`.
- Limited changes to typography, spacing, control density, node labels, narrow-screen graph geometry, and the central canvas texture.
- Added the generated text-free paper-grid asset at `web/public/assets/research-grid-paper.png`.

## Visual evidence

- Refined desktop capture: `/tmp/nt-people-reference-layout-qa/07-css-fidelity-final.png`.
- Same-size comparison: `/tmp/nt-people-reference-layout-qa/08-css-reference-vs-final.png`.
- Final 500 px responsive capture: `/tmp/nt-people-reference-layout-qa/11-narrow-final.png`.
- Desktop typography now follows the reference's stronger title, denser filter labels, clearer person rows, heavier node labels, and more readable inspector hierarchy.
- The compact graph radius was reduced so every displayed node remains above the evidence ribbon at narrow widths.

## Validation evidence

- Frontend Design Premium strict audit passed with zero findings.
- Full repository validation, deterministic data checks, TypeScript, production build, person-era checks, and identity checks passed.
- Current publication counts remain 364 people and 222 accepted relationships; editorial review state is unchanged.

## Final result

**passed**

---

# Design QA — Font Scale Calibration

## Scope

- Calibrated the live research-atlas typography against `/Users/dx/Desktop/Screenshot 2026-08-27 at 5.08.05 PM.png`.
- Preserved the established title, dataset counts, three-column proportions, and control placement.
- Increased undersized navigation, filter, list, inspector, source, footer, node, and relationship-label text by roughly 1–2 px, with matching line-height and row-height adjustments.
- Kept the narrow layout compact while removing the sub-11 px text used by visible controls.

## Visual evidence

- Desktop capture: `/tmp/nt-people-font-size-qa/01-desktop.png`.
- 500 px responsive capture: `/tmp/nt-people-font-size-qa/02-narrow.png`.
- Desktop labels remain visually distinct from the brand and dataset counts; list rows and the inspector can now be scanned without browser zoom.
- The compact graph remains fully contained above its relationship ribbon after node-label enlargement.

## Validation evidence

- TypeScript checking passed before visual review.
- Full repository validation, strict design audit, production build, data integrity checks, and responsive visual review passed after the final CSS update.
- Current publication counts remain 364 people and 222 accepted relationships; editorial review state is unchanged.

## Final result

**passed**

---

# Design QA — Header Search Row Refinement

## Scope and visual truth

- Source visual truth: `/var/folders/6x/d1g8hh216r57md7fjqfn1qw00000gn/T/codex-clipboard-91a1279d-9cbf-4169-a0ae-c83d5df5cffc.png`.
- Final implementation: `/tmp/nt-people-search-row-qa/04-header-after.png` at a 1487 × 900 CSS viewport and 1× normalized capture density.
- Full-view comparison input: `/tmp/nt-people-search-row-qa/08-full-reference-vs-after.jpg`.
- Focused header comparison input: `/tmp/nt-people-search-row-qa/07-header-reference-vs-after.jpg`.
- State: light research atlas, Paul selected, search query `保罗`, conservative identity preset, all evidence layers enabled.

## Findings and comparison history

- Earlier P2: the 1487 px search field was 513 px wide versus approximately 454 px in the source, pushing the filter group too far right and weakening the header's rhythm.
- Fix: changed the desktop header grid to a measured 310 px brand track, 454 px search track, and flexible toolbar track. The final search field is 454 px and the toolbar begins at x=814, closely matching the source.
- Earlier P2: dataset totals were displayed as two horizontal number-label rows rather than two side-by-side metrics.
- Fix: grouped each total with its label and rendered the two metrics side by side, matching the source hierarchy.
- Earlier P2: the search clear action appeared as a separate boxed control and the search text was visually undersized.
- Fix: reduced the clear control to a 36 px ghost action inside the field and raised search text to 16 px while preserving its accessible name, immediate clearing, URL synchronization, and focus return.
- Earlier P2: at 1192 px the search field compressed to 352 px while low-priority View and Help actions remained visible.
- Fix: compact desktop hides those two actions and expands search to 464 px; the 1192 px layout has zero horizontal overflow.
- Post-fix evidence: `/tmp/nt-people-search-row-qa/05-mid-after.png` at 1192 × 754 and `/tmp/nt-people-search-row-qa/06-mobile-after.png` at 500 × 844.

## Required fidelity surfaces

- Fonts and typography: the header maintains the existing serif brand and sans utility pairing; search is 16 px, labels remain 13 px, metric labels 12 px, and totals 20 px.
- Spacing and layout rhythm: header height remains 80 px on desktop, the search and select baselines are centered, and the compact row returns space to the primary search task.
- Colors and tokens: the existing warm-white canvas, blue field outline, cool-gray dividers, and dark text tokens are unchanged.
- Image and asset fidelity: no new raster or illustrative assets were required; existing Phosphor icons remain sharp and consistent.
- Copy and content: labels, counts, query state, and source-facing terminology are unchanged.

## Interaction and validation evidence

- Clear-search interaction passed: it empties the field immediately, hides itself, restores the shortcut, returns focus to `#search`, and updates the URL and results when the query is re-entered.
- Browser checks passed at 1487 × 900, 1192 × 754, and 500 × 844 with zero horizontal overflow.
- TypeScript passed.
- Frontend Design Premium strict audit passed with zero findings.
- Full `npm run check` passed, including data validation, deterministic STEP regressions, production build, person-era checks, and identity checks.
- P0/P1/P2 remaining: none.

## Final result

**passed**
