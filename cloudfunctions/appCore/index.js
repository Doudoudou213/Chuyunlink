'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');
const https = require('https');

const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV
});
const db = app.database();

const PROFILE_COLLECTION = 'user_profiles';
const SUBMISSION_COLLECTION = 'submissions';
const COMMENT_COLLECTION = 'submission_comments';
const CONTENT_INTERACTION_COLLECTION = 'content_interactions';
const INTERACTION_RATE_COLLECTION = 'interaction_rate_limits';
const NOTIFICATION_COLLECTION = 'interaction_notifications';
const LIKE_COLLECTION = 'submission_likes';
const REPORT_COLLECTION = 'content_reports';
const FEEDBACK_COLLECTION = 'system_feedback';
const SUPPLEMENT_COLLECTION = 'submission_supplements';
const ROUTE_USAGE_COLLECTION = 'route_usage';
const REWARD_COLLECTION = 'rewards';
const REDEMPTION_COLLECTION = 'reward_redemptions';
const REDEMPTION_COUNTER_COLLECTION = 'reward_redemption_counters';
const POINT_LEDGER_COLLECTION = 'point_ledger';
const ALLOWED_ASSET_TYPES = new Set(['image', 'audio', 'video']);
const ALLOWED_REPORT_REASONS = new Set(['spam', 'abuse', 'false_information', 'copyright', 'other']);
const ALLOWED_FEEDBACK_TYPES = new Set(['suggestion', 'bug', 'content', 'other']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
let interactionCollectionsReady = null;
let rewardCollectionsReady = null;

const STARTER_REWARDS = [
  {
    id: 'enshi-daiwa-100',
    title: '恩施黛瓦隐庐 100 元房费抵扣券',
    sponsor: '恩施黛瓦隐庐',
    description: '入住时出示兑换码，每间房限用一张，需提前与商家确认房态。',
    pointsCost: 500,
    inventoryTotal: 50,
    perUserLimit: 1,
    validDays: 30,
    icon: '券',
    status: 'active'
  },
  {
    id: 'wudang-tea-gift',
    title: '武当手工道茶体验伴手礼',
    sponsor: '湖北本地茶厂联合赞助',
    description: '到店出示兑换码领取，具体领取时间以商家公告为准。',
    pointsCost: 300,
    inventoryTotal: 100,
    perUserLimit: 1,
    validDays: 30,
    icon: '礼',
    status: 'active'
  }
];

const COMMENT_TARGETS = {
  hotspot: {
    'suizhou-window-carving': '濒危守护热点 · 随州窗花'
  },
  landmark: {
    'zenghou-archway': '曾侯谏的牌楼',
    'wudang-stone-niche': '武当山道家石龛',
    'pengjiazhai-stilt-house': '彭家寨吊脚楼',
    'yellow-crane-tower': '黄鹤楼',
    'hubei-museum': '湖北省博物馆东湖片区',
    'mingxianling': '明显陵',
    'chibi-ancient-battlefield': '赤壁古战场',
    'three-gorges-dam': '三峡大坝',
    'shennongjia-muyu': '神农架木鱼镇'
  },
  activity: {
    'jingchu-pattern-week': '荆楚纹样寻访周',
    'wuhan-eastlake': '武汉东湖文化路线',
    'yichang-three-gorges': '宜昌三峡文化路线',
    'shennongjia-muyu': '神农架木鱼社区活动',
    'enshi-pengjiazhai': '恩施彭家寨社区活动',
    'suizhou-zenghou': '随州曾侯遗韵线'
  },
  content: {
    'share-yellow-crane-tower': '武汉黄鹤楼 · 楼阁营造与题刻文化',
    'share-wudang-ancient-buildings': '武当山古建筑群 · 皇家道教建筑轴线',
    'share-mingxianling': '钟祥明显陵 · 明代帝陵礼制空间',
    'share-hubei-museum-bells': '湖北省博物馆 · 曾侯乙编钟展陈',
    'share-jingzhou-city-wall': '荆州古城墙 · 城防遗存与城砖文化',
    'live-new-jingzhou-inscription': '荆州古城墙 · 城砖纪年铭文复核',
    'live-new-enshi-door': '恩施土司城 · 木雕门楣纹样采集',
    'live-new-wudang-stone': '武当古道 · 石阶磨损与题刻线索',
    'live-new-suizhou-pattern': '随州曾侯文化 · 编钟纹样技艺衍生样本'
  }
};

const AMAP_ROUTE_ENDPOINTS = {
  walk: 'https://restapi.amap.com/v3/direction/walking',
  car: 'https://restapi.amap.com/v3/direction/driving',
  transit: 'https://restapi.amap.com/v3/direction/transit/integrated'
};
const ROUTE_USAGE_WINDOW_MS = 10 * 60 * 1000;
const ROUTE_USAGE_MAX_LEGS = 40;
const ROUTE_MAX_POINTS = 9;

async function ensureInteractionCollections() {
  if (!interactionCollectionsReady) {
    interactionCollectionsReady = Promise.all(
      [COMMENT_COLLECTION, CONTENT_INTERACTION_COLLECTION, INTERACTION_RATE_COLLECTION, NOTIFICATION_COLLECTION, LIKE_COLLECTION, REPORT_COLLECTION, FEEDBACK_COLLECTION, SUPPLEMENT_COLLECTION, ROUTE_USAGE_COLLECTION].map(async (name) => {
        try {
          await db.createCollection(name);
        } catch (error) {
          const message = String(error && error.message || '');
          const code = String(error && error.code || '');
          if (!/exist/i.test(message) && !/exist/i.test(code)) throw error;
        }
      })
    ).catch((error) => {
      interactionCollectionsReady = null;
      throw error;
    });
  }
  return interactionCollectionsReady;
}

async function ensureRewardCollections() {
  if (!rewardCollectionsReady) {
    rewardCollectionsReady = (async () => {
      for (const name of [REWARD_COLLECTION, REDEMPTION_COLLECTION, REDEMPTION_COUNTER_COLLECTION, POINT_LEDGER_COLLECTION]) {
        try {
          await db.createCollection(name);
        } catch (error) {
          const message = String(error && error.message || '');
          const code = String(error && error.code || '');
          if (!/exist/i.test(message) && !/exist/i.test(code)) throw error;
        }
      }
      for (const reward of STARTER_REWARDS) {
        const ref = db.collection(REWARD_COLLECTION).doc(reward.id);
        const existing = firstDocument(await ref.get());
        if (!existing) {
          await ref.set({
            ...reward,
            redeemedCount: 0,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          });
        }
      }
    })().catch((error) => {
      rewardCollectionsReady = null;
      throw error;
    });
  }
  return rewardCollectionsReady;
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function interactionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isTransactionBusyError(error) {
  const details = `${error && error.code || ''} ${error && error.message || ''}`;
  return /ResourceUnavailableTransactionBusy|Transaction is busy|DATABASE_TRANSACTION_FAIL|TRANSACTION_BUSY/i.test(details);
}

async function runInteractionTransaction(work, maxAttempts = 4) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await db.runTransaction(work);
    } catch (error) {
      lastError = error;
      if (!isTransactionBusyError(error) || attempt >= maxAttempts - 1) break;
      const delay = 80 * (2 ** attempt) + crypto.randomInt(20, 90);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (isTransactionBusyError(lastError)) {
    throw interactionError('COMMENT_SERVICE_BUSY', '当前参与评论的人较多，请稍等几秒再试');
  }
  throw lastError;
}

function normalizeCommentContent(value) {
  const raw = String(value == null ? '' : value).trim();
  if (raw.length > 500) throw interactionError('COMMENT_TOO_LONG', '评论最多 500 个字');
  const content = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!content) throw interactionError('COMMENT_REQUIRED', '评论内容不能为空');
  if (/\b1[3-9]\d{9}\b/.test(content) || /\b\d{17}[\dXx]\b/.test(content) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(content)) {
    throw interactionError('PRIVATE_INFORMATION', '评论中请勿公开手机号、身份证号或邮箱等个人信息');
  }
  const links = content.match(/(?:https?:\/\/|www\.)\S+/gi) || [];
  if (links.length > 2) throw interactionError('TOO_MANY_LINKS', '一条评论最多可包含 2 个外部链接');
  if (/(\S)\1{14,}/u.test(content)) throw interactionError('COMMENT_SPAM', '评论包含过多重复字符，请修改后再发布');
  return content;
}

