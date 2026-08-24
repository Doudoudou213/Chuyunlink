# “我的”页视觉验收

## 对照基准

- source visual truth path: `C:\Users\lenovo\AppData\Local\Temp\codex-clipboard-8469e4e2-b8f7-4915-bb86-b20dfa482ce6.png`
- implementation screenshot path: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\profile-mobile.png`
- full-view comparison evidence: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\profile-reference-comparison.png`
- focused header evidence: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\profile-focus-header.png`
- focused gallery evidence: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\profile-focus-gallery.png`
- responsive evidence:
  - mobile: `profile-mobile.png`, viewport/CSS size `390 × 1108`, deviceScaleFactor `1`
  - tablet: `profile-tablet.png`, viewport/CSS size `768 × 1024`, deviceScaleFactor `1`
  - desktop: `profile-desktop.png`, viewport/CSS size `1280 × 900`, deviceScaleFactor `1`
- source pixels: `390 × 1108`
- implementation pixels: `390 × 1108`
- density normalization: both source and implementation compared at 1:1 pixels; no scaling required.
- state: signed-in profile with realistic mock counts and four image submissions; settings closed; “作品” filter active.

## Findings

- No actionable P0/P1/P2 mismatch remains.
- Fonts and typography: the implementation preserves the reference's serif display hierarchy and compact small text while using the project's existing `Noto Serif SC`/body stack. Labels remain readable at mobile size without truncating the primary nickname or section titles.
- Spacing and layout rhythm: the dark account slab is gone; identity, three-number ledger, single atlas banner, tabs, and two-column gallery follow the reference's vertical rhythm. Existing product header/navigation are intentionally retained, but recolored to the same rice-paper surface.
- Colors and visual tokens: the page uses the existing paper, camel-brown, muted gold, Chu-stone green, and restrained raspberry tokens. Green and gold are limited to semantic status labels and do not compete as large surfaces.
- Image quality and asset fidelity: the banner and cards use real image assets rather than CSS/vector approximations. Production cards resolve each user's private CloudBase image to a temporary browser URL; QA used existing Wikimedia Commons assets already referenced by the project.
- Copy and content: raw file-name-like titles are replaced with intentional titles or description/region-derived labels. Backend language is replaced by “已入藏 / 待整理 / 待补充”, and internal submission IDs are no longer shown.
- Responsive behavior: no horizontal overflow at 390, 768, or 1280 px. The content remains intentionally capped near the existing profile width on desktop to preserve the gallery-room reading scale.
- Accessibility and interactions: settings opens/closes and updates `aria-expanded`; filters update `aria-pressed`; all visible primary targets are at least 44 px high. Hidden settings rows are 46 px high when opened. No unexpected console errors were recorded.

## Comparison history

1. Initial implementation pass — blocked by P2 findings:
   - the asynchronous guest bootstrap overwrote the deterministic QA state, hiding the intended gallery;
   - the fallback green app logo conflicted with the brown/gold page palette;
   - the inline nickname edit target measured `34 × 34`, below the 44 px touch target.
2. Fixes made:
   - stabilized the QA state while preserving production CloudBase behavior;
   - replaced the fallback logo treatment with existing real photographic assets and retained real user submissions as the production banner source;
   - expanded the nickname edit target to `44 × 44`;
   - recaptured mobile, tablet, and desktop evidence.
3. Post-fix evidence:
   - `profile-reference-comparison.png`, `profile-focus-header.png`, and `profile-focus-gallery.png` show the revised hierarchy, imagery, and gallery treatment;
   - `profile-mobile-qa.json`, `profile-tablet-qa.json`, and `profile-desktop-qa.json` record no overflow or unexpected console errors; mobile records working settings and filter interactions.

## Open Questions

- None blocking. The reference omits the existing application header and uses four navigation items; the implementation intentionally retains ChuLink's five existing routes and business shell while matching the profile content itself.

## Implementation Checklist

- [x] Remove the dark profile background block.
- [x] Unify profile and app chrome to rice-paper cream while on the profile tab.
- [x] Consolidate account actions under a settings gear.
- [x] Keep the atlas and benefit-return actions in one banner.
- [x] Render real submission thumbnails and human-friendly titles.
- [x] Use Chu-stone green and muted gold semantic status labels.
- [x] Verify mobile, tablet, desktop, keyboard semantics, touch targets, overflow, and console output.

