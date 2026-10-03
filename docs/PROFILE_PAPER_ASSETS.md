# 个人中心纸本徽章资产

2026-09-29。三张徽章均使用内置 `image_gen` 生成原创位图，并以 `transparent_background: true` 请求真实透明 alpha；没有使用外部 API/CLI。它们仅作为个人中心的概念预览，不表示用户已经获得成就。本轮没有实现徽章解锁条件、发放规则或关联权益。

## 参考与复用

- 美术语言参考：`C:/Users/lenovo/.codex/state/plugins/product-design/assets/chulink-ref-02-teayan-profile.jpg`。参考其中小尺寸植物纹样徽章的细线、留白和陈列方式；没有截取对方徽章、Logo 或商业插画作为项目素材。
- 个人中心复用首页的植物纸本背景 `static/assets/discover-botanical-paper-v1.webp` 与原创字标 `static/assets/chulink-ink-wordmark-v1.webp`。生成来源与完整提示词见 [HOME_PAPER_ASSETS.md](HOME_PAPER_ASSETS.md)。
- 徽章名称“古建寻迹”“编钟知音”“楚地拾遗”是本轮原创概念标签，不代表已经配置的业务成就。

## 成品与来源

PNG 原稿目录：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-profile/`。三张原稿均为 1254×1254，已检查真实 alpha 透明通道。

| 概念标签 | 原稿文件 | 仓库素材 | 尺寸 | 文件大小 |
| --- | --- | --- | --- | --- |
| 古建寻迹 | `badge-architecture-v1.png` | `static/assets/profile-badge-architecture-v1.webp` | 256×256，透明 | 37854 bytes |
| 编钟知音 | `badge-bronze-v1.png` | `static/assets/profile-badge-bronze-v1.webp` | 256×256，透明 | 35846 bytes |
| 楚地拾遗 | `badge-fieldnotes-v1.png` | `static/assets/profile-badge-fieldnotes-v1.webp` | 256×256，透明 | 37082 bytes |

PNG 转 WebP 使用 Sharp 裁去透明外边距、缩放至 256×256，并以 `quality: 90`、`alphaQuality: 100` 编码，保留透明背景。古建与手记原稿各生成一次；编钟原稿经过一次内置 `image_gen` 简化编辑。除上述裁边、缩放和编码外，没有再次修改原稿。页面通过真实图像资源呈现徽章。

## 古建寻迹：完整生成提示词

Use case: logo-brand. Asset type: ONE original raster illustration badge for a Chinese Chu-heritage app, conceptual design preview. Create a square image on a genuinely transparent background with real alpha, not a white or checkerboard background. Subject: one traditional Chu-region pavilion with two layered gently upturned roofs, raised over a river indicated by three open flowing lines; integrate one tiny curved cloud and one delicate leafy branch inside a softly octagonal botanical-medallion contour. Elegant delicate hand-engraved ink outline, dark warm gray-brown olive ink close to #6f7566, very slight organic pen variation, and only two or three tiny muted sage filled leaf accents. The border is a thin single contour with softly curved corners, not a thick coin. Open transparent interior, balanced negative space, spare architectural detail and no dense hatching. This must remain readable when displayed at about 62px: strong clear roof silhouette, moderately fine continuous lines, sparse leaves. Center one badge occupying about 82 percent of the square canvas with equal transparent margin all around. Evoke the refined botanical miniature linework of premium Chinese tea-app badges, but create an original Chu architectural motif, not a copy of any logo or badge. No text, lettering, date, numbers, people, trophies, stars, ribbons, metallic material, 3D, drop shadow, colored background, large filled shapes, paper texture or watermark. Preserve actual transparent cutout alpha around the drawing and within open areas.

## 编钟知音：完整初始生成提示词

Use case: stylized-concept. Asset type: single original small heritage badge illustration for a refined Chinese cultural app profile medal row. Scene/backdrop: square canvas, genuinely transparent background with real alpha, transparent open interior. Subject: one hanging ancient Chinese bronze bianzhong bell, recognizable slightly tapered body with curved lower mouth, short hanging handle, a few simple engraved studs, a simple phoenix ribbon ornament and one small leaf gracefully integrated inside a softly octagonal botanical-medallion outline. Style/medium: delicate hand-engraved ink outline illustration inspired by small Chinese botanical woodcut medallions; elegant dark warm gray-brown linework close to #6f7566, slight organic pen variation, a few tiny softly filled sage accents only. Composition: one centered badge, entire outline fully visible with a small clear margin; sparse open interior, visually balanced, strong clear silhouette, designed to remain readable at 62px screen size. This is an original Chu heritage conceptual badge preview, with no earned-state indicator. Constraints: no text, letters, calligraphy, dates, numbers, watermark, brand logo, people, trophy, stars, metallic 3D shading, drop shadow, colorful filled blobs, dense micro detail or checkerboard backdrop. Preserve an airy etched character, mostly transparent negative space, moderate-weight outer line and slightly finer inner lines.

## 编钟知音：完整最终编辑提示词

Edit this original Chu heritage bianzhong medallion. Keep the centered bell, phoenix ribbon, one small leaf and softly octagonal outline composition. Simplify the illustration aggressively into delicate clean ink-outline line art for a 62px app badge: remove all paper grain, cross-hatching, shading, micro engravings, interior striping and ALL cream/off-white object fills, making those interiors transparent. Keep only 6 simple small outlined circular bell studs and 2 simple curving engraved accents. Change border to one simple moderate-weight gray-brown organic pen outline rather than a double thick band; remove the extra decorative leaf motifs on the four border corners. The phoenix ribbon has only simple clean contours and a few feather division lines. Maintain dark warm gray-brown #6f7566 outlines with slight organic variation, and only tiny sage accents on the one leaf and one phoenix feather. Most of the canvas and object interiors are transparent. Real alpha transparent square background. Elegant minimal botanical woodcut badge, airy and easily recognizable at very small size. No text, no numbers, no stars, no shadow, no 3D, no backdrop.

## 楚地拾遗：完整生成提示词

Use case: stylized-concept. Asset type: one original raster badge illustration for a Chu cultural heritage mobile app profile, conceptual preview only. Create a single centered open field notebook with completely blank pages, a traditional Chinese brush resting diagonally along it, and one little lotus/plant sprig, integrated inside a softly octagonal botanical medallion outline. Take only the general delicate ink-outline badge-row sensibility from the inspected tea-app reference; make a new design, no copied brand or marks. Elegant hand-engraved dark warm gray-brown linework around #6f7566 with slight organic pen variation. Mostly open unfilled interiors, only a few subtly filled tiny sage leaf accents. Balanced compact silhouette, airy and not dense, clear recognition at 62px screen size; confidently legible fine lines, simple blank notebook pages. Square canvas, badge occupies about 86 percent of width with clear margins. Actual transparent background with real alpha throughout open areas; no white square, paper background, checkerboard artwork, or opaque background fill. No text, lettering, date, numbers, people, trophy, stars, metallic 3D, drop shadow, colorful filled blobs, status ticks, ribbon, watermark, logo, or extra objects.