function interactionIdentity(uid) {
  return crypto.createHash('sha256').update(uid).digest('hex').slice(0, 24);
}

function interactionContentHash(content) {
  return crypto.createHash('sha256')
    .update(String(content || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex')
    .slice(0, 24);
}

async function consumeInteractionQuota(transaction, uid, action, content = '') {
  const now = Date.now();
  const identity = interactionIdentity(uid);
  const rules = action === 'comment'
    ? [
      { window: 'minute', duration: 60 * 1000, limit: 5 },
      { window: 'hour', duration: 60 * 60 * 1000, limit: 30 }
    ]
    : [{ window: 'hour', duration: 60 * 60 * 1000, limit: 10 }];
  const records = await Promise.all(rules.map(async (rule) => {
    const bucket = Math.floor(now / rule.duration);
    const id = `${action}_${rule.window}_${identity}_${bucket}`;
    const ref = transaction.collection(INTERACTION_RATE_COLLECTION).doc(id);
    return { rule, bucket, ref, current: firstDocument(await ref.get()) };
  }));
  const contentHash = content ? interactionContentHash(content) : '';
  for (const record of records) {
    const count = Math.max(0, Number(record.current && record.current.count) || 0);
    if (count >= record.rule.limit) {
      throw interactionError('INTERACTION_RATE_LIMITED', action === 'comment'
        ? '评论发布较频繁，请稍后再试'
        : '举报提交较频繁，请稍后再试');
    }
    if (action === 'comment' && record.rule.window === 'minute' && contentHash &&
        Array.isArray(record.current && record.current.contentHashes) &&
        record.current.contentHashes.includes(contentHash)) {
      throw interactionError('DUPLICATE_COMMENT', '请勿重复发布相同评论');
    }
  }
  for (const record of records) {
    const hashes = Array.isArray(record.current && record.current.contentHashes)
      ? record.current.contentHashes.slice(-9)
      : [];
    if (contentHash && record.rule.window === 'minute') hashes.push(contentHash);
    await record.ref.set({
      action,
      identity,
      window: record.rule.window,
      bucket: record.bucket,
      count: Math.max(0, Number(record.current && record.current.count) || 0) + 1,
      contentHashes: hashes,
      expiresAt: new Date((record.bucket + 2) * record.rule.duration),
      updatedAt: db.serverDate()
    });
  }
}

function routeFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeRoutePoint(value, index) {
  const longitude = Number(value && value.longitude);
  const latitude = Number(value && value.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < 73 || longitude > 136 || latitude < 3 || latitude > 54) {
    throw routeFailure('INVALID_ROUTE_POINT', `第 ${index + 1} 个路线点坐标无效`);
  }
  return {
    longitude: Number(longitude.toFixed(6)),
    latitude: Number(latitude.toFixed(6)),
    title: cleanText(value && value.title, 80) || `第 ${index + 1} 站`,
    city: cleanText(value && value.city, 30)
  };
}

function coordinateText(point) {
  return `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseAmapPolyline(value) {
  return cleanText(value, 100000)
    .split(';')
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .map(([longitude, latitude]) => [latitude, longitude]);
}

function appendRoutePath(target, points) {
  for (const point of points) {
    const previous = target[target.length - 1];
    if (!previous || Math.abs(previous[0] - point[0]) > 0.000001 || Math.abs(previous[1] - point[1]) > 0.000001) {
      target.push(point);
    }
  }
}

function requestAmapJson(endpoint, parameters) {
  const url = new URL(endpoint);
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'ChuLink-CloudBase/1.0' }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
          request.destroy(routeFailure('ROUTE_RESPONSE_TOO_LARGE', '路线服务返回内容过大'));
        }
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(routeFailure('ROUTE_SERVICE_UNAVAILABLE', '高德路线服务暂时不可用'));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (_) {
          reject(routeFailure('ROUTE_RESPONSE_INVALID', '路线服务返回了无法解析的数据'));
        }
      });
    });
    request.on('timeout', () => request.destroy(routeFailure('ROUTE_SERVICE_TIMEOUT', '路线服务响应超时')));
    request.on('error', (error) => {
      if (error && error.code && String(error.code).startsWith('ROUTE_')) reject(error);
      else reject(routeFailure('ROUTE_SERVICE_UNAVAILABLE', '暂时无法连接高德路线服务'));
    });
  });
}

async function consumeRouteQuota(uid, legCount) {
  await ensureInteractionCollections();
  const bucket = Math.floor(Date.now() / ROUTE_USAGE_WINDOW_MS);
  const identity = crypto.createHash('sha256').update(uid).digest('hex').slice(0, 32);
  const documentId = `${identity}_${bucket}`;
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ROUTE_USAGE_COLLECTION).doc(documentId);
    const existing = firstDocument(await ref.get());
    const usedLegs = Math.max(0, Number(existing && existing.usedLegs) || 0);
    if (usedLegs + legCount > ROUTE_USAGE_MAX_LEGS) {
      throw routeFailure('ROUTE_RATE_LIMITED', '路线规划请求较频繁，请稍后再试');
    }
    await ref.set({
      usedLegs: usedLegs + legCount,
      bucket,
      updatedAt: db.serverDate()
    });
  });
}

function parseStandardRouteLeg(payload, start, end, mode) {
  const path = payload && payload.route && asArray(payload.route.paths)[0];
  if (!path) throw routeFailure('ROUTE_NOT_FOUND', `未找到从“${start.title}”到“${end.title}”的路线`);
  const polyline = [];
  const steps = asArray(path.steps).map((step) => {
    appendRoutePath(polyline, parseAmapPolyline(step.polyline));
    return {
      instruction: cleanText(step.instruction, 240),
      road: cleanText(step.road, 80),
      distance: Math.max(0, Number(step.distance) || 0),
      duration: Math.max(0, Number(step.duration) || 0)
    };
  }).filter((step) => step.instruction);
  if (!polyline.length) appendRoutePath(polyline, [[start.latitude, start.longitude], [end.latitude, end.longitude]]);
  return {
    mode,
    from: start.title,
    to: end.title,
    distance: Math.max(0, Number(path.distance) || 0),
    duration: Math.max(0, Number(path.duration) || 0),
    polyline,
    steps
  };
}

function parseTransitRouteLeg(payload, start, end) {
  const transit = payload && payload.route && asArray(payload.route.transits)[0];
  if (!transit) throw routeFailure('ROUTE_NOT_FOUND', `未找到从“${start.title}”到“${end.title}”的公交路线`);
  const polyline = [];
  const steps = [];
  let calculatedDistance = 0;
  asArray(transit.segments).forEach((segment) => {
    asArray(segment && segment.walking && segment.walking.steps).forEach((step) => {
      appendRoutePath(polyline, parseAmapPolyline(step.polyline));
      const distance = Math.max(0, Number(step.distance) || 0);
      calculatedDistance += distance;
      if (step.instruction) steps.push({ instruction: cleanText(step.instruction, 240), mode: 'walk', distance });
    });
    asArray(segment && segment.bus && segment.bus.buslines).forEach((line) => {
      appendRoutePath(polyline, parseAmapPolyline(line.polyline));
      const distance = Math.max(0, Number(line.distance) || 0);
      calculatedDistance += distance;
      const departure = cleanText(line.departure_stop && line.departure_stop.name, 60);
      const arrival = cleanText(line.arrival_stop && line.arrival_stop.name, 60);
      steps.push({
        instruction: `乘坐 ${cleanText(line.name, 100) || '公共交通'}${departure && arrival ? `（${departure} → ${arrival}）` : ''}`,
        mode: 'transit',
        distance,
        duration: Math.max(0, Number(line.duration) || 0)
      });
    });
    const railway = segment && segment.railway;
    if (railway && (railway.name || railway.trip)) {
      const departure = cleanText(railway.departure_stop && railway.departure_stop.name, 60);
      const arrival = cleanText(railway.arrival_stop && railway.arrival_stop.name, 60);
      appendRoutePath(polyline, parseAmapPolyline(railway.departure_stop && railway.departure_stop.location));
      appendRoutePath(polyline, parseAmapPolyline(railway.arrival_stop && railway.arrival_stop.location));
      steps.push({
        instruction: `乘坐 ${cleanText(railway.name || railway.trip, 100)}${departure && arrival ? `（${departure} → ${arrival}）` : ''}`,
        mode: 'railway',
        distance: Math.max(0, Number(railway.distance) || 0),
        duration: Math.max(0, Number(railway.time) || 0)
      });
    }
  });
  if (!polyline.length) appendRoutePath(polyline, [[start.latitude, start.longitude], [end.latitude, end.longitude]]);
  return {
    mode: 'transit',
    from: start.title,
    to: end.title,
    distance: Math.max(calculatedDistance, Number(transit.walking_distance) || 0),
    duration: Math.max(0, Number(transit.duration) || 0),
    cost: Math.max(0, Number(transit.cost) || 0),
    polyline,
    steps
  };
}

async function requestAmapRouteLeg(key, mode, start, end) {
  const parameters = {
    key,
    origin: coordinateText(start),
    destination: coordinateText(end),
    output: 'JSON',
    extensions: 'all'
  };
  if (mode === 'car') parameters.strategy = 10;
  if (mode === 'transit') {
    parameters.city = start.city || end.city || '武汉';
    if (end.city && end.city !== parameters.city) parameters.cityd = end.city;
    parameters.strategy = 0;
    parameters.nightflag = 0;
  }
  const payload = await requestAmapJson(AMAP_ROUTE_ENDPOINTS[mode], parameters);
  if (!payload || String(payload.status) !== '1') {
    const info = cleanText(payload && payload.info, 80);
    throw routeFailure('AMAP_ROUTE_FAILED', info && info !== 'OK' ? `高德路线规划失败：${info}` : '高德路线规划失败');
  }
  return mode === 'transit'
    ? parseTransitRouteLeg(payload, start, end)
    : parseStandardRouteLeg(payload, start, end, mode);
}

async function planRoute(uid, event) {
  const key = cleanText(process.env.AMAP_WEB_SERVICE_KEY, 256);
  if (!key) throw routeFailure('AMAP_KEY_NOT_CONFIGURED', '路线服务尚未完成云端配置');
  const mode = cleanText(event.mode, 20);
  if (!Object.prototype.hasOwnProperty.call(AMAP_ROUTE_ENDPOINTS, mode)) {
    throw routeFailure('INVALID_ROUTE_MODE', '请选择公交地铁、驾车或步行');
  }
  const requestedPoints = Array.isArray(event.points) ? event.points : [];
  if (requestedPoints.length < 2 || requestedPoints.length > ROUTE_MAX_POINTS) {
    throw routeFailure('INVALID_ROUTE_POINTS', `路线需要 2-${ROUTE_MAX_POINTS} 个有效点位`);
  }
  const points = requestedPoints.map(normalizeRoutePoint);
  const legCount = points.length - 1;
  await consumeRouteQuota(uid, legCount);
  const legs = await Promise.all(points.slice(0, -1).map((point, index) => (
    requestAmapRouteLeg(key, mode, point, points[index + 1])
  )));
  const polyline = [];
  legs.forEach((leg) => appendRoutePath(polyline, leg.polyline));
  return {
    ok: true,
    action: 'planRoute',
    provider: 'amap-web-service',
    mode,
    distance: legs.reduce((total, leg) => total + (Number(leg.distance) || 0), 0),
    duration: legs.reduce((total, leg) => total + (Number(leg.duration) || 0), 0),
    polyline,
    legs
  };
}

function cleanResourceId(value, label = '资源') {
  const id = cleanText(value, 128).replace(/^approved-/, '');
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    const error = new Error(`${label} ID 格式不正确`);
    error.code = 'INVALID_RESOURCE_ID';
    throw error;
  }
  return id;
}

function requireStableAccount(userInfo) {
  const loginType = cleanText(userInfo && userInfo.loginType, 40).toUpperCase();
  if (!userInfo || !userInfo.uid || loginType === 'ANONYMOUS') {
    const error = new Error('请先登录正式账号后再参与互动');
    error.code = 'STABLE_ACCOUNT_REQUIRED';
    throw error;
  }
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function sortNewest(items) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime() || 0;
    const rightTime = new Date(right.createdAt || 0).getTime() || 0;
    return rightTime - leftTime;
  });
}

function publicProfile(profile) {
  return {
    uid: profile.uid || profile._id || '',
    nickname: profile.nickname || '楚韵守护者',
    avatarUrl: profile.avatarUrl || '',
    points: Number(profile.points) || 0,
    uploadCount: Number(profile.uploadCount) || 0,
    approvedCount: Number(profile.approvedCount) || 0,
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null
  };
}

function submissionView(item, includeOwnerDetails = false) {
  const completeness = Number.isFinite(Number(item.completeness))
    ? Math.max(0, Math.min(100, Math.round(Number(item.completeness))))
    : 60;
  const view = {
    id: item._id || item.id || '',
    title: item.title || '',
    description: item.description || '',
    assetType: item.assetType || 'image',
    mimeType: item.mimeType || '',
    size: Number(item.size) || 0,
    fileID: item.imageFileID || item.fileID || '',
    imageFileID: item.imageFileID || item.fileID || '',
    imageCloudPath: item.imageCloudPath || item.cloudPath || '',
    cloudPath: item.imageCloudPath || item.cloudPath || '',
    regionName: item.regionName || '湖北',
    longitude: Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : null,
    latitude: Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : null,
    locationAccuracy: Number.isFinite(Number(item.locationAccuracy)) ? Number(item.locationAccuracy) : null,
    status: item.status || 'pending',
    contributorName: item.contributorName || '楚韵守护者',
    rewardPoints: Number(item.rewardPoints) || 100,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    reviewedAt: item.reviewedAt || null,
    reviewNote: item.reviewNote || '',
    reviewPipelineVersion: Number(item.reviewPipelineVersion) || 1,
    aiReviewStatus: item.aiReviewStatus || 'not_requested',
    aiReviewDecision: item.aiReviewDecision || '',
    aiReviewProvider: item.aiReviewProvider || '',
    aiReviewSummary: item.aiReviewSummary || '',
    aiReviewUpdatedAt: item.aiReviewUpdatedAt || null,
    likeCount: Math.max(0, Number(item.likeCount) || 0),
    commentCount: Math.max(0, Number(item.commentCount) || 0),
    completeness,
    board: item.board === 'share' || item.board === 'needs'
      ? item.board
      : (completeness >= 82 ? 'share' : 'needs'),
    supplementCount: Math.max(0, Number(item.supplementCount) || 0),
    approvedSupplements: Array.isArray(item.approvedSupplements)
      ? item.approvedSupplements.slice(-12).map((supplement) => ({
        id: supplement.id || '',
        slotId: supplement.slotId || '',
        slotTitle: supplement.slotTitle || '',
        assetType: supplement.assetType || 'image',
        fileID: supplement.fileID || '',
        contributorName: supplement.contributorName || '社区用户',
        approvedAt: supplement.approvedAt || null
      }))
      : []
  };
  if (includeOwnerDetails) view.userId = item.userId || '';
  return view;
}

async function ensureProfile(uid, userInfo) {
  const ref = db.collection(PROFILE_COLLECTION).doc(uid);
  const existing = firstDocument(await ref.get());
  if (existing) return existing;

  const profile = {
    uid,
    nickname: cleanText(userInfo.nickName || userInfo.name || '', 40) || `楚韵守护者-${uid.slice(-4)}`,
    avatarUrl: '',
    points: 0,
    uploadCount: 0,
    approvedCount: 0,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
  await ref.set(profile);
  return profile;
}

async function listOwn(uid, limit = 50) {
  const result = await db.collection(SUBMISSION_COLLECTION)
    .where({ userId: uid })
    .limit(Math.max(1, Math.min(Number(limit) || 50, 100)))
    .get();
  return sortNewest(result.data || []).map((item) => submissionView(item, true));
}

async function listPublic(limit = 30, viewerUid = '') {
  await ensureInteractionCollections();
  const result = await db.collection(SUBMISSION_COLLECTION)
    .where({ status: 'approved' })
    .limit(Math.max(1, Math.min(Number(limit) || 30, 100)))
    .get();
  const items = sortNewest(result.data || []).map((item) => submissionView(item, false));
  const fileList = [...new Set(items.flatMap((item) => [
    item.fileID,
    ...(item.approvedSupplements || []).map((supplement) => supplement.fileID)
  ]).filter(Boolean))].slice(0, 50);
  if (!fileList.length) return items;
  const fileResult = await app.getTempFileURL({
    fileList: fileList.map((fileID) => ({ fileID, maxAge: 7200 }))
  });
  const urls = new Map(
    (fileResult.fileList || []).map((file) => [file.fileID, file.tempFileURL || ''])
  );
  let likedSubmissionIds = new Set();
  if (viewerUid) {
    try {
      const liked = await db.collection(LIKE_COLLECTION)
        .where({ userId: viewerUid })
        .limit(100)
        .get();
      likedSubmissionIds = new Set((liked.data || []).map((item) => item.submissionId));
    } catch (error) {
      console.warn('[appCore] unable to load viewer likes', error);
    }
  }
  return items.map((item) => ({
    ...item,
    fileUrl: urls.get(item.fileID) || '',
    approvedSupplements: (item.approvedSupplements || []).map((supplement) => ({
      ...supplement,
      fileUrl: urls.get(supplement.fileID) || ''
    })),
    viewerLiked: likedSubmissionIds.has(item.id)
  }));
}

function supplementSlotFor(submission, requestedSlotId) {
  const assetType = submission.assetType || 'image';
  const slots = assetType === 'audio'
    ? [
      { id: 'oral-consent', title: '补充讲述授权记录', rewardPoints: 30, completenessGain: 18, accepts: ['audio', 'image'] },
      { id: 'oral-context', title: '补充技艺或地点背景', rewardPoints: 35, completenessGain: 18, accepts: ['image'] }
    ]
    : [
      { id: 'detail-photo', title: '补充关键细节照片', rewardPoints: 35, completenessGain: 18, accepts: ['image'] },
      { id: 'context-photo', title: '补充点位环境照片', rewardPoints: 30, completenessGain: 18, accepts: ['image'] }
    ];
  return slots.find((slot) => slot.id === requestedSlotId) || null;
}

function supplementView(item, includePrivate = false) {
  const view = {
    id: item._id || item.id || '',
    submissionId: item.submissionId || '',
    slotId: item.slotId || '',
    slotTitle: item.slotTitle || '',
    assetType: item.assetType || 'image',
    status: item.status || 'pending',
    rewardPoints: Number(item.rewardPoints) || 0,
    contributorName: item.contributorName || '社区用户',
    createdAt: item.createdAt || null,
    reviewedAt: item.reviewedAt || null,
    reviewNote: item.reviewNote || ''
  };
  if (includePrivate || item.status === 'approved') {
    view.fileID = item.fileID || '';
    view.cloudPath = item.cloudPath || '';
    view.mimeType = item.mimeType || '';
    view.size = Number(item.size) || 0;
  }
  return view;
}

async function listSupplements(uid, event) {
  await ensureInteractionCollections();
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const submission = await getApprovedSubmission(submissionId);
  const result = await db.collection(SUPPLEMENT_COLLECTION)
    .where({ submissionId })
    .limit(100)
    .get();
  const items = sortNewest(result.data || [])
    .filter((item) => item.status === 'approved' || item.userId === uid)
    .map((item) => supplementView(item, item.userId === uid));
  const fileIDs = [...new Set(items.map((item) => item.fileID).filter(Boolean))].slice(0, 50);
  let urls = new Map();
  if (fileIDs.length) {
    const fileResult = await app.getTempFileURL({
      fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 7200 }))
    });
    urls = new Map((fileResult.fileList || []).map((file) => [file.fileID, file.tempFileURL || '']));
  }
  return {
    ok: true,
    action: 'getSupplements',
    submissionId,
    completeness: Number(submission.completeness) || 60,
    board: submission.board || ((Number(submission.completeness) || 60) >= 82 ? 'share' : 'needs'),
    items: items.map((item) => ({ ...item, fileUrl: urls.get(item.fileID) || '' }))
  };
}

function rewardError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rewardView(reward) {
  const inventoryTotal = Math.max(0, Number(reward.inventoryTotal) || 0);
  const redeemedCount = Math.max(0, Number(reward.redeemedCount) || 0);
  return {
    id: reward._id || reward.id || '',
    title: reward.title || '',
    sponsor: reward.sponsor || '',
    description: reward.description || '',
    pointsCost: Math.max(0, Number(reward.pointsCost) || 0),
    inventoryRemaining: Math.max(0, inventoryTotal - redeemedCount),
    perUserLimit: Math.max(1, Number(reward.perUserLimit) || 1),
    validDays: Math.max(1, Number(reward.validDays) || 30),
    icon: reward.icon || '礼',
    status: reward.status || 'inactive'
  };
}

function redemptionView(item) {
  const expiryTime = new Date(item.expiresAt || 0).getTime();
  const status = item.status === 'issued' && expiryTime > 0 && expiryTime <= Date.now()
    ? 'expired'
    : (item.status || 'issued');
  return {
    id: item._id || item.id || '',
    rewardId: item.rewardId || '',
    rewardTitle: item.rewardTitle || '',
    sponsor: item.sponsor || '',
    code: item.displayCode || '',
    pointsCost: Math.max(0, Number(item.pointsCost) || 0),
    status,
    issuedAt: item.issuedAt || item.createdAt || null,
    expiresAt: item.expiresAt || null,
    redeemedAt: item.redeemedAt || null,
    redemptionInstructions: item.redemptionInstructions || ''
  };
}

function generateRedemptionCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(12);
  const body = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  return `CHU-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

function redemptionDocumentId(uid, clientRequestId) {
  return crypto.createHash('sha256').update(`${uid}:${clientRequestId}`).digest('hex').slice(0, 40);
}

async function listRewards() {
  await ensureRewardCollections();
  const result = await db.collection(REWARD_COLLECTION).limit(100).get();
  return (result.data || [])
    .filter((reward) => reward.status === 'active')
    .map(rewardView)
    .sort((left, right) => left.pointsCost - right.pointsCost);
}

async function listOwnRedemptions(uid, limit = 30) {
  await ensureRewardCollections();
  const result = await db.collection(REDEMPTION_COLLECTION)
    .where({ userId: uid })
    .limit(Math.max(1, Math.min(Number(limit) || 30, 100)))
    .get();
  return sortNewest(result.data || []).map(redemptionView);
}

async function redeemReward(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureRewardCollections();
  const rewardId = cleanText(event.rewardId, 80);
  const clientRequestId = cleanText(event.clientRequestId, 100);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/i.test(rewardId)) {
    throw rewardError('INVALID_REWARD', '福利编号无效');
  }
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(clientRequestId)) {
    throw rewardError('INVALID_REQUEST_ID', '兑换请求无效，请刷新后重试');
  }

  const orderId = redemptionDocumentId(uid, clientRequestId);
  return db.runTransaction(async (transaction) => {
    const redemptionRef = transaction.collection(REDEMPTION_COLLECTION).doc(orderId);
    const existing = firstDocument(await redemptionRef.get());
    if (existing) {
      return {
        ok: true,
        action: 'redeemReward',
        replayed: true,
        pointsAfter: Number(existing.pointsAfter) || 0,
        redemption: redemptionView(existing)
      };
    }

    const rewardRef = transaction.collection(REWARD_COLLECTION).doc(rewardId);
    const profileRef = transaction.collection(PROFILE_COLLECTION).doc(uid);
    const counterId = crypto.createHash('sha256').update(`${uid}:${rewardId}`).digest('hex').slice(0, 40);
    const counterRef = transaction.collection(REDEMPTION_COUNTER_COLLECTION).doc(counterId);
    const [reward, profile, counter] = await Promise.all([
      rewardRef.get().then(firstDocument),
      profileRef.get().then(firstDocument),
      counterRef.get().then(firstDocument)
    ]);
    if (!reward || reward.status !== 'active') throw rewardError('REWARD_UNAVAILABLE', '该福利已下架或暂不可兑换');
    if (!profile) throw rewardError('PROFILE_NOT_FOUND', '没有找到用户积分账户');

    const now = new Date();
    const startsAt = reward.startsAt ? new Date(reward.startsAt).getTime() : 0;
    const endsAt = reward.endsAt ? new Date(reward.endsAt).getTime() : 0;
    if (startsAt && startsAt > now.getTime()) throw rewardError('REWARD_NOT_STARTED', '该福利尚未开始兑换');
    if (endsAt && endsAt <= now.getTime()) throw rewardError('REWARD_EXPIRED', '该福利已过兑换期');

    const pointsCost = Math.max(1, Number(reward.pointsCost) || 0);
    const pointsBefore = Math.max(0, Number(profile.points) || 0);
    const inventoryTotal = Math.max(0, Number(reward.inventoryTotal) || 0);
    const redeemedCount = Math.max(0, Number(reward.redeemedCount) || 0);
    const userRedeemedCount = Math.max(0, Number(counter && counter.count) || 0);
    const perUserLimit = Math.max(1, Number(reward.perUserLimit) || 1);
    if (inventoryTotal <= redeemedCount) throw rewardError('OUT_OF_STOCK', '该福利已领完');
    if (userRedeemedCount >= perUserLimit) throw rewardError('USER_LIMIT_REACHED', '你已达到该福利的兑换上限');
    if (pointsBefore < pointsCost) throw rewardError('INSUFFICIENT_POINTS', `积分不足，还差 ${pointsCost - pointsBefore} 积分`);

    const pointsAfter = pointsBefore - pointsCost;
    const code = generateRedemptionCode();
    const validDays = Math.max(1, Math.min(Number(reward.validDays) || 30, 365));
    const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
    const record = {
      id: orderId,
      userId: uid,
      rewardId,
      rewardTitle: reward.title || '反哺福利',
      sponsor: reward.sponsor || '',
      displayCode: code,
      codeHash: crypto.createHash('sha256').update(code).digest('hex'),
      pointsCost,
      pointsBefore,
      pointsAfter,
      status: 'issued',
      clientRequestId,
      redemptionInstructions: reward.description || '',
      issuedAt: now,
      expiresAt,
      redeemedAt: null,
      createdAt: now,
      updatedAt: now
    };
    await redemptionRef.set(record);
    await profileRef.update({ points: pointsAfter, updatedAt: db.serverDate() });
    await rewardRef.update({ redeemedCount: redeemedCount + 1, updatedAt: db.serverDate() });
    if (counter) {
      await counterRef.update({ count: userRedeemedCount + 1, updatedAt: db.serverDate() });
    } else {
      await counterRef.set({ userId: uid, rewardId, count: 1, createdAt: db.serverDate(), updatedAt: db.serverDate() });
    }
    await transaction.collection(POINT_LEDGER_COLLECTION).doc(`redeem_${orderId}`).set({
      userId: uid,
      type: 'reward_redemption',
      amount: -pointsCost,
      balanceBefore: pointsBefore,
      balanceAfter: pointsAfter,
      rewardId,
      redemptionId: orderId,
      createdAt: db.serverDate()
    });
    return {
      ok: true,
      action: 'redeemReward',
      replayed: false,
      pointsAfter,
      redemption: redemptionView(record)
    };
  });
}

async function createSupplement(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureInteractionCollections();
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const slotId = cleanResourceId(event.slotId, '补充位置');
  const submission = await getApprovedSubmission(submissionId);
  const slot = supplementSlotFor(submission, slotId);
  if (!slot) {
    const error = new Error('该作品没有这个补充位置');
    error.code = 'INVALID_SUPPLEMENT_SLOT';
    throw error;
  }
  const assetType = cleanText(event.assetType, 20);
  const mimeType = cleanText(event.mimeType, 120);
  const size = Number(event.size);
  const fileID = cleanText(event.fileID, 1000);
  const cloudPath = cleanText(event.cloudPath, 500);
  if (!ALLOWED_ASSET_TYPES.has(assetType) || !slot.accepts.includes(assetType)) {
    const error = new Error('文件类型不符合该补充位置要求');
    error.code = 'INVALID_SUPPLEMENT_TYPE';
    throw error;
  }
  if (!fileID.startsWith('cloud://') ||
      !cloudPath.startsWith(`supplements/${uid}/`) ||
      !fileID.endsWith(`/${cloudPath}`)) {
    const error = new Error('补充文件路径与当前用户不匹配');
    error.code = 'FILE_OWNER_MISMATCH';
    throw error;
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
    const error = new Error('补充文件大小必须在 25MB 以内');
    error.code = 'INVALID_FILE_SIZE';
    throw error;
  }
  const profile = await ensureProfile(uid, userInfo);
  const recordId = `${submissionId}_${slotId}_${uid}`;
  const ref = db.collection(SUPPLEMENT_COLLECTION).doc(recordId);
  const existing = firstDocument(await ref.get());
  if (existing && ['pending', 'approved'].includes(existing.status)) {
    const error = new Error(existing.status === 'pending' ? '这项资料已经在等待审核' : '你已经完成过这项补充');
    error.code = 'SUPPLEMENT_EXISTS';
    throw error;
  }
  await ref.set({
    submissionId,
    submissionTitle: submission.title || '未命名采集内容',
    slotId,
    slotTitle: slot.title,
    userId: uid,
    contributorName: profile.nickname || '社区用户',
    assetType,
    mimeType,
    size,
    fileID,
    cloudPath,
    status: 'pending',
    rewardPoints: slot.rewardPoints,
    completenessGain: slot.completenessGain,
    reviewNote: '',
    reviewerId: '',
    reviewedAt: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  });
  return {
    ok: true,
    action: 'createSupplement',
    supplement: { id: recordId, submissionId, slotId, slotTitle: slot.title, status: 'pending' }
  };
}

function feedbackView(item) {
  return {
    id: item._id || item.id || '',
    type: item.type || 'other',
    content: item.content || '',
    status: item.status || 'open',
    response: item.response || '',
    createdAt: item.createdAt || null,
    resolvedAt: item.resolvedAt || null
  };
}

async function listOwnFeedback(uid, limit = 10) {
  await ensureInteractionCollections();
  const result = await db.collection(FEEDBACK_COLLECTION)
    .where({ userId: uid })
    .limit(Math.max(1, Math.min(Number(limit) || 10, 30)))
    .get();
  return sortNewest(result.data || []).map(feedbackView);
}

async function bootstrap(uid, userInfo) {
  const profile = await ensureProfile(uid, userInfo);
  const [mySubmissions, publicSubmissions, myFeedback, rewards, myRedemptions] = await Promise.all([
    listOwn(uid, 50),
    listPublic(30, uid),
    listOwnFeedback(uid, 10),
    listRewards(),
    listOwnRedemptions(uid, 30)
  ]);
  const stats = mySubmissions.reduce((result, item) => {
    result.total += 1;
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, { total: 0, pending: 0, approved: 0, rejected: 0, needs_revision: 0 });

  return {
    ok: true,
    action: 'bootstrap',
    profile: publicProfile(profile),
    stats,
    mySubmissions,
    publicSubmissions,
    myFeedback,
    rewards,
    myRedemptions
  };
}

async function getApprovedSubmission(submissionId) {
  const submission = firstDocument(
    await db.collection(SUBMISSION_COLLECTION).doc(submissionId).get()
  );
  if (!submission || submission.status !== 'approved') {
    const error = new Error('该作品不存在或尚未公开');
    error.code = 'SUBMISSION_NOT_PUBLIC';
    throw error;
  }
  return submission;
}

function commentTargetKey(targetType, targetId) {
  return `${targetType}__${targetId}`;
}

function commentTargetFromRecord(comment) {
  const targetType = cleanText(comment && comment.targetType, 20) || 'submission';
  const targetId = cleanText(comment && comment.targetId, 128) || cleanText(comment && comment.submissionId, 128);
  return {
    targetType,
    targetId,
    targetKey: cleanText(comment && comment.targetKey, 280) || commentTargetKey(targetType, targetId),
    targetTitle: cleanText(comment && comment.targetTitle, 120)
  };
}

async function resolveCommentTarget(event) {
  const targetType = cleanText(event.targetType || 'submission', 20).toLowerCase();
  if (targetType === 'submission') {
    const targetId = cleanResourceId(event.targetId || event.submissionId, '作品');
    const submission = await getApprovedSubmission(targetId);
    return {
      targetType,
      targetId,
      targetKey: commentTargetKey(targetType, targetId),
      targetTitle: cleanText(submission.title, 120) || '社区投稿',
      submission
    };
  }
  const targets = COMMENT_TARGETS[targetType];
  const targetId = cleanResourceId(event.targetId, '评论对象');
  const targetTitle = targets && targets[targetId];
  if (!targetTitle) {
    const error = new Error('该内容不存在或暂未开放评论');
    error.code = 'COMMENT_TARGET_NOT_FOUND';
    throw error;
  }
  return {
    targetType,
    targetId,
    targetKey: commentTargetKey(targetType, targetId),
    targetTitle,
    submission: null
  };
}

function sameCommentTarget(comment, target) {
  const existing = commentTargetFromRecord(comment);
  return existing.targetType === target.targetType && existing.targetId === target.targetId;
}

async function updateCommentCount(transaction, target, delta) {
  if (target.targetType === 'submission') {
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(target.targetId);
    const submission = firstDocument(await submissionRef.get());
    if (!submission || submission.status !== 'approved') {
      const error = new Error('该作品不存在或尚未公开');
      error.code = 'SUBMISSION_NOT_PUBLIC';
      throw error;
    }
    await submissionRef.update({
      commentCount: Math.max(0, (Number(submission.commentCount) || 0) + delta),
      updatedAt: db.serverDate()
    });
    return;
  }
  const counterRef = transaction.collection(CONTENT_INTERACTION_COLLECTION).doc(target.targetKey);
  const counter = firstDocument(await counterRef.get());
  await counterRef.set({
    targetType: target.targetType,
    targetId: target.targetId,
    targetKey: target.targetKey,
    targetTitle: target.targetTitle || (counter && counter.targetTitle) || '',
    commentCount: Math.max(0, (Number(counter && counter.commentCount) || 0) + delta),
    updatedAt: db.serverDate()
  });
}

async function createInteractionNotification(transaction, data) {
  const userId = cleanText(data && data.userId, 128);
  if (!userId) return;
  await transaction.collection(NOTIFICATION_COLLECTION).add({
    userId,
    type: cleanText(data.type, 40),
    title: cleanText(data.title, 120),
    message: cleanText(data.message, 300),
    actorName: cleanText(data.actorName, 40),
    targetType: cleanText(data.targetType, 20),
    targetId: cleanText(data.targetId, 128),
    targetTitle: cleanText(data.targetTitle, 120),
    commentId: cleanText(data.commentId, 128),
    isRead: false,
    createdAt: db.serverDate(),
    readAt: null
  });
}

function notificationView(item) {
  return {
    id: item._id || item.id || '',
    type: item.type || 'interaction',
    title: item.title || '互动消息',
    message: item.message || '',
    actorName: item.actorName || '',
    targetType: item.targetType || '',
    targetId: item.targetId || '',
    targetTitle: item.targetTitle || '',
    commentId: item.commentId || '',
    isRead: Boolean(item.isRead),
    createdAt: item.createdAt || null,
    readAt: item.readAt || null
  };
}

async function listNotifications(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureInteractionCollections();
  const requestedLimit = Number(event.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 50))
    : 30;
  const result = await db.collection(NOTIFICATION_COLLECTION)
    .where({ userId: uid })
    .limit(100)
    .get();
  const all = [...(result.data || [])].sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime() || 0;
    const rightTime = new Date(right.createdAt || 0).getTime() || 0;
    return rightTime - leftTime;
  });
  return {
    ok: true,
    action: 'getNotifications',
    unreadCount: all.filter((item) => !item.isRead).length,
    items: all.slice(0, limit).map(notificationView)
  };
}

