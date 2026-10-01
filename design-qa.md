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

---

# 首页纸本双层插画 Design QA（2026-09-29）

## Evidence and scope

- Source visual truth: `C:/Users/lenovo/.codex/state/plugins/product-design/assets/chulink-ref-01-teayan-paper-illustration.jpg` (1280×2781), plus user-selected header crop `C:/Users/lenovo/AppData/Local/Temp/codex-clipboard-3052da95-d127-4f43-b913-38a53c0998ec.png` (606×216).
- This is an explicitly approved **art-direction adaptation** for the existing homepage, not a pixel clone of a tea-shop personal account page. Different product copy, no WeChat/status-bar chrome, original wordmark/flowers, and a taller homepage introduction are intentional. Compare paper continuity, foreground/background hierarchy, illustration integration, type and density; do not claim identical functional state or content with the tea app.
- Evidence directory: `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-home/`.
- Implementation screenshots: `final-home-320.png`, `final-home-390.png`, `final-home-768.png`, `final-home-1440.png`; open-menu and restored-profile states: `final-menu-*.png`, `final-profile-*.png`.
- Browser: independent Microsoft Edge / Playwright, explicitly permitted by user after in-app browser connection failed. No saved login session. CSS viewports equal screenshot pixels: 320×844, 390×844, 768×844, 1440×1000; deviceScaleFactor=1.
- Full-view same-input comparison: `comparison-paper-reference-final.png`. Reference normalized to 390px width (about 847px high), implementation 390×844, no app stretching. The reference's phone chrome is non-target material.
- Focused same-input comparison: `comparison-header-reference-final.png`. Header reference normalized to 390px width; implementation's 390×315 hero compared beside it. Region-height difference is explicit because the implementation includes the approved homepage introduction.
- State: homepage top, more menu closed, existing local fallback discovery feed, no authenticated user. Separate captures and tests cover menu open, help, navigation, search/filter, image failure and motion.

## Findings / five fidelity surfaces

- No actionable P0/P1/P2 findings remain within the approved homepage scope.
- Typography: original raster brush wordmark with real transparency; four characters checked. Editorial titles retain Noto Serif SC / Songti / SimSun fallback; body and utility controls retain the existing Noto Sans SC stack. Menu copy shortened to “我的账号 / 使用帮助” to avoid wrapping. Body text is not converted to brush lettering.
- Spacing/layout: no standalone dark header, no background badge behind the logo. 315px mobile hero and approximately 368px desktop hero place the stable wordmark and invitation on quiet paper; four quick links remain an unboxed row. 44px new utility targets, no horizontal overflow even at 320px. Desktop art extends beyond the centered reading column and fades at the edges.
- Color/tokens: #f8f4eb paper, #30392e ink, #756e5e secondary text, #a7493d selected/action red, muted sage/gold accents. Earlier competing page gradient was explicitly removed only for the homepage; filters now use type/underline instead of dark filled buttons. Semantic content colors elsewhere are preserved.
- Image quality: new original 1536×1024 painted lotus/osmanthus/river illustration and 1000×264 transparent wordmark are real WebP assets in the repository. Center is readable, flowers crop responsively, no boxed bottom edge, no checkerboard/white halo. CSS masks blend the raster layer; they do not synthesize the artwork. Existing quick-link and navigation icons are intentionally retained outside this limited asset replacement.
- Copy/content: headline is “把眼前所见，留进共同图鉴。”; caption is product-specific and concise. Account/help/location/notifications preserve their original handlers and state sources. No invented user records, cloud-write success or historical claims added by this work.

## Comparison history and corrections

1. P2: first open-menu capture wrapped the long account aria-label into two lines. Fixed visible copy only; kept original accessible label and event binding. Verified in `final-menu-390.png` and all wider captures.
2. P2: initial desktop raster region ended in hard vertical edges and the old page gradient created a separate paper column. Fixed homepage background override and viewport-wide artwork with lateral/bottom fades. Re-captured `final-home-1440.png`; no opaque rectangular art boundary remains.
3. P2: menu activation could hide the focused account/help button. Added focus restoration and focus handoff for existing help/login dialogs. All four viewport help open/close keyboard tests pass; real cloud login flow remains outside this safe offline write-blocked test.
4. P1 release-readiness: original static packaging allowlist omitted newly referenced CSS/JS. Added both files and required asset checks. Did not run deployment.
5. Final combined-reference review: confirmed original paper art direction, foreground logo independence, light controls, quiet background fade and responsive proportions. Differences from the tea reference are the intentional product adaptation stated above, not a claim of pixel identity.

## Interaction and verification

