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
      closer: '沿着淡金线，留意画中檐角的转折。'
    },
    copper: {
      rect: [620,208,80,126], viewBox: [580,188,160,160], origin: [658,272],
      scale: 1.45, shift: [0,0], contours: [0,1,2], detail: 'outline',
      heading: '沿轮廓，看一处转折', action: '细看轮廓', label: '古铜顶',
      whole: '先看画中轮廓，上下的宽窄怎样变化？',
      closer: '淡金线只描画中外形；真实锈色与细部，留待实拍对照。'
    },
    baiyun: {
      rect: [918,236,132,128], viewBox: [883,211,202,178], origin: [985,285],
      scale: 1.5, shift: [0,10], contours: [1,2,3,4], detail: 'roofline',
      heading: '让目光越过屋檐', action: '细看檐线', label: '白云阁',
      whole: '看看屋檐与树色之间留出的空隙。',
      closer: '顺着画中檐线往外看；这幅画不代表实际登临视野。'
    },
    pond: {
      rect: [615,457,353,181], viewBox: [610,442,363,205], origin: [789,543],
      scale: 1.35, shift: [0,0], contours: [0,1,2], detail: 'waterside',
      heading: '沿着水岸，慢一点看', action: '细看水岸', label: '鹅池',
      whole: '先看水面的留白，再看岸线怎样转弯。',
      closer: '画中只看水岸与亭影；真实水色与水下生态，留待现场对照。'
    }
  };
  function freeze(value) {
    if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);}
    return value;
  }
  return freeze(scenes);
});