async function markNotificationRead(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureInteractionCollections();
  if (event.all === true) {
    const result = await db.collection(NOTIFICATION_COLLECTION)
      .where({ userId: uid })
      .limit(100)
      .get();
    const unread = (result.data || []).filter((item) => !item.isRead && (item._id || item.id));
    await Promise.all(unread.map((item) => db.collection(NOTIFICATION_COLLECTION).doc(item._id || item.id).update({
      isRead: true,
      readAt: db.serverDate()
    })));
    return { ok: true, action: 'markNotificationRead', marked: unread.length, all: true };
  }
  const notificationId = cleanResourceId(event.notificationId, '消息');
  const ref = db.collection(NOTIFICATION_COLLECTION).doc(notificationId);
  const notification = firstDocument(await ref.get());
  if (!notification || notification.userId !== uid) {
    throw interactionError('NOTIFICATION_NOT_FOUND', '消息不存在');
  }
  if (!notification.isRead) {
    await ref.update({ isRead: true, readAt: db.serverDate() });
  }
  return { ok: true, action: 'markNotificationRead', notificationId, marked: notification.isRead ? 0 : 1 };
}

async function getInteractions(uid, event) {
  await ensureInteractionCollections();
  const target = await resolveCommentTarget(event);
  const requestedOffset = Number(event.commentOffset);
  const requestedLimit = Number(event.commentLimit);
  const commentOffset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.min(Math.floor(requestedOffset), 100))
    : 0;
  const commentLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 20))
    : 10;
  const queries = [db.collection(COMMENT_COLLECTION)
    .where({ targetKey: target.targetKey })
    .limit(100)
    .get()];
  if (target.targetType === 'submission') {
    queries.push(db.collection(COMMENT_COLLECTION)
      .where({ submissionId: target.targetId })
      .limit(100)
      .get());
  }
  const queryResults = await Promise.all(queries);
  const uniqueComments = new Map();
  queryResults.flatMap((result) => result.data || []).forEach((comment) => {
    if (comment.status === 'visible' && sameCommentTarget(comment, target)) {
      uniqueComments.set(comment._id || comment.id, comment);
    }
  });
  const allComments = [...uniqueComments.values()]
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime() || 0;
      const rightTime = new Date(right.createdAt || 0).getTime() || 0;
      return leftTime - rightTime;
    })
    .map((comment) => ({
      id: comment._id || '',
      parentId: comment.parentId || '',
      rootId: comment.rootId || comment.parentId || comment._id || '',
      replyToUserId: comment.replyToUserId || '',
      content: comment.content || '',
      authorName: comment.authorName || '社区用户',
      createdAt: comment.createdAt || null,
      isMine: comment.userId === uid
    }));
  const comments = allComments.slice(commentOffset, commentOffset + commentLimit);
  let viewerLiked = false;
  let likers = [];
  if (target.targetType === 'submission') try {
    const likeId = `${target.targetId}_${uid}`;
    viewerLiked = Boolean(firstDocument(await db.collection(LIKE_COLLECTION).doc(likeId).get()));
  } catch (_) {}
  if (target.targetType === 'submission') try {
    const liked = await db.collection(LIKE_COLLECTION)
      .where({ submissionId: target.targetId })
      .limit(20)
      .get();
    const likedWithNames = await Promise.all([...(liked.data || [])].map(async (item) => {
      let userName = cleanText(item.userName, 40);
      if (!userName && item.userId) {
        try {
          const profile = firstDocument(
            await db.collection(PROFILE_COLLECTION).doc(item.userId).get()
          );
          userName = cleanText(profile && profile.nickname, 40);
        } catch (_) {}
      }
      return { ...item, resolvedUserName: userName };
    }));
    likers = likedWithNames
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime() || 0;
        const rightTime = new Date(right.createdAt || 0).getTime() || 0;
        return rightTime - leftTime;
      })
      .map((item) => item.resolvedUserName)
      .filter(Boolean)
      .slice(0, 12);
  } catch (_) {}
  return {
    ok: true,
    action: 'getInteractions',
    submissionId: target.targetType === 'submission' ? target.targetId : '',
    targetType: target.targetType,
    targetId: target.targetId,
    targetKey: target.targetKey,
    targetTitle: target.targetTitle,
    likeCount: target.submission ? Math.max(0, Number(target.submission.likeCount) || 0) : 0,
    commentCount: allComments.length,
    commentOffset,
    commentLimit,
    hasMoreComments: commentOffset + comments.length < allComments.length,
    viewerLiked,
    likers,
    comments
  };
}

