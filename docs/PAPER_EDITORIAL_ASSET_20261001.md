# 荆楚江河彩绘拼贴封面 · 2026-10-01

## 用途与边界

- 使用位置：楚韵链迹用户端活动科普封面，移动端约 340 × 200 px、桌面约 420 × 250 px，建议 `object-fit: contain`。
- 内容：原创概念性江河、低山、柳树、芦苇、古亭与纹样手札。不是某处真实地标的影像，不作为历史纹样、建筑形制或路线地点的证据。
- 用户参考图仅提供纸张拼贴、色彩涂抹和墨线风格；未复制商标、UI、饮料、人物或文字。
- 水墨为主，辅以石绿、赭黄、浅青的手绘色块和少量撕纸边缘；不承载文字，标题由网页自身渲染。
- 原有封面与旧资产全部保留。此工作只增加素材与本说明，没有修改业务代码。

## 生成与文件

- 模式：内置 `image_gen`，单图生成，`transparent_background: true`。未使用 CLI/API fallback。
- 原始输出（保留）：`C:/Users/lenovo/.codex/generated_images/01a0f5ef-1da4-7ca0-b1c7-5c1820333c8e/exec-127f682c-07f1-4f85-9fff-077fedc3965a.png`
- 项目文件：`static/assets/community-river-collage-v3.webp`
- 尺寸：1536 × 1024 px；RGBA，包含透明通道。
- 文件大小：463070 bytes，约 452 KiB。
- 转换：Sharp WebP，quality 87、alphaQuality 100、effort 6；只编码压缩，不裁切、移除透明度或修改画面。
- 检查：已查看原输出与最终 WebP；无品牌、文字、饮料或截断的主体。江河串联亭、山和纹样手札。透明像素存在，保留原始不规则纸边。
- 参考图 1：用户提供的 `8ab3da9f2a9a94bcca86cc652314bbf3.jpg`，仅风格参考。
- 参考图 2：用户提供的 `e227f4b56b5748a8976fe134d5b450aa.jpg`，仅风格参考。

## 最终提示全文

```text
Use case: illustration-story
Asset type: transparent website hero illustration, original Jingchu cultural field-notes cover.
Primary request: Create ONE refined, hand-painted Chinese landscape collage, designed to sit on a warm rice-paper interface. A gentle river winds between LOW rounded hills, with a little willow and reeds, one traditional pavilion roof and a modest open field notebook showing abstract ornamental rubbings (no letters). It is an imagined cultural landscape, not a representation of any real landmark.
Input images: Image 1 is ONLY a style reference for layered torn-paper edges, uneven painted color and paper fibers. Image 2 is ONLY a style reference for warm hand-drawn ink outlines and brush-painted areas. Do not reproduce either app UI, any brand, logo, drink, commercial object, lettering, mascot or exact composition.
Style/medium: Chinese ink wash remains the foundation, with soft mineral-green, pale cyan and ochre watercolor brushed into the landscape; restrained tactile paper collage accents, a few torn white paper edges. Sophisticated, delicate, alive, crafted by a human; clearly East Asian poetic landscape, not generic geometric vector art and not a realistic photo.
Composition/framing: horizontal landscape approximately 1536 by 1024. One coherent gently asymmetrical cluster in the middle, 85 percent image width and around 65 percent image height. All hilltops, eaves, reeds and notebook fully inside frame. Calm spacing; no crowded montage. The river provides a graceful linking curve. The paper pieces have natural irregular outer edges and soft brush wisps that fade to transparency; NO rectangular background. Actual transparent alpha surrounding the whole composition; no fake checkerboard.
Color palette: muted stone green and sage, light warm ochre, a little pale blue-cyan, warm parchment and dark brown ink. Mostly light and middle values, tiny dark accents, no saturated red blocks. Elegant visible watercolor stains and color layering, enough readable detail at a 340 by 200 mobile slot.
Materials/textures: rice-paper fibers on the painted objects, soft dry-brush grain, imperfect ink contour, gently torn edges, no plastic sheen or heavy drop shadows.
Text: absolutely no text, numbers, calligraphy or pseudo-writing.
Constraints: genuine transparent background. No labels, no border, no watermark, no UI, no phones, no buttons, no logos, no tea cups, no drink packaging, no human figures. Preserve the quiet Chinese ink-painting soul while adding restrained colorful paper craft.
```