- `verification-report.json`: **55/55 checks passed**, no uncaught JavaScript exceptions. Search, both filters, More / ArrowDown / Tab / Enter / Escape, help focus, four-page shell restoration, breakpoint transitions, direct profile entry, image-failure fallback, parallax and reduced motion checked.
- All external non-GET/HEAD/OPTIONS requests were blocked in test contexts. The sole failed-resource endpoint was CloudBase anonymous-sign-in POST; its resource console errors are expected test isolation, not claimed to be fixed. No real login, notification-data fetch, database write or submission success tested.
- Original account node is retained, not cloned. Personal-page shell computed colors/fonts/boxes match the before-change baseline. Before/after screenshots have slight asynchronous raster differences; not claimed pixel-identical.
- Desktop scrolling 200px produces 24px background drift; wordmark remains in normal flow. Reduced-motion capture has animation `none`.
- `node tools/validate-cloudbase-build.js` passed: 38 required files / 21 JS files / 5 inline scripts / 8 sticky modal headers. `git diff --check` passed.
- Independent read-only review checked control relocation, focus, CSS scoping and packaging. No remaining blocking finding.

## Implementation checklist

- [x] Original background and wordmark, separate front/back layers.
- [x] Homepage only; other four page shells restored on navigation.
- [x] Existing handlers, ids, cloudbase-app.js and unrelated loading changes preserved.
- [x] Mobile/tablet/desktop plus 320px and reduced-motion evidence.
- [x] Original asset prompts and resumable work record saved in docs.
- [x] No commit, push, merge or deployment.

## Follow-up polish / test gaps

- P3: user aesthetic review may tune flower intensity, logo scale or motion amplitude; present this as a local first version, not a final brand identity.
- Existing remote feed images and real authenticated workflows were not in scope; do not interpret this visual pass as production end-to-end validation.

final result: passed

---

# “我的”纸本插画改版 Design QA（2026-09-29）

## Evidence / approved adaptation

- Source: `C:/Users/lenovo/.codex/state/plugins/product-design/assets/chulink-ref-02-teayan-profile.jpg`, 1280×2781. User approved light identity card + small refined badge row, explicitly asking to follow the already-approved homepage art direction.
- This is an adaptation, not a pixel clone of tea-commerce membership: no QR membership code, level bar, balance/coupon data, copied logo, or phone/WeChat chrome. The real Chu profile stats, atlas/rewards entry and submission gallery remain. The taller original wordmark/floral field and combined identity/stats card are intentional.
- Evidence root: `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-profile/`.
- Full combined evidence: `comparison-final.png` contains source / baseline / implementation together. Source is cropped 154px from top to remove most phone status area, then resized to 390×800; baseline and implementation are 390×844, DPR1, profile top, menus closed. The source retains tea-specific authenticated account content; baseline/new app have identical QA fixtures. No pixel-diff fidelity claim across different businesses.
- Focused comparison: `comparison-badges-final.png`, both crops at390 CSSpx width, same closed-preview state. New row has three56px original badges vs reference four larger tea badges, as approved.
- Final implementation: `final-profile-{320,390,768,1440}.png`, `final-profile-full-*.png`, `final-settings-*.png`, `final-badges-*.png`, `final-empty-*.png`, `final-long-name.png`, `final-text-200.png`, `home-regression-*.png`. Browser Edge, explicitly approved isolated Playwright, no persistent login.
- Viewports320×844 /390×844 /768×844 /1440×1000; screenshotpixels=CSSpixels, deviceScaleFactor1. Full-page captures are taller and show a fixed bottom nav at the original viewport position; use viewport captures for above-the-fold judgment.
- Populated/empty screenshots use browser-only synthetic data passed to the original renderer. The route-injected QA hook never enters repository product files. Fixture pictures are local assets, not alleged user submissions. Offline screenshots separately show real blocked-auth state.

## Findings / five required surfaces