## Follow-up Polish

- P3: when the product later supports user-uploaded avatars, prefer the real avatar URL over the current existing photographic fallback.
- P3: actual user galleries will naturally have more visual variety than the repeated QA fixtures used for deterministic comparison.

---

# “活动科普”页视觉验收

## 对照基准

- selected visual truth path: `C:\Users\lenovo\.codex\generated_images\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\exec-3abfcd04-edc4-4f86-8bd3-8076bef27ba8.png`
- implementation mobile screenshot: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\community-implementation-20260824\community-mobile.png`
- combined comparison input: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\community-implementation-20260824\community-comparison.png`
- interaction-state evidence:
  - route expanded: `community-mobile-route-expanded.png`
  - correct quiz feedback: `community-mobile-quiz-correct.png`
  - discovery regression: `discover-mobile-regression.png`
- responsive evidence:
  - mobile: `390 × 844`
  - tablet: `768 × 1024`
  - desktop: `1440 × 1100`
- implementation report: `interaction-report.json`
- state: active “荆楚纹样寻访周”, three-stop Wuhan route, route services collapsed by default, unanswered daily quiz on entry.

## Findings

- No actionable P0/P1/P2 mismatch remains.
- Visual hierarchy: the activity image is now the single immersive lead, followed by one clear route chapter and then the quiz/quick-learning chapters. The mobile hero was shortened after comparison so the route begins within the first viewport.
- Source fidelity: the selected direction's lacquer header, vermilion status/CTA, ivory paper, restrained gold type, three-node red route trace, and quiet secondary actions are present. The existing activity cover is intentionally retained because the user explicitly froze activity imagery.
- Route presentation: the route uses a generated transparent vermilion lacquer stroke asset instead of CSS or inline-vector imitation. Step labels remain real buttons, and the existing guide/map/discussion actions remain available below the trace.
- Quiz and learning states: neutral options use warm camel paper; the verified correct state uses Chu-stone green with a warm explanation panel. Quick learning is rendered as calm single-row learning cards rather than a SaaS tile grid.
- Responsive behavior: no horizontal overflow at 390, 768, or 1440 px. Mobile card density was reduced without hiding route actions; tablet and desktop keep the same reading order at a wider gallery scale.
- Accessibility and interactions: all visible action targets are at least 44 px high. Route services expand and update `aria-expanded`; activity signup opens the success modal; the correct quiz option produces one marked correct state and visible feedback.
- Console: mobile recorded only the local preview's missing `favicon.ico` 404. Tablet and desktop recorded no console errors.
- Discovery freeze: all new production selectors are scoped under `#view-community`; the discovery page was screenshot again and no discovery markup or behavior was changed.

## Comparison history

1. First implementation comparison found three P2 differences: the mobile hero occupied too much of the first viewport, the primary CTA inherited an overly pale legacy rule, and the route trace carried excess vertical whitespace.
2. Fixes made:
   - reduced the mobile hero to the selected direction's visual proportion;
   - raised selector specificity and restored a small-area Chu-vermilion signup CTA;
   - tightened the route trace, step offsets, and descriptions while keeping 44 px route actions;
   - recaptured the selected source and implementation together at the same normalized mobile size.
3. An apparent quiz-feedback failure was traced to the QA script deleting hidden profile DOM used by the points updater. The application itself was correct. The script was fixed to preserve the full DOM, and the final run passed signup, route expansion, and quiz feedback.

## Implementation Checklist

- [x] Preserve all required community DOM ids and existing event functions.
- [x] Keep the current activity cover unchanged.
- [x] Build the selected lacquer/paper visual direction.
- [x] Add a real transparent lacquer route asset.
- [x] Keep route services optional and collapsed on entry.
- [x] Verify signup, route expansion, quiz feedback, touch targets, and overflow.
- [x] Verify mobile, tablet, desktop, and discovery-page regression.
- [x] Avoid commit, push, merge, or deployment before user approval.

## Follow-up Polish

- P3: when an official “荆楚纹样寻访周” image is approved later, replace only the frozen cover asset while retaining this crop, overlay, and text layout.
- P3: add screenshot regression automation once the project vendors its browser-side CDN dependencies for fully offline deterministic captures.

final result: passed
