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