async function toggleLike(uid, userInfo, event) {
  requireStableAccount(userInfo);
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const profile = await ensureProfile(uid, userInfo);
  const likeId = `${submissionId}_${uid}`;
  return db.runTransaction(async (transaction) => {
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(submissionId);
    const likeRef = transaction.collection(LIKE_COLLECTION).doc(likeId);
    const submission = firstDocument(await submissionRef.get());
    if (!submission || submission.status !== 'approved') {
      const error = new Error('该作品不存在或尚未公开');
      error.code = 'SUBMISSION_NOT_PUBLIC';
      throw error;
    }
    const existingLike = firstDocument(await likeRef.get());
    const wasLiked = Boolean(existingLike);
    const currentCount = Math.max(0, Number(submission.likeCount) || 0);
    if (wasLiked) {
      await likeRef.remove();
      await submissionRef.update({
        likeCount: Math.max(0, currentCount - 1),
        updatedAt: db.serverDate()
      });
    } else {
      await likeRef.set({
        submissionId,
        userId: uid,
        userName: profile.nickname || '社区用户',
        createdAt: db.serverDate()
      });
      await submissionRef.update({
        likeCount: currentCount + 1,
        updatedAt: db.serverDate()
      });
    }
    return {
      ok: true,
      action: 'toggleLike',
      submissionId,
      liked: !wasLiked,
      likeCount: wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1
    };
  });
}

