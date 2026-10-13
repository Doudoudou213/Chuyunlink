/* Local illustration layout, not a route network or approved evidence package.
 * Percentages are hand-map composition anchors; never pass them to geolocation.
 */
(function installParkLayout(global) {
  'use strict';

  const sources = {
    park: {
      title: '武汉市园林和林业局 · 黄鹤楼公园管理处',
      url: 'https://ylj.wuhan.gov.cn/zwgk/zwxxgkzl_12298/jggk_12304/xsdwszjzz_12308/202001/t20200110_726398.shtml',
      supports: '主楼、胜像宝塔、南区九九归鹤图、东区岳飞铜像，以及公园四区范围。'
    },
    map: {
      title: '2024 黄鹤楼公园游玩攻略 · 图绘黄鹤楼',
      url: 'https://m.wuhan.com/travel/131772.html',
      supports: '已人工查看的图绘黄鹤楼版面；仅用于景物大致相对位置，不证明当前道路开放。',
      kind: 'secondary-map-reference'
    },
    cooling: {
      title: '武汉市政府 · 黄鹤楼公园纳凉地图',
      url: 'https://www.wuhan.gov.cn/zjwh/whly/202407/t20240730_2435680.shtml',
      supports: '黄鹤归来铜雕池、千禧钟至白云阁山脊、落梅轩及东西门的名称与区域关系。'
    },
    copper: {
      title: '武汉市政府 · 黄鹤楼百年铜顶',
      url: 'https://www.wuhan.gov.cn/sy/whyw/202311/t20231123_2305763.shtml',
      supports: '古铜顶的名称、外形及其位于黄鹤楼附近的公开报道。'
    },
    yuefei: {
      title: '武汉市政府 · 岳飞在武汉的文化遗迹',
      url: 'https://www.wuhan.gov.cn/sy/tswh/202301/t20230131_2142319.shtml',
      supports: '黄鹤楼以东四季牌坊、岳飞功德坊、岳飞广场和铜像的相对关系。'
    },
    garden: {
      title: '武汉市政府 · 武汉夏季紫薇',
      url: 'https://www.wuhan.gov.cn/zjwh/whly/202207/t20220722_2011553.shtml',
      supports: '黄鹤楼紫薇苑确有其景；不据旧报道保证当前花期。'
    },
    pavilions: {
      title: '武昌区政府 · 黄鹤楼及其园林景观',
      url: 'https://www.wuchang.gov.cn/xwzx_37/bz/202506/t20250611_2594017.html',
      supports: '南楼、白云阁、搁笔亭、落梅轩等园林景观名称。'
    },
    poetry: {
      title: '武汉市政府 · 黄鹤楼端午游园活动',
      url: 'https://www.wuhan.gov.cn/zjwh/whly/202306/t20230615_2217023.shtml',
      supports: '鹅池、诗碑廊等点位名称；往期演出安排不作为当前承诺。'
    },
    arch: {
      title: '武汉政协文史资料 · 三楚一楼牌坊',
      url: 'https://www.whzx.gov.cn/zxzl/wsl/whwszl/202407/P020240712324504922948.pdf',
      supports: '三楚一楼牌坊与胜像宝塔相邻的记述。'
    }
  };

  function point(id, title, x, y, district, topic, description, sourceIds, sceneId) {
    return {
      id, title, x, y, district, topic, description,
      sceneId: sceneId || null,
      sourceIds: ['map'].concat(sourceIds),
      sourceUrls: ['map'].concat(sourceIds).map(key => sources[key].url),
      confidence: {
        landmark: 'corroborated-public-source',
        position: 'illustrative-map-anchor',
        currentAccess: 'not-verified'
      }
    };
  }

  const layout = {
    id: 'huanghelou-core-park-sketch-v2',
    version: 2,
    title: '黄鹤楼全景画卷',
    subtitle: '向东展开山脊，向南寻访诗意园林',
    reviewedAt: '2026-10-13',
    coordinateSystem: 'illustration-percent-top-left',
    referenceAspect: 1080 / 557,
    north: 'approximately-up',
    scope: '西部主楼至东部门区的核心游园景物示意',
    isCompleteParkInventory: false,
    isNavigation: false,
    canConfirmArrival: false,
    notice: '画卷位置经过艺术调整，用于浏览景物；实际通行请看景区指引。',
    limitations: [
      '16处可展开景物不等于官方所述全公园80余景点；首义园区东延部分未绘入。',
      '图上位置是手绘构图坐标，不是经纬度、实测间距、游客定位或已核验路线。',
      '资料只核对景物名称和大致布局，未核对2026年的现场开放、台阶和无障碍条件。',
      '浏览进度仅表示在本机展开过内容，不是实际到访记录，也不产生奖励。',
      '研究来源不自动成为已审核讲解材料；接入正式讲解仍需现有授权和审核流程。'
    ],
    sources,
    districts: [
      { id: 'west', title: '西部名楼', description: '主楼与楼前景观', sourceIds: ['park'] },
      { id: 'south', title: '南部诗画', description: '鹅池与诗词园林', sourceIds: ['park'] },
      { id: 'ridge', title: '山脊亭阁', description: '白云阁及相邻景物的画面分组，并非行政分区', sourceIds: ['cooling'] },
      { id: 'east', title: '东部岳飞', description: '岳飞文化景观', sourceIds: ['park', 'yuefei'] }
    ],
    // Do not draw connecting lines: current physical walkability is unverified.
    paths: [],
    points: [
      point('shengxiang', '胜像宝塔', 6, 24, 'west', '塔与名楼', '从西部塔影开始，比较塔与楼不同的轮廓。', ['park']),
      point('sanchu', '三楚一楼牌坊', 7.5, 34, 'west', '题名与山门', '牌坊把题名留在建筑上；可从字与建筑的关系读起。', ['arch']),
      point('returning-cranes', '黄鹤归来铜雕', 17.5, 32, 'west', '鹤的形象', '西区广场的铜雕池，可与画卷中的鹤意象相互参看。', ['cooling']),
      point('tower', '黄鹤楼', 23, 29, 'west', '飞檐与层楼', '先看层叠的屋檐，再展开主楼的手绘细节。', ['park'], 'tower'),
      point('copper', '古铜顶', 30, 37, 'west', '旧楼留下的线索', '把铜顶当作独立的实物线索，与今天的主楼分开观察。', ['copper'], 'copper'),
      point('bell', '千禧吉祥钟', 35.5, 34, 'ridge', '钟与山脊', '图绘中的钟位与白云阁同在山脊景物序列，当前到达方式另行核实。', ['cooling']),
      point('gebi', '搁笔亭', 31, 54, 'south', '亭与诗意', '亭名可以成为读诗的入口；传说与史实仍需分开讲述。', ['pavilions']),
      point('nanlou', '南楼', 42, 49, 'south', '园林楼阁', '从主楼转向园林里的另一座楼，比较它们在画面中的尺度。', ['pavilions']),
      point('pond', '鹅池', 41, 67, 'south', '水与回廊', '水面与廊亭共同组成可慢慢展开的园林画面。', ['poetry'], 'pond'),
      point('poetry-corridor', '诗碑廊', 41, 72, 'south', '诗与书写', '展开碑廊的资料入口，后续可把诗句与对应原文逐一连接。', ['poetry']),
      point('ninety-nine-cranes', '九九归鹤图', 51, 64, 'south', '群鹤图景', '南区的鹤题材景观；细部与寓意须结合对应材料讲解。', ['park']),
      point('luomei', '落梅轩', 53.5, 56, 'south', '轩与庭园', '在楼阁之外，继续观察轩、庭园与水面的组合。', ['pavilions', 'cooling']),
      point('baiyun', '白云阁', 51.5, 34, 'ridge', '山脊上的阁', '沿画卷山脊向东展开白云阁，比较楼与阁的外观。', ['pavilions', 'cooling'], 'baiyun'),
      point('seasons-arches', '四季牌坊', 63, 43, 'east', '牌坊成组', '黄鹤楼以东的一组牌坊，为岳飞文化景观提供另一处阅读入口。', ['yuefei']),
      point('ziwei', '紫薇苑', 64, 52, 'east', '植物与园艺', '留意园艺的造型语言；画中的花色不代表此刻正在开花。', ['garden']),
      point('yuefei', '岳飞铜像', 80.5, 31, 'east', '人物与纪念', '东侧人物纪念景观，相关故事需回到史料与碑刻。', ['yuefei', 'park'])
    ]
  };

  function deepFreeze(value) {
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
    });
    return Object.freeze(value);
  }
  global.ChuParkLayout = deepFreeze(layout);
})(window);
