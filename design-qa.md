# 楚韵链迹采集页 Design QA

## Evidence

- Source visual truth: `C:\Users\lenovo\.codex\generated_images\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\exec-8a1abc9e-1ec7-4836-8641-b39dbd0c566e.png`
- Browser-rendered implementation, default state: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\collect-redesign-20260824\collect-top-427.png`
- Browser-rendered implementation, selected-image state: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\collect-redesign-20260824\collect-selected-427.png`
- Combined final comparison: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\collect-redesign-20260824\collect-comparison-final.png`
- Test report: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\collect-redesign-20260824\report.json`
- Browser: Microsoft Edge through Playwright Chromium, headless.
- CSS viewport: 427 × 922, deviceScaleFactor 1, locale zh-CN.
- Source pixels: 1024 × 1820. The source was normalized to 427 px width for combined comparison.
- Implementation pixels: 427 × 922 for the live top viewport; 427 × 1423 for the selected-state full-page capture.
- State: image type selected; generated Chu-pattern rubbing loaded as the field-image fixture; scroll reveal completed; authorization disclosure tested closed and open.
- Full-page capture note: Edge composites the fixed bottom navigation at a viewport seam in tall screenshots. The 427 × 922 live viewport capture verifies that the navigation is correctly fixed to the screen bottom; this capture artifact is not present during use.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: Noto Serif SC carries titles and editorial labels; Noto Sans SC remains the small utility face. Weight, spacing, wrapping and hierarchy reproduce the source's Song-style field-journal character without illegible decorative text.
- Spacing and layout rhythm: the final mobile hero is 333 px high; the roller leads directly into the vertical 影像 / 方位 / 笔记 editorial grid. Functional touch targets and the existing product header make the implementation longer than the static mock, but preserve the same hierarchy and reduce crowding.
- Colors and visual tokens: xuan-paper beige, lacquer brown, Chu vermilion, muted gold and patina green map consistently to the activity-community visual system. No cold white cards or gray SaaS borders remain in the active collect view.
- Image quality and asset fidelity: the hero is a dedicated 900 × 600-equivalent Jingchu landscape asset; the lower watermark uses a real alpha channel and no visible checkerboard, halo, placeholder, custom SVG or div-drawn illustration. WebP compression remains visually clean.
- Copy and content: the hero copy is “把眼前所见，留进共同图鉴”; the primary action remains “收存这条采集记录” after CloudBase initialization; raw filenames are not shown in the visible preview.
- Interaction and accessibility: upload preview, image/audio/video type switching, audio panel, location control, disclosure, checkboxes and submit affordance remain reachable. Focus outlines and reduced-motion behavior are defined. Required DOM ids are all present.

## Comparison History

1. First comparison found a P1 image-quality defect: the generated watermark contained a baked checkerboard transparency preview. Fixed by reconstructing a real alpha channel, saving `collect-scroll-watermark-v2.webp`, lowering visible opacity, and recapturing.
2. Second selected-state comparison found a P2 state defect: the upload instruction remained visible above the selected image because a component display rule overrode `.hidden`. Fixed with explicit hidden-state selectors and recaptured the selected-image state.
3. Earlier composition comparison found a P2 density mismatch: the hero plus an extra form introduction pushed the first field too far below the fold. Fixed by reducing the mobile hero to 333 px, hiding the redundant introduction, and tightening the sheet top padding.
4. Final Edge capture: 427 px document width, no horizontal overflow, all required ids present, scroll animation active, selected preview/audio/disclosure interactions pass, and no console, request, or HTTP errors.

## Focused Region Evidence

- Hero and roller: verified in `collect-top-427.png`; mountain/pavilion crop, editable headline, roller proportion and paper transition are readable at native mobile size.
- Selected image and side labels: verified in `collect-selected-427.png`; image crop, generic filename label, vertical editorial labels, location row, watermark and primary action are readable without nested-card clutter.

## Implementation Checklist

- [x] Preserve collect/cloud interaction ids and handlers.
- [x] Add a dedicated Jingchu landscape hero and real watermark asset.
- [x] Add one-time scroll-unfurl motion with reduced-motion fallback.
- [x] Match selected mock's side-label form hierarchy.
- [x] Verify default, selected-image, audio and disclosure states in Edge.
- [x] Pass CloudBase validation and horizontal-overflow checks.

## Follow-up Polish

- P3: after real user submissions provide a wider range of image aspect ratios, consider tuning `object-position` per EXIF orientation; current `object-fit: cover` is safe and visually consistent.

collect result: passed

