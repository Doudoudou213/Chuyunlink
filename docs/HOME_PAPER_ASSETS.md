# 首页纸本插画与字标资产

2026-09-29。两张均使用内置 `image_gen`，不是外部 API/CLI。以用户提供的茶颜悦色截图为美术语言参考，生成原创楚韵链迹素材；没有截取对方 Logo 或商业插画作为项目资产。

## 成品

- `static/assets/discover-botanical-paper-v1.webp`：1536×1024，WebP quality 88，240680 bytes。
- `static/assets/chulink-ink-wordmark-v1.webp`：透明 alpha，1000×264，lossless WebP，156504 bytes。仅裁去透明外边距和缩放压缩，没有改写字形；四字已人工视觉核对为“楚韵链迹”。
- PNG 原稿保存在 `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-home/`：`chulink-paper-lotus-masthead-v1.png`、`chulink-paper-wordmark-v1.png`。
- 页面采用真实图像图层，不以手写 SVG、CSS 图形或 emoji 假装插画。现有业务导航图标本轮保留。

## 背景完整生成提示词

Use case: illustration-story.
Asset type: original hand-painted botanical background layer for a Chinese heritage website homepage masthead, landscape 3:2 high resolution. THIS IS ONLY A BACKGROUND IMAGE, no rendered interface.
Scene/backdrop: an unbroken warm nearly-white xuan rice-paper sheet, base color close to #f8f4eb, subtle fine visible fibers and light uneven print grain, never dirty or grungy. The entire web page will feel drawn on this paper.
Subject: lyrical original Jiangchu lotus and native-floral composition. Broad dusty pale-pink lotus petals, a few expressive sage/grey-green lotus leaves and seedpods, small sprigs of muted ginger-yellow osmanthus-like flowers, a few falling petals; an almost imperceptible pale ink riverbank and water ripples behind the lower edges. Inspired by handmade contemporary Chinese tea packaging illustration and printed picture-book collage, not polished digital stock art. Draw actual botanical forms with personality, irregular pencil contours, watercolor/gouache brush edges and slightly imperfect layered color. No replication of any commercial branded illustration.
Composition/framing: an open botanical canopy along the upper edge and both sides, asymmetric but carefully balanced. Left lotus cluster comes inward to about the left third, right cluster extends into the right third; medium-large forms remain legible when reduced to a phone width. Central 50% width, especially top-middle 20%-50% height, stays uncluttered and calm for a separately overlaid black Chinese wordmark. The colored artwork should be lively near the upper corners but recede naturally into the paper through sparse brushwork, NOT a uniform pastel haze. Bottom half dissolves gently into blank warm paper, bottom 25% almost completely empty so page content can continue seamlessly. Do not enclose the composition as a wreath, frame, arch or rectangle. No repeated all-over pattern.
Mood/color: fresh, friendly, literary and warm; attractive pink and soft green with tiny ochre accents, authentic hand-mixed pigments, restrained contrast; plenty of light. No dark red blocks or heavy brown/gold styling.
Text: NONE. Absolutely no letters, characters, logos, stamps, calligraphy, captions, labels or watermark text.
Avoid: UI, screenshots, phones, status bars, cards, buttons, borders, 3D, metallic effects, photorealistic flowers, vector stock icons, perfectly symmetrical flowers, floating glossy objects, generic gradient blobs, dense scene, hard lower edge.

## 字标完整生成提示词

Use case: logo-brand. Asset type: original Chinese handwritten wordmark PNG for the masthead of the ChuLink cultural website. Create a brand-new hand-lettered mark on a genuinely transparent alpha background. The ONLY text, written EXACTLY ONCE, is the four simplified Chinese characters “楚韵链迹” (楚 / 韵 / 链 / 迹), in a single horizontal row from left to right. Verify each character structure carefully; never substitute traditional Chinese. Subject: original legible Chinese clerical-regular brush lettering with a softly rustic block-print / dry-brush edge, warm, friendly and steady. Each character has slightly varying natural handmade strokes and individual rhythm, balanced as one confident wordmark, not generic computer font and not wild cursive. Lettering color near-black warm ink #2e3128. Keep thick readable strokes and open counters, optimized to remain legible at 190px total mobile width. Overall wordmark aspect ratio about 4:1, snug composition with modest clear transparent outer margins. Add one very small vermilion-red seal-like abstract phoenix brush symbol beside the upper right of the final character, subordinate in scale, without any seal text. Visual direction: paper-craft warmth and handcrafted Chinese tea-shop label sensibility, but this must be an original identity, not a copy of any other brand lettering. Do NOT include any flowers, leaves, backgrounds, paper texture, white rectangle, checkerboard pattern, extra Chinese, English, slogan, diamond, people, metallic badge, gradient, shadow or 3D. Production-ready transparent cutout with clean alpha edges. Wide horizontal format.