async function createComment(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureInteractionCollections();
  const target = await resolveCommentTarget(event);
  const parentId = event.parentId ? cleanResourceId(event.parentId, '评论') : '';
  const content = normalizeCommentContent(event.content);
  let parent = null;
  if (parentId) {
    parent = firstDocument(await db.collection(COMMENT_COLLECTION).doc(parentId).get());
    if (!parent || !sameCommentTarget(parent, target) || parent.status !== 'visible') {
      const error = new Error('要回复的评论不存在');
      error.code = 'PARENT_COMMENT_NOT_FOUND';
      throw error;
    }
  }
  const profile = await ensureProfile(uid, userInfo);
  const suppliedRequestId = cleanText(event.clientRequestId, 100);
  const clientRequestId = /^[a-zA-Z0-9_-]{12,100}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomBytes(16).toString('hex');
  const commentId = `comment_${crypto.createHash('sha256').update(`${uid}:${clientRequestId}`).digest('hex').slice(0, 40)}`;
  const transactionResult = await runInteractionTransaction(async (transaction) => {
    const commentRef = transaction.collection(COMMENT_COLLECTION).doc(commentId);
    const existingComment = firstDocument(await commentRef.get());
    if (existingComment) {
      if (existingComment.userId !== uid || !sameCommentTarget(existingComment, target) || existingComment.content !== content) {
        throw interactionError('COMMENT_REQUEST_CONFLICT', '评论请求编号冲突，请刷新后重试');
      }
      return { replayed: true };
    }
    await consumeInteractionQuota(transaction, uid, 'comment', content);
    await commentRef.set({
      targetType: target.targetType,
      targetId: target.targetId,
      targetKey: target.targetKey,
      targetTitle: target.targetTitle,
      submissionId: target.targetType === 'submission' ? target.targetId : '',
      userId: uid,
      parentId,
      rootId: parent ? (parent.rootId || parent._id || parentId) : commentId,
      replyToUserId: parent ? (parent.userId || '') : '',
      content,
      authorName: profile.nickname || '社区用户',
      status: 'visible',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    const recipientId = parent
      ? cleanText(parent.userId, 128)
      : cleanText(target.submission && target.submission.userId, 128);
    if (recipientId && recipientId !== uid) {
      await createInteractionNotification(transaction, {
        userId: recipientId,
        type: parent ? 'comment_reply' : 'submission_comment',
        title: parent ? '有人回复了你的评论' : '你的投稿收到新评论',
        message: content,
        actorName: profile.nickname || '社区用户',
        targetType: target.targetType,
        targetId: target.targetId,
        targetTitle: target.targetTitle,
        commentId
      });
    }
    await updateCommentCount(transaction, target, 1);
    return { replayed: false };
  });
  return {
    ok: true,
    action: 'createComment',
    submissionId: target.targetType === 'submission' ? target.targetId : '',
    targetType: target.targetType,
    targetId: target.targetId,
    commentId,
    replayed: Boolean(transactionResult && transactionResult.replayed)
  };
}

async function deleteComment(uid, userInfo, event) {
  requireStableAccount(userInfo);
  const commentId = cleanResourceId(event.commentId, '评论');
  return db.runTransaction(async (transaction) => {
    const commentRef = transaction.collection(COMMENT_COLLECTION).doc(commentId);
    const comment = firstDocument(await commentRef.get());
    if (!comment || comment.status !== 'visible') {
      const error = new Error('评论不存在或已删除');
      error.code = 'COMMENT_NOT_FOUND';
      throw error;
    }
    if (comment.userId !== uid) {
      const error = new Error('只能删除自己的评论');
      error.code = 'FORBIDDEN';
      throw error;
    }
    const target = commentTargetFromRecord(comment);
    await commentRef.update({
      status: 'deleted',
      content: '',
      deletedAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    await updateCommentCount(transaction, {
      ...target,
      targetTitle: comment.targetTitle || ''
    }, -1);
    return {
      ok: true,
      action: 'deleteComment',
      commentId,
      submissionId: target.targetType === 'submission' ? target.targetId : '',
      targetType: target.targetType,
      targetId: target.targetId
    };
  });
}

async function createReport(uid, userInfo, event) {
  requireStableAccount(userInfo);
  const targetType = cleanText(event.targetType || 'submission', 20);
  const targetId = targetType === 'comment' ? cleanResourceId(event.targetId, '评论') : cleanResourceId(event.submissionId, '作品');
  const reason = cleanText(event.reason, 40);
  const detail = cleanText(event.detail, 500);
  if (!['submission', 'comment'].includes(targetType) || !ALLOWED_REPORT_REASONS.has(reason)) {
    const error = new Error('举报类型或原因不正确');
    error.code = 'INVALID_REPORT';
    throw error;
  }
  let contentTarget = null;
  if (targetType === 'comment') {
    const comment = firstDocument(await db.collection(COMMENT_COLLECTION).doc(targetId).get());
    if (!comment || comment.status !== 'visible') {
      const error = new Error('被举报的评论不存在');
      error.code = 'COMMENT_NOT_FOUND';
      throw error;
    }
    contentTarget = commentTargetFromRecord(comment);
    if (contentTarget.targetType === 'submission') await getApprovedSubmission(contentTarget.targetId);
    else await resolveCommentTarget(contentTarget);
  } else {
    const submission = await getApprovedSubmission(targetId);
    contentTarget = {
      targetType: 'submission',
      targetId,
      targetKey: commentTargetKey('submission', targetId),
      targetTitle: submission.title || '社区投稿'
    };
  }
  const reportId = `${targetType}_${targetId}_${uid}`;
  const profile = await ensureProfile(uid, userInfo);
  await db.runTransaction(async (transaction) => {
    const reportRef = transaction.collection(REPORT_COLLECTION).doc(reportId);
    const existing = firstDocument(await reportRef.get());
    if (existing && existing.status === 'pending') {
      throw interactionError('REPORT_EXISTS', '你已经举报过该内容，请等待管理员处理');
    }
    await consumeInteractionQuota(transaction, uid, 'report');
    await reportRef.set({
      submissionId: contentTarget.targetType === 'submission' ? contentTarget.targetId : '',
      targetType,
      targetId,
      contentTargetType: contentTarget.targetType,
      contentTargetId: contentTarget.targetId,
      contentTargetKey: contentTarget.targetKey,
      contentTargetTitle: contentTarget.targetTitle || '',
      reporterId: uid,
      reporterName: profile.nickname || '社区用户',
      reason,
      detail,
      status: 'pending',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
  });
  return { ok: true, action: 'createReport', reportId };
}

async function createFeedback(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureInteractionCollections();
  const profile = await ensureProfile(uid, userInfo);
  const type = cleanText(event.type || 'suggestion', 32);
  const content = cleanText(event.content, 1200);
  const page = cleanText(event.page, 120);
  if (!ALLOWED_FEEDBACK_TYPES.has(type)) {
    const error = new Error('反馈类型不正确');
    error.code = 'INVALID_FEEDBACK_TYPE';
    throw error;
  }
  if (content.length < 5) {
    const error = new Error('请至少填写 5 个字，方便我们理解问题');
    error.code = 'FEEDBACK_TOO_SHORT';
    throw error;
  }
  const result = await db.collection(FEEDBACK_COLLECTION).add({
    userId: uid,
    userName: profile.nickname || '社区用户',
    type,
    content,
    page,
    status: 'open',
    response: '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
    resolvedAt: null,
    resolvedBy: ''
  });
  return {
    ok: true,
    action: 'createFeedback',
    feedbackId: result.id || result._id || '',
    feedback: {
      id: result.id || result._id || '',
      type,
      content,
      status: 'open',
      response: '',
      createdAt: new Date().toISOString(),
      resolvedAt: null
    }
  };
}

async function updateProfile(uid, userInfo, event) {
  await ensureProfile(uid, userInfo);
  const nickname = cleanText(event.nickname, 40);
  const avatarUrl = cleanText(event.avatarUrl, 500);
  if (!nickname) {
    const error = new Error('昵称不能为空');
    error.code = 'NICKNAME_REQUIRED';
    throw error;
  }

  await db.collection(PROFILE_COLLECTION).doc(uid).update({
    nickname,
    avatarUrl,
    updatedAt: db.serverDate()
  });
  const updated = firstDocument(await db.collection(PROFILE_COLLECTION).doc(uid).get());
  return { ok: true, action: 'updateProfile', profile: publicProfile(updated) };
}

async function createSubmission(uid, userInfo, event) {
  const profile = await ensureProfile(uid, userInfo);
  const assetType = cleanText(event.assetType || 'image', 20);
  const fileID = cleanText(event.fileID || event.imageFileID, 1000);
  const cloudPath = cleanText(event.cloudPath || event.imageCloudPath, 500);
  const title = cleanText(event.title, 120) || '未命名文化采集素材';
  const description = cleanText(event.description, 2000);
  const mimeType = cleanText(event.mimeType, 120);
  const size = Number(event.size) || 0;

  if (!ALLOWED_ASSET_TYPES.has(assetType)) {
    const error = new Error('不支持的素材类型');
    error.code = 'INVALID_ASSET_TYPE';
    throw error;
  }
  if (!fileID || !cloudPath) {
    const error = new Error('缺少云存储文件信息');
    error.code = 'FILE_REQUIRED';
    throw error;
  }
  if (!cloudPath.startsWith(`submissions/${uid}/`)) {
    const error = new Error('文件路径与当前用户不匹配');
    error.code = 'FILE_OWNER_MISMATCH';
    throw error;
  }
  if (!fileID.startsWith('cloud://') || !fileID.endsWith(`/${cloudPath}`)) {
    const error = new Error('云存储文件标识与文件路径不匹配');
    error.code = 'FILE_ID_MISMATCH';
    throw error;
  }
  if (size <= 0 || size > MAX_FILE_BYTES) {
    const error = new Error('文件大小必须在 25MB 以内');
    error.code = 'INVALID_FILE_SIZE';
    throw error;
  }

  const longitude = Number(event.longitude);
  const latitude = Number(event.latitude);
  const locationAccuracy = Number(event.locationAccuracy);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    const error = new Error('请先取得有效定位');
    error.code = 'LOCATION_REQUIRED';
    throw error;
  }

  const record = {
    userId: uid,
    contributorName: profile.nickname || '楚韵守护者',
    title,
    description,
    assetType,
    mimeType,
    size,
    fileID,
    imageFileID: fileID,
    cloudPath,
    imageCloudPath: cloudPath,
    longitude,
    latitude,
    locationAccuracy: Number.isFinite(locationAccuracy) ? locationAccuracy : null,
    regionName: cleanText(event.regionName, 80) || '湖北',
    status: 'pending',
    rewardPoints: 100,
    reviewPipelineVersion: 1,
    aiReviewStatus: 'not_requested',
    aiReviewDecision: '',
    aiReviewProvider: '',
    aiReviewSummary: '',
    aiReviewUpdatedAt: null,
    likeCount: 0,
    commentCount: 0,
    completeness: 60,
    board: 'needs',
    supplementCount: 0,
    approvedSupplements: [],
    source: 'cloudbase_formal_web',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  const added = await db.collection(SUBMISSION_COLLECTION).add(record);
  await db.collection(PROFILE_COLLECTION).doc(uid).update({
    uploadCount: (Number(profile.uploadCount) || 0) + 1,
    updatedAt: db.serverDate()
  });

  return {
    ok: true,
    action: 'createSubmission',
    submission: {
      id: added.id || added._id || '',
      status: 'pending',
      rewardPoints: 100,
      title,
      cloudPath
    }
  };
}

exports.main = async (event = {}) => {
  try {
    const userInfo = app.auth().getUserInfo() || {};
    const uid = cleanText(userInfo.uid, 128);
    if (!uid) {
      return { ok: false, error: { code: 'UNAUTHENTICATED', message: '请先登录' } };
    }

    const action = cleanText(event.action, 40);
    if (action === 'bootstrap') return await bootstrap(uid, userInfo);
    if (action === 'getPublic') {
      return { ok: true, action, items: await listPublic(event.limit, uid) };
    }
    if (action === 'getMySubmissions') {
      return { ok: true, action, items: await listOwn(uid, event.limit) };
    }
    if (action === 'getMyFeedback') {
      return { ok: true, action, items: await listOwnFeedback(uid, event.limit) };
    }
    if (action === 'getNotifications') return await listNotifications(uid, userInfo, event);
    if (action === 'markNotificationRead') return await markNotificationRead(uid, userInfo, event);
    if (action === 'planRoute') return await planRoute(uid, event);
    if (action === 'updateProfile') return await updateProfile(uid, userInfo, event);
    if (action === 'getRewards') {
      return { ok: true, action, items: await listRewards() };
    }
    if (action === 'getMyRedemptions') {
      requireStableAccount(userInfo);
      return { ok: true, action, items: await listOwnRedemptions(uid, event.limit) };
    }
    if (action === 'redeemReward') return await redeemReward(uid, userInfo, event);
    if (action === 'createSubmission') return await createSubmission(uid, userInfo, event);
    if (action === 'getSupplements') return await listSupplements(uid, event);
    if (action === 'createSupplement') return await createSupplement(uid, userInfo, event);
    if (action === 'getInteractions') return await getInteractions(uid, event);
    if (action === 'toggleLike') return await toggleLike(uid, userInfo, event);
    if (action === 'createComment') return await createComment(uid, userInfo, event);
    if (action === 'deleteComment') return await deleteComment(uid, userInfo, event);
    if (action === 'createReport') return await createReport(uid, userInfo, event);
    if (action === 'createFeedback') return await createFeedback(uid, userInfo, event);

    return { ok: false, error: { code: 'INVALID_ACTION', message: '不支持的操作' } };
  } catch (error) {
    console.error('[appCore]', error);
    return {
      ok: false,
      error: {
        code: error && error.code ? String(error.code) : 'OPERATION_FAILED',
        message: error && error.message ? String(error.message) : '云端操作失败'
      }
    };
  }
};