---

# 楚韵链迹地图地点题签 Design QA

## Evidence

- Source visual truth, layout: `C:\Users\lenovo\.codex\generated_images\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\exec-77faa530-7e3c-4227-b89b-6e5c15f3a393.png`
- Source visual truth, illustration direction: `C:\Users\lenovo\.codex\generated_images\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\exec-02eb8a81-8eb2-410f-93dc-664e42cf7443.png`
- Dedicated illustration asset: `C:\Users\lenovo\.codex\generated_images\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\exec-eac39b52-1c3c-4dcd-abad-5af125dd2fc5.png`
- Browser-rendered mobile implementation: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-ticket-implementation-20260824\mobile-427.png`
- Browser-rendered tablet implementation: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-ticket-implementation-20260824\tablet-768.png`
- Browser-rendered desktop implementation: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-ticket-implementation-20260824\desktop-1440.png`
- Combined source/implementation comparison: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-ticket-implementation-20260824\comparison-source-implementation.png`
- Browser test report: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-ticket-implementation-20260824\report.json`
- Browser: Microsoft Edge through Playwright Chromium, headless, with the existing online Tailwind, Lucide, Leaflet, font and map resources loaded.
- Source layout pixels: 853 × 1844, normalized to 427 × 922 for comparison.
- Illustration source pixels: 2241 × 702, cropped responsively into a 3.15rem-high panoramic slot without stretching.
- Implementation pixels and CSS viewports: 427 × 922, 768 × 1024 and 1440 × 1000; deviceScaleFactor 1.
- State: map page open, route planner closed, “湖北省博物馆东湖片区” landmark focused, detail ticket open.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: the vertical location slip and landmark heading use Noto Serif SC; utility copy and actions use Noto Sans SC. Long location names remain readable without horizontal overflow; description is intentionally limited to one line to preserve the compact map-first layout.
- Spacing and layout rhythm: the final mobile ticket is 405 × 242 px, fixed 7 px above the map bottom and clear of the 60 px persistent navigation. The panel occupies about 26% of the mobile viewport; its extra height versus option 2 is the intentional accommodation for the user-selected option 3 panorama. Tablet and desktop use a 480 px right-aligned ticket rather than stretching across the map.
- Colors and visual tokens: paper ivory, lacquer brown, muted gold, Chu vermilion and patina green match the approved four-page system. There are no cold-gray borders or high-contrast red fields; verified, pending and exploration states retain text labels in addition to color.
- Image quality and asset fidelity: the popup uses a dedicated original East Lake ink panorama rather than a screenshot crop, placeholder, CSS drawing or handcrafted SVG. The image remains sharp at all three viewports and uses a restrained multiply treatment that integrates it with the paper surface.
- Copy and content: landmark title, description, reward points and status remain dynamic. Existing point semantics stay “积分”; visual work does not rename or alter the reward rule.
- Interaction and accessibility: close, collect, navigation, chain and discussion controls remain wired to their existing handlers. Close and all four actions have 44 px touch targets, visible focus styles, `aria-hidden` state updates and reduced-motion fallback.

## Comparison History

1. First Edge comparison found a P1 positioning mismatch: removal of the former `absolute` utility left the redesigned ticket in the map container's centered flex flow, so it floated in the middle of the screen. Fixed by restoring explicit absolute positioning and recapturing all three viewports.
2. The same comparison found a P2 density mismatch: the first implementation was 292 px high and used a two-line description. Fixed by reducing the illustration slot, tightening type and spacing, limiting description to one line, and recapturing. Final height is 242 px with all touch targets still 44 px.
3. Post-fix Edge capture reports no horizontal overflow, no console errors, and no clipping at 427, 768 or 1440 px widths. Discussion opening and collect-page navigation both pass.

## Focused Region Evidence

- Full-view comparison: `comparison-source-implementation.png` shows the same map-first composition, low paper ticket, vertical lacquer title slip, restrained action hierarchy and persistent bottom navigation as the selected option.
- Popup-focused evidence: `mobile-427.png` shows the panoramic ink illustration, dynamic reward, one-line description, primary collect action, secondary navigation and quiet chain/discussion actions at native mobile size. No further crop was required because all key details are legible in the full-resolution mobile capture.

## Implementation Checklist

- [x] Preserve `landmark-drawer`, `drawer-title`, `drawer-desc`, `drawer-points` and existing event handlers.
- [x] Use option 2's compact title-slip structure with option 3's ink panorama direction.
- [x] Keep the map visually dominant and bottom navigation unobstructed.
- [x] Add dynamic status text for verified, pending and exploration landmarks.
- [x] Verify 44 px touch targets, focus treatment, reduced motion and no horizontal overflow.
- [x] Pass CloudBase build validation and map-personalization tests.

## Follow-up Polish

- P3: a later content pass may supply location-specific panorama variants. The current East Lake ink artwork is intentionally decorative and does not claim to be documentary photography of every landmark.

map ticket result: passed

---

# 楚韵链迹地图路线手记侧栏 Design QA

## Evidence

- Source style truth, selected title-ticket direction: `C:\Users\lenovo\.codex\generated_images\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\exec-77faa530-7e3c-4227-b89b-6e5c15f3a393.png`
- Source style truth, implemented location ticket: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-ticket-implementation-20260824\desktop-1440.png`
- Pre-change desktop baseline: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-planner-redesign-20260824\desktop-both-before.png`
- Browser-rendered desktop, point clicked with planner hidden: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-planner-redesign-20260824\desktop-marker-default-hidden.png`
- Browser-rendered desktop, planner explicitly opened: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-planner-redesign-20260824\desktop-planner-open.png`
- Browser-rendered mobile planner: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-planner-redesign-20260824\mobile-planner-open.png`
- Full-view comparison: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-planner-redesign-20260824\comparison-desktop-before-after.png`
- Focused planner comparison: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-planner-redesign-20260824\comparison-planner-focused.png`
- Browser interaction report: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\map-planner-redesign-20260824\after-report.json`
- Browser: Microsoft Edge through Playwright Chromium, headless, with existing online Tailwind, Lucide, Leaflet, fonts and map tiles loaded.
- CSS viewports and image pixels: desktop 1440 × 1000 and mobile 427 × 922, deviceScaleFactor 1; comparison captures retain the same state and dimensions before normalization.
- State: map opened with planner initially collapsed; a real Leaflet heritage marker clicked; location ticket open; planner then opened and closed through the existing toggle function; mobile route item added to expose sorting/removal controls.

## Findings

- No actionable P0, P1 or P2 findings remain.
- Fonts and typography: the planner now uses Noto Serif SC for the vertical “路线手记” slip and section headings, with Noto Sans SC for controls and route metadata. English is limited to the small editorial eyebrow and paired with “楚地寻访”; long Chinese titles wrap without clipping.
- Spacing and layout rhythm: desktop keeps the established 370 × 804 px side-rail footprint; mobile uses a 411 × 650 px bottom sheet. The illustration, title slip and section spacing establish the same hierarchy as the location ticket without reducing the scrollable route workspace.
- Colors and visual tokens: the former white/gray SaaS cards are replaced by xuan-paper ivory, warm apricot surfaces, lacquer brown actions, muted gold and patina green states. Large red blocks and cold gray outlines are absent.
- Image quality and asset fidelity: the planner reuses the approved 50 KB original ink panorama asset at the correct aspect ratio. It is not a screenshot crop, placeholder, CSS drawing or handcrafted SVG, and it remains sharp at desktop and mobile sizes.
- Copy and content: route planning, recommendation, transport and navigation copy remains unchanged except for the clearer header sentence “挑选点位，按自己的节奏编排行程。” No recommendation, distance, point or route logic changed.
- Interaction and accessibility: initial desktop state is collapsed with `aria-hidden=true`; clicking a real exploration marker opens the location ticket while the planner remains collapsed; only explicit “行程篮” opening sets `aria-hidden=false`. Closing restores the collapsed state. All exposed planner buttons, including clear, move, reorder and remove, measure at least 44 × 44 px; no horizontal overflow or console errors were recorded.

## Comparison History

1. Baseline showed the planner automatically open on desktop because `initializeMapPlanner()` expanded at widths above 768 px, and marker selection expanded it again through `selectMapPlannerPoint()`. Fixed by initializing collapsed, adding the collapsed class in HTML to prevent first-paint flash, removing implicit expansion from point selection, and preserving the explicit `planner=open` override.
2. First post-style touch audit found the “清空”、前移、后移 and remove controls below the 44 px target. Fixed with scoped planner touch-target rules and re-ran the mobile route-item state. Final report records 44 px for all four controls.
3. Final visual comparison confirms the side rail now shares the same vertical lacquer title slip, ink panorama, paper surface, restrained radii and flat action hierarchy as the location ticket. The map remains visible and scroll behavior is unchanged.

## Focused Region Evidence

- `comparison-planner-focused.png` compares the exact 370 × 804 px side-rail region before and after, showing removal of cold borders, addition of the ink header and preservation of the same route content hierarchy.
- `desktop-planner-open.png` shows the redesigned planner and location ticket simultaneously, allowing direct inspection of shared colors, imagery, title treatment and action hierarchy.
- `desktop-marker-default-hidden.png` verifies the user's requested first-click state: the point detail appears while the planner side rail is absent.

## Implementation Checklist

- [x] Planner hidden on first desktop map load.
- [x] Planner remains hidden after the first exploration-point click.
- [x] “行程篮” remains the explicit open control; close restores hidden state.
- [x] “行程篮” trigger is visually discoverable with a warm-apricot paper surface, lacquer-brown label, vermilion route icon and gold-on-lacquer count badge, while the location action remains primary.
- [x] Existing selection, recommendation, ordering, transport and navigation handlers remain intact.
- [x] Desktop and mobile planner surfaces match the approved location-ticket system.
- [x] All planner controls pass the 44 px touch-target check.
- [x] CloudBase build validation and deterministic map-personalization tests pass.

## Follow-up Polish

- P3: after real route baskets contain many points, evaluate whether the vertical title slip can collapse while scrolling to expose one additional route item on short laptop screens; current fixed header is clear and stable.

final result: passed

---

# 楚韵链迹“我的”图鉴厅视觉重构 Design QA（2026-08-27）

## Evidence

- Approved reference: `C:\Users\lenovo\.codex\generated_images\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\exec-bcc7be6a-69da-4b51-b034-73d406806191.png`
- Browser-rendered mobile implementation: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\profile-redesign-local-20260827.png`
- Same-input visual comparison: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\profile-reference-comparison-20260827.png`
- Browser-rendered desktop implementation: `C:\Users\lenovo\.codex\visualizations\2026\08\16\01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8\profile-redesign-desktop-20260827.png`
- Browser: Codex in-app Browser, local static preview.
- CSS viewports: mobile 390 × 844 and desktop 1280 × 800.
- State: anonymous CloudBase profile loaded, zero submissions, “作品” filter active.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Visual unity: the profile page now shares the dark lacquer-and-gold global header used by the activity, collect, and map experiences. The content surface remains xuan-paper ivory with a restrained real raster phoenix-and-landscape watermark.
- Hierarchy: identity is open and unboxed; statistics use a quiet ledger row; the warm-apricot Jingchu Atlas banner is the main cultural anchor; field notes follow as a separate editorial section instead of a SaaS dashboard stack.
- Empty state: the former text-only placeholder is replaced by a compact display-case composition using a dedicated classical Jingchu still-life asset, a human invitation, and one primary collect action. The final mobile revision keeps artwork, copy, and action in one landscape panel above the persistent navigation.
- Assets: decorative imagery uses project raster assets (`collect-scroll-watermark-v2.webp`, `community-landmark-yellow-crane-v2.webp`, and the ImageGen-created transparent `profile-empty-chu-vessel-v1.webp`). No placeholder box, CSS drawing, handcrafted SVG illustration, or emoji substitute was added.
- Responsive behavior: the 390 px layout preserves two-column collection cards and the fixed five-item navigation; the 1280 px layout remains centered at the established 760 px profile width and does not stretch editorial content across the screen.
- Interaction: settings still expands the existing utility menu, refresh and filters remain bound, and “去完成第一次采集” switches to the real collect view. Existing account, CloudBase record, atlas, badge, and reward handlers are unchanged.
- Accessibility: interactive targets remain at least 44 px, focus-visible treatment is retained, decorative images are hidden from assistive output, status still includes text labels, and reduced-motion behavior is unchanged.

## Comparison History

1. First comparison showed the empty display case stacking vertically on mobile, pushing its action underneath the persistent navigation. Fixed by retaining a compact two-column exhibit layout and reducing artwork height without shrinking the 44 px CTA.
2. Final comparison confirms matched structural rhythm: dark compact header, paper identity field, three-number ledger, warm atlas banner, editorial field-notes heading, four flat filters, and a culturally specific first-collection state.
3. The implementation intentionally keeps live atlas preview photographs rather than baking the reference artwork into the interface; this preserves real submission preview behavior while maintaining the approved collage composition.

## Verification

- [x] CloudBase build validation passed.
- [x] Map personalization regression suite passed (11/11).
- [x] `git diff --check` passed.
- [x] Settings menu opens and reports `aria-expanded=true`.
- [x] Empty-state CTA switches to `#view-collect`.
- [x] No merge, deployment, commit, or CloudBase data change performed.

final result: passed
