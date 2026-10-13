/* Local illustration configuration; never a source of navigation coordinates or historical approval. */
(function () {
  'use strict';
  const asset = name => 'static/assets/exploration-motion/hhl-' + name + '-v1.webp';
  window.ChuMotionScene = Object.freeze({
    tower: Object.freeze({ title: '黄鹤楼', kicker: '眼前这座楼', description: '抬头看看飞檐，再读一段楼的故事。', x: 23, y: 29, halo: 39, art: asset('tower'), observation: '先顺着画中层层展开的檐角向上看。近处的朱红柱子、深色斗拱与金色屋顶，共同撑起了这座楼的轮廓。', story: '这张手绘图以现今主楼为形象参考。图中的比例与色彩经过艺术处理；要了解真实建筑，请继续查看景区资料。', answer: '可以先观察层叠的屋檐与檐角，再比较朱红柱子和屋顶的色彩。这里演示的是如何调取当前景物资料，不提供未经核实的现场方位。' }),
    copper: Object.freeze({ title: '古铜顶', kicker: '一件旧物，留下的线索', description: '看看葫芦般的轮廓，辨认屋顶上的旧物。', x: 59.5, y: 39.5, halo: 23, art: asset('copper'), observation: '注意画中铜顶从下向上收束的几段鼓腹，以及与石座不同的铜色。它不是一座小亭，而是可以单独观察的建筑构件。', story: '《黄鹤楼设计纪事》的照片记录了古铜顶的外形。样板据此绘制，未对现今现场位置或展牌内容作验证。', answer: '这件画中对象是古铜顶，不是亭子。可以从分段鼓起的轮廓、细长顶尖和铜色观察它；具体年代与现场说明请查原资料，不由样板猜测。' }),
    baiyun: Object.freeze({ title: '白云阁', kicker: '换一个角度，看楼与城', description: '从重叠的屋檐，望向画卷里的远景。', x: 85, y: 44, halo: 28, art: asset('baiyun'), observation: '看看深青色屋檐怎样一层层展开，再留意下方石台与朱柱的颜色变化。画中的阁楼被适当放大，以方便在手机上辨认。', story: '白云阁与主楼分别组织了景区东西两侧的视线。本地画卷仅表达相对布局，不据此指引你向某个方向行走。', answer: '可以比较白云阁与黄鹤楼的屋顶颜色、屋檐层次和石台。若想走到实地观察，请以景区现场标识为准，画里的小路不能替代导航。' }),
    pond: Object.freeze({ title: '鹅池', kicker: '把脚步，放慢一点', description: '水面映着亭与树，留一会儿看波光。', x: 50, y: 66, halo: 48, art: asset('ground'), observation: '在这幅图里，先看开阔的青绿色水面，再看池边小亭、岸边石栏与沿水铺开的石板路。白色水纹随光线轻轻变化。', story: '鹅池位于手绘布局的南侧。荷叶、水纹、植物与远景均有艺术处理，不代表实地此刻的季节、景物数量或开放状态。', answer: '可以先看水面与池边小亭，再比较水边石栏和浅色石路。画中荷叶与水纹是手绘表达，不代表当前季节的真实现场。' })
  });
}());
