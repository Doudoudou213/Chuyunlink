/* Badge artwork/rules only. Eligibility and earned records remain server-owned. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChuBadgeCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const ruleVersion = '2026-10-04.v1';
  const requirement = (metric, target, label, distinctBy) => ({ metric, target, label, distinctBy });
  const catalog = [
    {
      id: 'architecture', name: '古建寻迹', theme: '檐下看见时间',
      alt: '花窗中的古亭、流水与枝叶', group: '采集寻访',
      story: '一角飞檐，一段水声，把寻访的脚步留在纸上。',
      requirements: [requirement('approved_architecture_objects', 3, '完成 3 处不同古建筑的有效采集，并通过审核。', 'resourceId')],
      note: '同一建筑的多次投稿不重复计数；在允许拍摄的区域记录，不攀爬、不触碰文物。'
    },
    {
      id: 'bronze', name: '编钟知音', theme: '听见器物的回响',
      alt: '花窗中的编钟、凤鸟与飘带', group: '采集寻访',
      story: '以钟为引，寻找乐器与礼乐器物背后的线索。',
      requirements: [requirement('approved_music_objects', 2, '完成 2 件不同传统乐器或礼乐器物的记录，并通过审核。', 'resourceId')],
      note: '记录器物名称、所见特征与资料出处；不要求实际敲击、演奏或触碰藏品。'
    },
    {
      id: 'fieldnotes', name: '楚地拾遗', theme: '共同图鉴的第一笔',
      alt: '花窗中的手记、毛笔与荷花', group: '采集寻访',
      story: '从眼前的真实所见开始，为共同图鉴留下一页。',
      requirements: [requirement('approved_collections', 1, '完成第一份有效采集，并通过审核。', 'submissionId')],
      note: '资料需有清楚的对象说明、来源和必要授权；上传成功不等于审核通过。'
    },
    {
      id: 'pattern', name: '纹样拾花', theme: '细看一笔一纹',
      alt: '花窗中的回旋凤鸟纹与叶片', group: '采集寻访',
      story: '让容易被略过的纹饰，有一张清晰的特写。',
      requirements: [requirement('approved_pattern_objects', 3, '记录 3 个不同对象的纹样，附特写、纹样所在部位与说明，并通过审核。', 'resourceId')],
      note: '同一对象的多张特写只计一次；区分亲眼观察与资料推测。'
    },
    {
      id: 'inscription', name: '碑影留痕', theme: '为字迹留一个出处',
      alt: '花窗中的碑刻、卷轴与草叶', group: '采集寻访',
      story: '把石上的字与纸上的记录，一起妥善留存。',
      requirements: [requirement('approved_inscription_objects', 2, '记录 2 处不同碑刻或题记，附影像与文字整理，并通过审核。', 'resourceId')],
      note: '辨识不清的字明确标注，不猜填；只用允许的拍摄方式，不擅自拓印。'
    },
    {
      id: 'artisan', name: '匠心留声', theme: '听一段手艺的故事',
      alt: '花窗中的织梭、编篮与枝叶', group: '采集寻访',
      story: '让做手艺的人，用自己的话留下记忆。',
      requirements: [requirement('approved_authorized_oral_records', 1, '完成 1 份经讲述者授权的匠人或守护人口述记录，附摘要，并通过审核。', 'recordId')],
      note: '先取得录制和使用授权；文字、音频或视频均可，避免披露不必要的私人信息。'
    },
    {
      id: 'journey', name: '江汉行记', theme: '三处所见，一卷行记',
      alt: '花窗中的江船、石桥、远山与芦苇', group: '采集寻访',
      story: '不必走得很远，也能在熟悉的地方发现新线索。',
      requirements: [requirement('approved_onsite_places', 3, '在 3 处不同地点完成实地采集，并通过审核；同一城市即可。', 'placeId')],
      note: '以审核后的现场材料确认，不要求连续打卡或后台持续定位；不到未开放区域。'
    },
    {
      id: 'artifact', name: '楚器观微', theme: '在细节里读懂器物',
      alt: '花窗中的青铜器、放大镜与云纹', group: '采集寻访',
      story: '看整体，也看一处接缝、一笔纹饰留下的细节。',
      requirements: [requirement('approved_artifact_objects', 3, '记录 3 件不同器物，附整体、细节影像及工艺或纹样观察，并通过审核。', 'resourceId')],
      note: '只记录可确认的观察，不擅自断代；遵守馆藏与展览的拍摄规定。'
    },
    {
      id: 'proofreader', name: '文脉校书', theme: '把一处疑问校得更清楚',
      alt: '花窗中的书页、毛笔与方印', group: '共建修订',
      story: '为一处名称、一段引文补上可核对的依据。',
      requirements: [requirement('accepted_sourced_corrections', 3, '提交 3 条带可靠出处的不同纠错，并被管理员采纳。', 'correctionId')],
      note: '以正式采纳结果为准；同一问题重复提交不累加。'
    },
    {
      id: 'collaborator', name: '同卷共书', theme: '让别人的一页更完整',
      alt: '花窗中的两支毛笔与同一卷书', group: '共建修订',
      story: '你的补充，接上另一位记录者尚未写完的地方。',
      requirements: [requirement('accepted_other_contributor_records', 3, '为其他贡献者的 3 份不同记录补充有效资料，并被采纳。', 'targetRecordId')],
      note: '以不同目标记录去重，不含给自己的记录补充；保留补充资料的来源与授权。'
    },
    {
      id: 'lamplight', name: '灯下问楚', theme: '带着好奇读下去',
      alt: '花窗中的油灯、竹简与枝叶', group: '学识积累',
      story: '灯下读一段，记住一条，再带着问题去看。',
      requirements: [
        requirement('completed_learning_topics', 5, '完成 5 个不同的学习主题。', 'topicId'),
        requirement('correct_quiz_questions', 5, '答对 5 道不同的知识题。', 'questionId')
      ],
      note: '两项需同时满足，不要求连续签到；重复阅读或重答同一题不累加。'
    },
    {
      id: 'heritage', name: '薪火相传', theme: '把自己的光，留给共同图鉴',
      alt: '花窗中的凤鸟、火种与书卷', group: '共同守护',
      story: '采集、求证与补充，在一卷图鉴里汇成接续的光。',
      requirements: [
        requirement('valid_contributions', 10, '累计 10 项经审核或采纳的有效贡献。', 'contributionId'),
        requirement('valid_content_categories', 3, '贡献覆盖至少 3 类内容。', 'categoryId'),
        requirement('accepted_collaborative_supplements', 2, '其中至少 2 项为被采纳的协作补充。', 'supplementId')
      ],
      note: '三项需同时满足；同一贡献只计一次，分类以服务端审核归类为准。'
    }
  ];
  const freeze = value => {
    Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); });
    return Object.freeze(value);
  };
  // Optical size only: source alpha bounds differ after individual extraction.
  // Keep all original raster pixels; the presentation fits frames to equal size.
  const artScale = { architecture: 1.019, bronze: .946, fieldnotes: .982, pattern: .884,
    inscription: .938, artisan: .987, journey: 1.108, artifact: 1.058,
    proofreader: .982, collaborator: .928, lamplight: 1.005, heritage: 1.014 };
  catalog.forEach(badge => {
    badge.image = './static/assets/badges-v1/' + badge.id + '.webp';
    badge.ruleVersion = ruleVersion;
    badge.requirementMode = 'all';
    badge.artScale = artScale[badge.id];
  });
  freeze(catalog);
  function get(id) { return catalog.find(badge => badge.id === id) || null; }

  // Integration seam: replace this implementation with an authenticated, read-only
  // server adapter in the next phase. Never infer qualification from local counters.
  // null means unknown, NOT zero progress, ineligible, or unearned.
  async function checkEligibility(badgeId, { signal } = {}) {
    if (!get(badgeId)) throw new RangeError('Unknown badge ID');
    if (signal?.aborted) {
      const error = new Error('Eligibility check aborted');
      error.name = 'AbortError';
      throw error;
    }
    return Object.freeze({
      schemaVersion: 1, badgeId, ruleVersion,
      status: 'not_connected', eligible: null, earned: null,
      progress: null, checkedAt: null
    });
  }
  return Object.freeze({ catalog, ruleVersion, get, checkEligibility });
});
