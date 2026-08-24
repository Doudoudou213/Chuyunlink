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

final result: passed
