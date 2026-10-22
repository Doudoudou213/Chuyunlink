(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChuJourneyStudyScenes = factory();
})(globalThis, function () {
  'use strict';
  // Art direction only, registered to hhl-full-park-v2.webp (1919 × 820).
  // Historical interpretation belongs to reviewed content, never this UI map.
  // Future real photographs need their own rights, binding and focal points.
  const scenes = {
    tower: {
      rect: [360,102,190,236], viewBox: [300,85,310,250], origin: [455,175],
      scale: 1.6, shift: [0,29], contours: [3,4,5,8], detail: 'eaves',
      heading: '从一处层檐看起', action: '细看层檐', label: '主楼',
      whole: '先看整体，再靠近一处细节。',
      closer: '沿着淡金线，留意画中檐角的转折。',
      looks: [
        {key:'eaves',label:'檐角转折',contours:[3,4,5],origin:[455,175],scale:1.6,shift:[0,29],caption:'沿一条檐线看过去，目光停在向上挑起的转折。'},
        {key:'eaves-rhythm',label:'层层相叠',contours:[4,5,8],origin:[446,195],scale:1.45,shift:[3,9],caption:'从上往下看，画中的几层檐线怎样彼此呼应？'}
      ]
    },
    copper: {
      rect: [620,208,80,126], viewBox: [580,188,160,160], origin: [658,272],
      scale: 1.45, shift: [0,0], contours: [0,1,2], detail: 'outline',
      heading: '沿轮廓，看一处转折', action: '细看轮廓', label: '古铜顶',
      whole: '先看画中轮廓，上下的宽窄怎样变化？',
      closer: '淡金线只描画中外形；真实锈色与细部，留待实拍对照。',
      looks: [
        {key:'outline',label:'轮廓起伏',contours:[0,1,2],origin:[658,272],scale:1.45,shift:[0,0],caption:'从上端往下看，外形在哪些地方收窄，又在哪里展开？'},
        {key:'outline-width',label:'宽窄变化',contours:[1,2],origin:[657,277],scale:1.9,shift:[0,-6],caption:'把中间两段放在一起看，比较画中宽窄的变化。'}
      ]
    },
    baiyun: {
      rect: [918,236,132,128], viewBox: [883,211,202,178], origin: [985,285],
      scale: 1.5, shift: [0,10], contours: [1,2,3,4], detail: 'roofline',
      heading: '让目光越过屋檐', action: '细看檐线', label: '白云阁',
      whole: '看看屋檐与树色之间留出的空隙。',
      closer: '顺着画中檐线往外看；这幅画不代表实际登临视野。',
      looks: [
        {key:'roofline',label:'檐线转折',contours:[1,2],origin:[985,285],scale:1.5,shift:[0,10],caption:'沿着画中檐线走一遍，留意两端翘起的弧度。'},
        {key:'roofline-echo',label:'上下呼应',contours:[3,4],origin:[988,297],scale:1.65,shift:[0,-6],caption:'再往下看一层，比较两道檐线的走势。'}
      ]
    },
    pond: {
      rect: [615,457,353,181], viewBox: [610,442,363,205], origin: [789,543],
      scale: 1.35, shift: [0,0], contours: [0,1,2], detail: 'waterside',
      heading: '沿着水岸，慢一点看', action: '细看水岸', label: '鹅池',
      whole: '先看水面的留白，再看岸线怎样转弯。',
      closer: '画中只看水岸与亭影；真实水色与水下生态，留待现场对照。',
      looks: [
        {key:'waterside',label:'沿岸曲线',contours:[0,1,2],origin:[789,543],scale:1.35,shift:[0,0],caption:'顺着岸边的淡金线，看水面怎样被曲线围拢。'},
        {key:'water-space',label:'水面留白',contours:[0],origin:[758,526],scale:1.55,shift:[20,10],caption:'把目光从岸边移向水面，看看这一片留白。'}
      ]
    }
  };
  function freeze(value) {
    if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);}
    return value;
  }
  return freeze(scenes);
});