- No actionable P0/P1/P2 findings remain in this approved visual scope.
- Typography: shared original brush wordmark is a raster asset, not a font imitation. Section headings use existing Noto Serif SC/Songti fallback with restrained500 weight; body remains existing sans stack. Removed redundant English kickers. Record titles13px, metadata/status10px; original filename-hiding title function retained. Long nickname wraps within card without overflow.
- Spacing/layout: short164px mobile/240px desktop top composition, identity card overlaps by22px; no standalone dark header. Three badges56px mobile/66px desktop in one light strip. Mobile atlas description removed visually to keep compact104px entry; works heading begins near642px at390 width. Settings targets at least44px; works/gallery remains two-column. No horizontal overflow at320px or breakpoint resizing.
- Color/tokens: exact shared homepage variables (#f8f4eb paper / #fffcf5 surface / #30392e ink / #756e5e secondary / #a7493d accent / #6c8170 sage). Very light card shadows, no gray perimeter. Existing green/gold review states retained; empty-state action now light apricot instead of black-brown.
- Image quality: reused original painted lotus/osmanthus background and transparent wordmark; new original architecture, bell/phoenix and field-notebook botanical linework badges. PNGs inspected; alpha-preserving256px WebPs are35–38KB. At56px they read as a cohesive delicate row; final separate enlarged preview retains detail. No copied tea brand marks, custom CSS/SVG art or device chrome. Background is behind card, never across avatar or text.
- Copy/content: truthful “图样预览” disclosure and “不代表已获得的成就”; no invented earned count/date/progress. Legacy demo wall hooks retained but hidden within the paper profile. Nickname/stats/rewards/submission rendering uses original IDs and event listeners. Atlas's original badge-target link relabeled“徽章图样” to match its actual destination.

## Comparison history / fixes

1. P2 density: initial combined comparison (`comparison-initial.png`) showed double padding inside atlas and excessive height; removed nested padding, shortened mobile entry and reduced badges56px. Final comparison exposes the first works thumbnails near the fold.
2. P2 focus: read-only review found menu dialogs did not restore opener focus and single-frame check missed delayed authentication. Added real class-state observation on existing modals, opener restoration, input-first focus, and inline-edit focus handling.350ms delayed-notification test passes.
3. P1 settings hit area: automatic pointer test found inherited high-specificity app z-index let identity card cover lower menu. Inspected matched CSS rules; split artwork0 / card1 / utilities3 with no hero stacking context. Initial blunt hero raising caused art over avatar; that intermediate version was rejected. Re-captured final settings and desktop/profile images: menu clickable, paper card opaque and clear.
4. P2 nickname keyboard state: modal opened but close button received first focus. Prioritized text input; nickname modal value and input focus now pass all four widths, and closing returns to inline pencil.
5. Final combined full-page and badge close-up review: consistent continuous paper / original floral top / restrained identity card / light badge row. Intentional business differences above remain, not unresolved fidelity bugs.
6. P2 enlarged-text navigation: root font200% made“活动科普”wrap outside the old fixed68px bar. Made profile mobile navigation height content-driven with68px minimum and safe-area padding. Final `final-text-200.png` and label-containment test confirm the whole label remains within the bar. Normal-size navigation remains68px.

## Tests / limitations

- `verification-report.json`:99/99 checks passed;0 uncaught JS exceptions. Settings ArrowDown/Escape, help/edit/async-message focus, preview/rewards disclosure,4 original filters, cancel consent removal, empty CTA, all five navigation routes, homepage menu return, resizing, long name, root font200% including navigation-label containment, normal/reduced motion, wordmark failure fallback.
- Only client rendering and navigation tested. All non-GET/HEAD/OPTIONS requests blocked (74 requests); expected CloudBase anonymous-login resource errors and intentional missing-wordmark404. No authenticated production login, nickname save, notification contents, reward redemption, or submission write verified.
- CloudBase build43 files/22 JS/5 inline scripts/8 sticky headers passed; map personalization11/11; git diff check passed.
- cloudbase-app.js SHA256 unchanged from task start:33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0. Original unrelated loading and consent changes preserved. No backend edits, merge, commit, push or deploy.

## Checklist / follow-up

- [x] Source and implementation opened together; focused badge comparison inspected.
- [x] Original handlers and data sources retained; badges explicitly only design previews.
- [x] Mobile/tablet/desktop, menu, content/empty/offline states captured.
- [x] Asset prompts and resumable progress recorded.
- P3: user may prefer slightly darker badge ink or different floral intensity after viewing. Existing remote avatar remains the prior product default; real avatar editing and actual achievement system are separate work, not implemented here.

final result: passed

---

# Community paper field-notes edition — 2026-09-30

## Scope and visual truth

- User approved a dedicated hand-painted activity cover and retaining a thinner, lighter red route ribbon. Local visual work only; not an exact clone of the reference tea brand.
- Source: `C:/Users/lenovo/.codex/state/plugins/product-design/assets/chulink-ref-03-teayan-home.jpg` (1280 × 2781), with `chulink-ref-01-teayan-paper-illustration.jpg` for the continuous-paper illustration treatment.
- Previous implementation: `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/community-paper-audit-20260930/01-community-top-390.png`.
- Implementation: `http://127.0.0.1:4180/?view=community&preview=community-paper-v1`.
- Evidence folder: `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/community-paper-redesign-20260930/`.
- Combined source / before / after input: `comparison-reference-before-after.png` (1194 × 844). Source scaled to contain within a390 ×844 panel without cropping; implementation/before each390 ×844 CSS px at deviceScaleFactor1. Source includes mobile OS chrome and a different commercial product; those intentional differences are not scored as fidelity bugs.
- Rendered final screenshots: `community-top-390.png`, `community-top-320.png` (320 ×844), `community-top-768.png` (768 ×1000), `community-top-1440.png` (1440 ×1000). Also captured full pages and lower study sections.
- Focused evidence: `route-expanded-390.png`, `quiz-correct-390.png`, `quiz-wrong-320.png`, `community-learning-390.png`, `focus-button.png`, `community-text-200.png`. Some interaction captures contain the existing transient toast; it is not a permanent design element.
- State: guest, static activity copy retained, local quiz/learning state in isolated browser profiles. No production identity, private contents, or writable requests used.

## Findings and required fidelity surfaces

- No remaining actionable P0/P1/P2 visual findings within this approved scope.
- Typography: original Noto Serif SC/Songti/SimSun heading stack,29px mobile/36px desktop event title,20px section titles,13–14px main explanation. Original body sans stack preserved. Small metadata remains11–12px. Lower weight and removal of gold text/shadow reduces competing accents; tea-brand calligraphy is intentionally not copied.
- Spacing/layout: continuous paper header/cover; no desktop hero box. Illustration is separate from real text,172px on mobile; desktop cover splits text/art. Content margin18px mobile and28px desktop;8px card radii and very subtle shadow. Three stops retain real buttons while decorative connector passes through the marker centers; buildings are separated from markers/labels. No overflow at320/390/768/1440.
- Colors: paper #f8f4eb / surface #fffcf5 match home/profile; ink #30392e and muted #756e5e. Red is limited to activity/signup and restrained route markers. Quiz starts with pale sage, correct/wrong states remain distinguishable by explicit text and existing class logic, not color alone.
- Images: original alpha WebP illustration1200 ×800,357KB, inspected on paper and in browser; no opaque white rectangle, dark photo overlay, or borrowed commercial artwork. Existing route/quiz/learning assets retained at a quieter scale. The new SVG is a functional route connector, not a substitute for hand-painted illustration; no landmarks or cover art were drawn with CSS/SVG.
- Copy/content: event title, status, description, original route metadata and learning contents unchanged. No invented event registrations, historical provenance, or successful backend operation claims. Hero art explicitly documented as conceptual and decorative (empty alt/aria-hidden).
- Icons/controls: original Lucide icons and handlers retained. Active community restyles only original page-header nodes, does not duplicate or relocate them. Visible activity buttons at least44px in both dimensions. Keyboard focus visible; reduced-motion override; enlarged-root-font navigation labels stay inside an auto-height bar.

## Comparison history

1. P1: first mobile capture revealed old `height: ... !important` leaving signup below the hero box and covered by the next section. Set scoped hero height to `auto !important`; added a real hit-test for signup. Final screenshot shows all three actions above the route card; all four hit-tests pass.
2. P2: initial combined comparison/desktop capture showed the old brown page gradient and thick hero/signup shadows surviving the new stylesheet. Removed them with correctly scoped/high-specificity overrides. Re-captured and inspected final combined board plus desktop/tablet: paper is continuous, no floating hero rectangle remains.
3. Test correction, not product change: initial programmatic mouse-mode focus and offline account expectations were misleading. Keyboard-mode focus passes after Tab. Account listener requires blocked anonymous authentication POST; retained original binding verified, authenticated flow explicitly excluded rather than reported as passing.
4. Final accessibility pass uses an auto-height mobile nav,200% root text screenshot, keyboard outline screenshot, and all four viewport captures. No action hidden by another section, no horizontal overflow, no route image/marker/label overlap.
5. Independent read-only diff review confirms no business changes: dynamic template only adds decorative SVG; IDs, actions, state transitions, CloudBase code remain as baseline.

## Verification and limitations

- `qa-report.json`:84/84 checks passed,0 uncaught JavaScript errors. Blocked63 non-GET/HEAD/OPTIONS requests. Checks include route disclosure, correct/wrong locks, quiz reload persistence, two distinct dynamically refreshed learning cards and original dialog, original control identity over home/community/profile/map and767/768 breakpoint, help, keyboard focus, enlarged text.
- Full real authentication, cloud sign-up/discussion, rewards or production writes were not tested; all are outside this safe local visual check. Existing account button and original listener retained. Do not interpret local quiz points as validated cloud rewards.
- Static validation:45 files,22 JS,5 inline scripts,8 sticky modal headers passed. Existing map personalization11/11 passed; git diff whitespace check passed.
- cloudbase-app.js SHA256 remains `33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0`; backend worktree remains untouched and clean.
- No commit, push, merge or deployment. Existing unrelated dirty files preserved; new progress/provenance documents explain the safe future visual-only release path.
- P3: the existing small learning thumbnails still reuse prior architectural/bronze assets. A future dedicated semantic illustration set may improve them; this pass deliberately concentrates the new original drawing in the activity cover.

final result: passed

---

# Community paper detail edition v2 — 2026-09-30

## Brief / evidence

- User requested a richer local version, with larger antique hand-drawn background motifs, no questions and no merge. This is a visual-only continuation of v1, not a new flow or a deployment.
- Reference: `C:/Users/lenovo/.codex/state/plugins/product-design/assets/chulink-ref-01-teayan-paper-illustration.jpg`, viewed for large edge illustration / continuous paper composition. Existing project cover remains original, not a copied tea-brand image.
- Evidence root: `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/community-paper-detail-20260930/`.
- `draft-v1-v2-comparison.png` and `draft-top-1440.png` show the stronger first pass. `comparison-reference-before-after.png` compares the tea homepage, v1 and v2; reference panel is contained, with different business/chrome intentionally retained.
- `final-v1-v2-comparison.png`: v1 left, v2 right, each 390×844, DPR1, top-of-page guest state. `final-top-1440.png`: desktop 1440×1000. `community-top-{320,768}.png` capture narrow mobile/tablet; all use isolated Edge, no persistent login.
- `final-lower-{390,1440}.png` are clean study-area captures. Interaction captures include route disclosure, correct/wrong answer, focus and root-font enlargement; some retain the existing transient toast, not permanent layout.

## Changes / visual critique

- One signature addition: an original transparent phoenix-feather scroll / river-and-reeds drawing, 1024×1536 WebP, 400086 bytes. Internal image generation used; full prompt and source recorded in `docs/COMMUNITY_PAPER_V2_ASSETS.md`. This is conceptual ornament, not a historical reconstruction.
- First pass at 30% mobile / 33% desktop was too assertive and visibly cut at desktop container edges. Final opacity 24%, desktop horizontal edge fade over 12% on each side. Page has no dark hero block and no repeat wallpaper; lower reading surfaces remain calm.
- Typography uses v1 heading/body families. Small ongoing seal, separate settlement note, short title rule and vertical cover imprint add detail without adding new claims. Mobile cover enlarged from172 to192px. Decorative caption excluded from accessibility tree.
- Route landmarks enlarged from52×33 to64×40px; marker/building/label spacing verified independently. Fine2.2px ribbon remains, at70% opacity, aligned with28px markers. Card corners and shadows are subtle; route progress and learning thumbnails get light paper-colored grounds.
- Quiz/learning card background raised to97% opacity after review to avoid pattern through body text. Removed the trial “共学” pseudo-label that squeezed into the bronze illustration row.
- 320px screenshot review found the secondary task button wrapping; scoped non-wrapping intrinsic width corrected it, retaining44px targets. No overflow or covered actions at all tested widths.
- Independent read-only review checked code and final mobile/desktop screenshots: no remaining blocking visual findings. All scripts, existing IDs and event attributes match the v2 baseline; community-only CSS does not alter other pages.

## Verification / limits

- 92/92 checks passed;0 uncaught JS errors. Includes background resource availability/non-interception, mobile/tablet/desktop layout, touch targets, route expansion, quiz correct/wrong/reload, learning refresh/modal, cross-page original-node preservation, focus and200% root-font navigation containment.
- All non-GET/HEAD/OPTIONS requests blocked (63). Real cloud authentication, registration and reward writes not tested or claimed.
- Build46 files/22 JS/5 inline scripts/8 headers passed; map tests11/11; whitespace diff check passed. `cloudbase-app.js` SHA256 remains `33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0`.
- Backend worktree left untouched and clean at `1fbfcafce75956ea2080dac9155bdb75c1c96a09`. Preserved all prior UI dirt. No commit, push, merge or deployment.

final result: passed

---

# Collection / map paper-edge edition — 2026-09-30

## Approved scope and evidence

- Remove remaining dark title blocks on collection/map, retain their existing good design, add small illustrated refinements. Local preview only. No remake of the form, cartography, point drawer or route planner.
- Existing paper homepage supplies the shared original brush wordmark; collection keeps its mountain painting/scroll, map reuses its own ink-painted pavilion. No new generated imagery, no new brand art copied from references, no page-wide decoration over map tiles.
- Evidence: `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/field-paper-20260930/`. `before-{collect,map}-{390,1440}.png` are pre-change captures; `final-{collect,map}-{320,390,768,1440}.png` are final top captures. Edge, DPR1, mobile390/320×844; tablet768×1000; desktop1440×1000. Guest, isolated storage, no cloud writes.
- `comparison-collect.png` / `comparison-map.png` compare original left and result right at390×844 each. `preview-both-pages.png` shows the final two pages. `menu-*`, `form-*`, `planner-*`, `point-*`, `text-200-map.png` capture interactive/large-text states. Test file/note are local-only fixtures and never submitted.

## Visual and interaction decisions

- Typography: shared original raster wordmark,160px desktop/148px mobile; original serif headings softened to600 weight. Collection headline31px mobile/38px desktop. Original body fonts/form labels retained.
- Paper color #f8f4eb / surface #fffcf5 / ink #30392e / sage #58725f match latest paper pages. The original scroll roller, form watermark, landmark tickets and planner illustrations retain their existing appearance.
- Collection wordmark/controls live within the original landscape. First desktop pass moved text into darker hills; a feathered paper wash behind the text/navigation corrected legibility without replacing the painting or boxing the title.
- Map top edge remains only68px mobile, with50px navigation added on desktop. Ink art is clipped to this margin, at19–20% opacity, and softly drifts over14 seconds. No overlay intercepts map gestures; prefers-reduced-motion, offscreen and document-hidden states pause decoration. Original collection scroll/parallax retained.
- Original account/help nodes move into a small “更多” disclosure; notification node retains original data-driven visibility. Original GPS button remains in hidden header for other pages, while collection/map retain their own existing location controls. No duplicate GPS action added.
- Original shared relocation coordinator alone owns nodes. Field helper manages focus/disclosure/motion/layout, not business handlers. Menu keyboard, Escape, outside/focus close, help focus handoff and image fallback are covered.
- Independent review found map400-level children could escape above global dialogs; map isolation fixed this. Navigation height is measured for enlarged text, and existing Leaflet gets size-only updates after geometry changes. Initial large-text tool controls wrapped vertically; fixed padding/icon spacing and non-wrapping labels keep the small control group readable.
- Initial mobile comparison and final desktop review preserve page identity: illustrated scroll for collecting, geographic canvas with a narrow ink edge for exploring. No remaining blocking visual finding in this scope.

## Verification interpretation

- Two test runs encountered real external Tailwind/Lucide CDN failures and were rejected; resulting wrong-page/native-control screenshots are not completion evidence. Failure reports retained. Final suite reuses actual successfully fetched framework script bytes across isolated contexts; source URL/byte count/SHA256 are in report. It does not replace application code or claim the original CDN reliability has been fixed.
- A test selector initially compared the shared help button to the first matching tutorial button in document order. Corrected it to the original `aria-label="使用帮助"` node. No product code change was made to satisfy that faulty assertion.
- Build validation48 files /23 JavaScript /5 inline scripts /8 sticky modal headers, map rules11/11 and whitespace checks pass. All3 non-empty `index.html` inline scripts and159 event attributes are identical to the task baseline.
- `static/cloudbase-app.js` hash stays `33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0`. Backend untouched and clean at `1fbfcafce75956ea2080dac9155bdb75c1c96a09`.
- No authenticated cloud login, microphone, true geolocation, upload submission, consent or rewards were tested. Browser denied/intercepted writable requests; local form media preview and unsent notes only.
- No commit, push, merge or deployment. Progress/recovery and future narrow-release constraints saved in `docs/FIELD_PAPER_REDESIGN_PROGRESS.md`.
- Final suite: 182/182 checks passed, 0 uncaught JavaScript errors, 120 non-read-only network requests blocked. Includes four viewport widths, 200% root-font layout, reduced motion, original-node preservation, local collection preview/reset, point drawer and route basket. Paired final preview manually reviewed.
- Desktop map gray top/left margins are also present in `before-map-1440.png`; existing tile bounds in `static/map-config.js` limit the original map coverage. Not a new header/layout regression. Map bounds and zoom behavior were deliberately preserved.

final result: passed

---

# Quiet signatures / painted-paper editorial — 2026-10-01

## Scope, references and fidelity target

- Approved staged local development from the latest two feedback messages: reduce oversized brand lettering, soften map borders, preserve ink-wash/scroll artwork, selectively adopt painted collage and handwritten titles, and preview a future dismissible seasonal entry. No admin/account provisioning, backend work, merge, commit, push or deployment.
- Four user-supplied tea mini-app screenshots are style references, not literal layouts or live flows to clone. Borrow fine text with generous image space, irregular paint/torn edges, bilingual brand hierarchy and expressive short brush titles. Do not borrow tea trademarks, products, membership terminology or campaign claims.
- Evidence root: `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-editorial-20261001/`. Baseline `before-{view}-{390,1440}.png`; final `after-{view}-{320,390,768,1440}.png`, for discover/profile/collect/map/community. Guest isolated Edge, DPR1, mobile height844/tablet-desktop1000, writable requests blocked. Baselines and final captures are top-of-page states; dynamically selected learning content is not a fidelity mismatch.
- Main agent viewed `reference-implementation-comparison.png` (4 original references above 4 corresponding adaptations), `before-after-community-collect.png`, `map-desktop-before-after.png`, actual mobile frames and desktop map/profile/community. The reference row is contained to390×844 with original status chrome; product row is actual390×844 browser content, not a pixel-clone claim. `preview-three-pages.png` shows final collection/map/community together, with source screenshots unchanged.

## Five-surface design decisions

- **Composition:** one visual lead per page. Homepage/profile keep their original flower/leaf paper; collection keeps its original landscape and scroll; community receives its own transparent river/field-notes collage. Map becomes a full-width geographic canvas, not another illustrated poster.
- **Type:** existing original Chinese brand image becomes106–116px on home/profile,92px on collection/map; CHULINK is quiet auxiliary lettering. Community's plain heading is reduced to16px. Locally served Long Cang brush face applies only to four short static headline roles, not body text, form labels, navigation, map labels or user-generated content. OFL license is included; the23992-byte subset has fallbacks and no altered glyph drawings.
- **Color:** retain continuous warm paper#f8f4eb, ink#30392e, sage#58725f and ochre#b38c45; the new illustration supplies modest blue/green/ochre variation without introducing another dark hero. Existing community phoenix watermark reduced to16% so it stays secondary to the new collage and readable copy.
- **Detail and image fidelity:** original generated RGBA collage is1536×1024,463070bytes; river/reeds/willow/pavilion/notebook are conceptual ornament, not evidence of a real place or historical form. Full prompt/source/encoding retained in `docs/PAPER_EDITORIAL_ASSET_20261001.md`. It is contained, not cropped. Existing artwork remains recoverable.
- **Interaction and responsive fidelity:** old DOM nodes/handlers survive; menus retain keyboard/focus behavior. New seasonal note is an explicitly labeled local sample, disabled in production source, dismissible per session, hidden off discover/community and while global dialogs are open. Its44px close target is separated from the trigger; a short-screen panel scrolls internally. No new registration, cloud writes, countdown or attendance data.

## Revisions from actual checks

- Map gray borders were not just a CSS frame: the existing online TileLayer.bounds cropped tiles. Only the configured HTTPS Autonavi online tile layer now fills the visible canvas. Original Map.maxBounds, center/zoom rules, coordinates, routes and offline behavior remain. Feathering lives inside tile pane200 below markers/routes/controls; pointer-events:none, mobile22px and desktop56px horizontal fades. Source/attribution stays visible. Panning/zoom/resize resynchronize at animation-frame cadence; no polling.
- Reduced profile logo shifted desktop navigation near the settings menu.768px hit testing found its first two entries covered by navigation. The navigation parent now establishes z2 below the utilities; all six menu entries pass at768/1440 without lifting the entire page above dialogs.
- The first sample-note close hit area overlapped its trigger by9px. Moved it clear and moved the expanded panel above it. Independent review also caught sample note z425 above global dialogs; changed to40 and added existing/lazily-mounted modal visibility observation. Final dialog visibility is covered by the separate supplemental report below.
- Existing external Tailwind/Lucide/Google Fonts requests intermittently failed or stalled screenshot font readiness. Incomplete first/second runs and supplemental failures are retained, not counted as passing. QA reuses actual successfully fetched external bytes with URL/size/SHA256 records, does not mock application logic or modify production dependencies. CDN reliability is not claimed fixed.

## Verification and limits

- Final main suite `editorial-third-pass.json`:322/322 checks,0 uncaught JS/runner errors,265 non-GET/HEAD/OPTIONS requests blocked. Covers five pages at four widths, local font/images, original controls and help focus, unsent collection media/note state, map drawer/planner/drag/zoom/route path visibility, route disclosure, quiz feedback and sample-entry states.
- `activity-report.json`:32/32 supplementary checks,0 errors,64 writable requests blocked, covers320×568/390×844/1440×1000 short-screen limits, separated44px target, dismissal, navigation and source opt-in restriction. This run precedes the dialog guard; it does not substitute for the later dialog-focused report.
- Root-font200% cases and320px viewport cases are recorded; this is not a claim of every browser/OS text-zoom combination or a full accessibility audit. A screen-reader audit and authenticated production workflows were not run.
- Build55 files/25JS/5 inline scripts/8 sticky modal headers passes; map personalization11/11 passes; whitespace diff check passes. `source-verification.json` confirms3 nonempty inline scripts and159 event attributes byte-identical to task baseline, all277 original DOM IDs retained, only3 preview IDs added, and production HTML has no activity-preview attribute.
- `static/cloudbase-app.js` SHA256 remains `33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0`. Its existing dirty state is preserved. Backend worktree was read-only checked clean at1fbfcafce75956ea2080dac9155bdb75c1c96a09. No real login, geolocation, microphone, upload, registration, rewards, comments or consent writes tested.
- UI business baseline still lags deployed production; future release must use latest production plus approved visual deltas, not upload the entire older UI checkout. Scope, recovery baseline and source notes saved in `docs/PAPER_EDITORIAL_PHASES_20261001.md`.

Final dialog supplemental check: `activity-modal-final-report.json`,44/44 passed,0 errors,67 writable requests blocked. At320×568/390×844/1440×900 it verifies help and the existing login presentation hide the seasonal note without stealing dialog focus, restore it after closing, and retain dismissal/short-screen behavior. Login UI was opened through its original public presentation function; authentication was not attempted or claimed. Combined final suites:366 checks passed,0 errors,332 writable requests blocked. `QA-EVIDENCE.md` in the evidence folder distinguishes all failed/interrupted intermediate runs from these final two reports.

final result: passed for the approved local visual scope. No release performed.

---

# Local visual checkpoint before backend integration — 2026-10-01

## Scope and matching evidence

- Freeze and preserve current visual work only. Audited `ui/visual-redesign` at parent `db42aa70870ef68cb305cd3e2f85652d32acd9fb`: exactly 5 tracked modifications and 34 untracked files at the start. No backend worktree changes, no `shan`, push, merge or deployment. No new product features in this checkpoint pass.
- Product Design QA and frontend-design guidance were used to verify the existing approved paper/illustration direction, not to invent another redesign. Source is the immediately preceding local visual baseline in `output/paper-editorial-20261001/`, not the older dark-red production design. The four tea-app references remain art-direction references, not a pixel-clone requirement.
- New evidence is outside the repository at `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/visual-checkpoint-20261001/browser/`. Five page views were tested at 320/390/768/1440px. Main agent manually viewed all ten `compare-{view}-{390,1440}.png` side-by-side pairs at matching viewport/state, plus new loading and administrator login/help captures.

## Fidelity review

- Layout and spacing: no new shifts in the five page headers, shared navigation, profile card/badge preview, collection scroll/form, map canvas or community route composition. Mobile and desktop retain their distinct responsive arrangements.
- Typography: compact original Chinese/CHULINK brand and selective short handwritten titles are preserved; body text, navigation, forms and map labels remain readable in the existing system. Local font resolves without a missing dependency.
- Color and images: paper cream, muted ink/sage/ochre, botanical images, abstract bronze phoenix and community collage remain unchanged. All ten new WebP assets decoded successfully; licensed local font and its OFL text are included.
- Copy and controls: required labels, original controls and visual mount points remain. Personal badges are explicitly a pattern preview, not earned rewards; the seasonal activity sample stays opt-in on the local preview service only.
- Pixel comparison is supporting evidence, not the sole acceptance rule: collect/map at both widths and community at390 are identical; homepage differs by only27/32 low-order pixels. Profile differences are below1.5% of pixels with very small mean deltas, consistent with artwork animation/rendering. Community desktop's visible differences are existing quick-learning item rotation, not structural drift.

## Repairs and final checks

- Added missing `loading-gold-weave.webp` to the required build-file list. No visual runtime source was changed in this checkpoint pass.
- Initial AI foundation test failed because its source-extraction regex assumed LF while the Windows checkout used CRLF. Normalized line endings inside the test reader and added an explicit extraction assertion; rerun passed without changing cloud functions or relaxing evidence-boundary checks.
- Corrected current loading lifecycle documentation: `window.load` plus `chu:initial-content-ready`, followed by two animation frames; 6-second manual entry and12-second fallback remain. Earlier chronological notes are retained as history, not current implementation claims.
- Build validation passed:56 files,25 JavaScript files,5 inline scripts,8 sticky modal headers. Map personalization11/11, reward-security21/21, comment-security, mock material pipeline and mock AI foundation passed. Deployment PowerShell parsed successfully but was never executed. Whitespace diff checks passed.
- Final `editorial-report.json`:322/322 checks,0 uncaught JS/runner errors,276 non-read-only requests blocked. `activity-report.json`:44/44,0 errors,72 blocked. `loading-admin-report.json`:22/22,0 errors,0 blocked. Combined388 checks and348 blocked requests.
- The22 supplemental checks comprise12 administrator unauthenticated presentation checks and10 loading-preview checks (appearance, centered small phoenix, reduced motion,6-second manual entry and actual button dismissal). Main suite only waits for the formal loading layer to disappear; it does not remove it. Automatic removal was observed, but successful cloud-ready completion was not distinguished from12-second fallback with cloud writes/auth requests blocked.
- A separate extreme delayed-parser experiment timed out while taking a screenshot. Its failure evidence is retained in `loading-admin-first-attempt.json`, excluded from passed results; no claim that this extreme CDN-failure scenario was verified. Final loading-preview tests deliberately hold automatic dismissal for appearance testing and are not substitutes for real successful cloud initialization.
- New source dependencies and deployment copy lists were audited: no missing local references, all11 new CSS/JS entries included, assets directory recursively included. Common credential/private-key/token/signed-URL patterns and suspicious temporary filenames produced no candidate findings; this is a scoped scan, not a complete secret audit. Screenshots, browser fixtures and test logs stay outside Git.

## Integration limitations and preservation

- `admin.html` has no new working-tree diff; its important progressive-disclosure/navigation/editorial workspace changes are already in ancestor `db42aa7`. The integration must preserve that history, not assume the new checkpoint alone contains all administrator work.
- Existing `static/cloudbase-app.js` consent-withdrawal UI is preserved, but this UI worktree's `appCore` has no `withdrawAiAnalysisConsent` action. Integration must supply or reconcile the corresponding backend API; no end-to-end consent success is claimed. Preserve the `chu:initial-content-ready` completion signal at the new backend initialization boundary.
- No authenticated login, upload, activity registration, comment, reward, consent withdrawal, geolocation, microphone or administrator write was tested. No real-device Safari or full screen-reader audit. Tests reused real successfully fetched CDN dependency bytes; external availability has not been fixed or guaranteed.
- Detailed file inventory and the four conflict-file instructions are in `docs/VISUAL_CHECKPOINT_INTEGRATION_20261001.md`. Treat this as a preserved local UI baseline, not a deployment-ready replacement for newer backend business code. After checkpoint commit, freeze visual edits pending integration-baseline confirmation.

final result: passed
