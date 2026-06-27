// tools/server.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SECURE_KEY = 'ChuYunLianJi@2026_Secret';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'local-admin-dev-token';
const SERVER_BUILD = 'admin-submissions-2026-06-27c';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ROOT_DIR = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const SUBMISSION_UPLOAD_DIR = path.join(UPLOAD_DIR, 'submissions');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const HUBEI_GEOJSON_FILE = path.join(ROOT_DIR, 'hubei_boundary.geojson');
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MEDIA_EXTENSIONS = {
  ...IMAGE_EXTENSIONS,
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};
const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_revision', 'archived']);

let hubeiFeatures = [];
let writeQueue = Promise.resolve();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    serverBuild: SERVER_BUILD,
    geminiConfigured: Boolean(GEMINI_API_KEY),
    geminiModel: GEMINI_MODEL,
    adminConfigured: Boolean(ADMIN_TOKEN),
  });
});

function formatGeminiError(error) {
  const parts = [error && error.message ? error.message : String(error)];
  let cause = error && error.cause;

  while (cause) {
    const detail = [
      cause.name,
      cause.code,
      cause.message,
    ].filter(Boolean).join(': ');

    if (detail) parts.push(`cause=${detail}`);
    cause = cause.cause;
  }

  return parts.join(' | ');
}

app.get('/api/gemini-diagnostics', async (req, res) => {
  const target = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;
  const startedAt = Date.now();

  if (!GEMINI_API_KEY) {
    return res.status(400).json({
      success: false,
      serverBuild: SERVER_BUILD,
      geminiConfigured: false,
      geminiModel: GEMINI_MODEL,
      message: 'GEMINI_API_KEY is missing in the current Node process.',
    });
  }

  try {
    const response = await fetch(target, {
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
      },
    });
    const bodyText = await response.text();

    return res.status(response.ok ? 200 : 502).json({
      success: response.ok,
      serverBuild: SERVER_BUILD,
      geminiConfigured: true,
      geminiModel: GEMINI_MODEL,
      target,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      bodyPreview: bodyText.slice(0, 600),
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      serverBuild: SERVER_BUILD,
      geminiConfigured: true,
      geminiModel: GEMINI_MODEL,
      target,
      elapsedMs: Date.now() - startedAt,
      error: formatGeminiError(error),
      errorName: error.name,
      errorCode: error.cause && error.cause.code,
    });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'admin.html'));
});

function loadHubeiBoundary() {
  if (!fs.existsSync(HUBEI_GEOJSON_FILE)) {
    throw new Error(`未找到湖北边界文件: ${HUBEI_GEOJSON_FILE}`);
  }

  const geojson = JSON.parse(fs.readFileSync(HUBEI_GEOJSON_FILE, 'utf8'));
  hubeiFeatures = Array.isArray(geojson.features) ? geojson.features : [];

  if (hubeiFeatures.length === 0) {
    throw new Error('湖北边界 GeoJSON 中没有 features 数据');
  }
}

function readLimitedBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES && !rejected) {
        rejected = true;
        chunks.length = 0;
        reject({ status: 413, message: '上传图片不能超过 20MB！' });
        return;
      }

      if (rejected) return;
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

function parseContentDisposition(value) {
  const result = {};
  const parts = value.split(';').map((item) => item.trim());

  for (const part of parts.slice(1)) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;

    const key = part.slice(0, eqIndex).toLowerCase();
    let val = part.slice(eqIndex + 1);
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }

  return result;
}

function parseMultipartForm(req, bodyBuffer) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    throw { status: 400, message: '请求必须使用 multipart/form-data 上传图片。' };
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  const files = {};
  let cursor = bodyBuffer.indexOf(boundary);

  while (cursor !== -1) {
    let partStart = cursor + boundary.length;
    const marker = bodyBuffer.slice(partStart, partStart + 2).toString('latin1');
    if (marker === '--') break;
    if (marker === '\r\n') partStart += 2;

    const nextBoundary = bodyBuffer.indexOf(boundary, partStart);
    if (nextBoundary === -1) break;

    let partEnd = nextBoundary;
    if (bodyBuffer.slice(partEnd - 2, partEnd).toString('latin1') === '\r\n') {
      partEnd -= 2;
    }

    const partBuffer = bodyBuffer.slice(partStart, partEnd);
    const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'));

    if (headerEnd !== -1) {
      const rawHeaders = partBuffer.slice(0, headerEnd).toString('latin1');
      const content = partBuffer.slice(headerEnd + 4);
      const headers = {};

      rawHeaders.split('\r\n').forEach((line) => {
        const splitIndex = line.indexOf(':');
        if (splitIndex === -1) return;
        headers[line.slice(0, splitIndex).toLowerCase()] = line.slice(splitIndex + 1).trim();
      });

      const disposition = parseContentDisposition(headers['content-disposition'] || '');
      if (disposition.name) {
        if (disposition.filename) {
          files[disposition.name] = {
            originalName: path.basename(disposition.filename),
            contentType: headers['content-type'] || 'application/octet-stream',
            buffer: content,
            size: content.length,
          };
        } else {
          fields[disposition.name] = content.toString('utf8');
        }
      }
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

function verifySignedLocationPayload({ longitude, latitude, timestamp, deviceId, signature }) {
  const now = Math.floor(Date.now() / 1000);

  if (!longitude || !latitude || !timestamp || !deviceId || !signature) {
    return {
      ok: false,
      status: 400,
      message: '缺少必要的位置安全校验参数！',
    };
  }

  if (Math.abs(now - Number(timestamp)) > 300) {
    return {
      ok: false,
      status: 403,
      message: '请求超时，疑似重放虚拟定位！',
    };
  }

  const payload = `${parseFloat(longitude).toFixed(6)}|${parseFloat(latitude).toFixed(6)}|${timestamp}|${deviceId}`;
  const localSignature = crypto.createHmac('sha256', SECURE_KEY).update(payload).digest('hex');

  if (localSignature !== signature) {
    return {
      ok: false,
      status: 401,
      message: '安全证书签名校验失败，经纬度已被恶意篡改！',
    };
  }

  return { ok: true };
}

function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.slice(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
      return 'image/gif';
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function analyzeSubmissionQuality({ image, fields, detectedType }) {
  const description = (fields.description || '').trim();
  const descriptionLower = description.toLowerCase();
  const fileName = (image.originalName || fields.fileNameHint || '').toLowerCase();
  const issues = [];
  const suggestions = [];
  let score = 50;
  let highRisk = false;
  let culturalSignal = false;

  if (image.size < 50 * 1024) {
    score -= 26;
    issues.push('image_too_small');
    suggestions.push('图片文件过小，建议上传更清晰的现场原图。');
  } else if (image.size < 200 * 1024) {
    score += 2;
    issues.push('image_low_detail');
    suggestions.push('图片细节可能不足，建议靠近主体再拍一张。');
  } else if (image.size < 1024 * 1024) {
    score += 10;
  } else {
    score += 16;
  }

  if (image.size > 8 * 1024 * 1024) {
    score -= 4;
    issues.push('image_large');
    suggestions.push('图片较大，后续可压缩后再进入正式存证流程。');
  }

  if (!description) {
    score -= 18;
    issues.push('description_missing');
    suggestions.push('建议补充地点、年代、来源或现场观察说明。');
  } else if (description.length < 12) {
    score -= 10;
    issues.push('description_too_short');
    suggestions.push('描述略短，可以补充采集对象和文化背景。');
  } else {
    score += 8;

    if (description.length >= 30) {
      score += 6;
    }
  }

  if (/ai|fake|midjourney|stable.?diffusion|sd-|generated|render/i.test(fileName)) {
    score -= 55;
    highRisk = true;
    issues.push('suspected_aigc_filename');
    suggestions.push('文件名存在疑似 AI 生成特征，请上传真实现场拍摄素材。');
  }

  if (fields.mockAigcBlocked === 'true') {
    score -= 70;
    highRisk = true;
    issues.push('aigc_mock_blocked');
    suggestions.push('演示拦截开关已开启，本次提交按风险素材处理。');
  }

  if (/https?:\/\/|www\.|微信|vx|qq|电话|手机号|\d{7,}/i.test(description)) {
    score -= 28;
    highRisk = true;
    issues.push('possible_ad_or_contact');
    suggestions.push('描述里不要放联系方式、广告链接或无关推广信息。');
  }

  if (!fields.regionName) {
    score -= 8;
    issues.push('region_context_missing');
  } else {
    score += 4;
  }

  if (detectedType === 'image/gif') {
    score -= 6;
    issues.push('gif_lower_confidence');
    suggestions.push('GIF 动图不利于细节识别，建议补充一张静态清晰照片。');
  }

  if (/(楚|湖北|武汉|荆州|襄阳|宜昌|黄冈|黄石|孝感|咸宁|随州|恩施|十堰|鄂州|荆门|天门|潜江|仙桃|神农架|非遗|遗址|古建|古建筑|碑|碑刻|题刻|祠堂|戏台|民俗|口述|器物|陶|瓷|青铜|漆器|博物馆|展陈|墓|古墓|石刻|老街|传统|手艺|匠人|族谱|村史)/.test(description)) {
    score += 12;
    culturalSignal = true;
  }

  if (/(随便|测试|test|random|自拍|风景照|午饭|猫|狗|表情包|截图|二维码|广告|商品|网图|壁纸)/i.test(descriptionLower)) {
    score -= 35;
    highRisk = true;
    issues.push('low_relevance_content');
    suggestions.push('请上传与湖北文化遗产、非遗线索或现场采集对象直接相关的素材。');
  }

  if (description && !culturalSignal) {
    score -= 14;
    issues.push('low_relevance_content');
    suggestions.push('描述中暂未看到明确的湖北文化遗产线索，请补充地点、对象、年代或民俗背景。');
  }

  const qualityScore = clampScore(score);
  const decision = highRisk || qualityScore < 55
    ? 'rejected'
    : qualityScore < 75
      ? 'needs_review'
      : 'approved';

  const approved = false;
  const aiAuthenticity = clampScore(highRisk ? Math.min(45, qualityScore) : Math.min(94, 60 + Math.floor(qualityScore / 3)));
  const category = !culturalSignal
    ? '其他'
    : description.includes('碑') || description.includes('刻')
      ? '碑刻/题刻线索'
      : description.includes('民俗') || description.includes('口述')
        ? '民俗与口述线索'
        : '湖北文化遗产实拍素材';

  if (!suggestions.length) {
    suggestions.push(decision === 'approved' ? '素材质量良好，可进入待审核内容池。' : '建议补充更清晰图片和更完整说明。');
  }

  return {
    approved,
    decision,
    qualityScore,
    aiAuthenticity,
    category,
    issues,
    suggestions,
    moderationLabels: issues.includes('possible_ad_or_contact') ? ['needs_manual_review'] : ['safe'],
    provider: 'local-rules',
    aiUsed: false,
  };
}

function hasHighRiskLocalIssue(quality) {
  return (quality.issues || []).some(issue => [
    'suspected_aigc_filename',
    'aigc_mock_blocked',
    'possible_ad_or_contact',
    'unsupported_image_type',
    'location_signature_failed',
  ].includes(issue));
}

function applyStrictQualityPolicy({ aiQuality, localQuality, aiErrorMessage }) {
  const usedGemini = Boolean(aiQuality);
  const sourceQuality = usedGemini ? aiQuality : localQuality;
  const issues = [...new Set([...(sourceQuality.issues || []), ...(localQuality.issues || [])])];
  const suggestions = [...new Set([...(sourceQuality.suggestions || []), ...(localQuality.suggestions || [])])];
  const category = sourceQuality.category || localQuality.category || '其他';
  const score = clampScore(sourceQuality.qualityScore || localQuality.qualityScore || 0);
  const riskyCategory = ['无关内容', '其他'].includes(category);
  const riskyIssue = issues.some(issue => /unrelated|irrelevant|random|low_relevance|non_heritage|advertising|privacy|unsafe/i.test(issue));
  const localHighRisk = hasHighRiskLocalIssue(localQuality);

  let decision = 'needs_review';
  if (localHighRisk || sourceQuality.decision === 'rejected' || score < 60 || riskyCategory || riskyIssue) {
    decision = 'rejected';
  } else if (usedGemini && sourceQuality.decision === 'approved' && score >= 80 && !riskyCategory && !riskyIssue) {
    decision = 'approved';
  }

  if (!usedGemini && decision !== 'rejected') {
    decision = 'needs_review';
  }

  if (decision === 'needs_review' && !suggestions.length) {
    suggestions.push('AI 初筛未达到自动通过标准，建议补充更清晰图片和更完整说明后进入人工审核。');
  }

  return {
    approved: decision === 'approved',
    decision,
    qualityScore: score,
    aiAuthenticity: clampScore(sourceQuality.aiAuthenticity || localQuality.aiAuthenticity || 0),
    category,
    issues,
    suggestions,
    moderationLabels: decision === 'approved' ? ['safe'] : ['needs_manual_review'],
    provider: usedGemini ? 'gemini' : 'local-rules',
    aiUsed: usedGemini,
    aiError: usedGemini ? null : (aiErrorMessage || (GEMINI_API_KEY ? 'gemini_call_failed' : 'gemini_api_key_missing')),
  };
}
function extractJsonFromAiText(text) {
  const raw = String(text || '').trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('AI 返回内容不是 JSON');
  }

  return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
}

function normalizeAiQualityResult(result) {
  const decision = ['approved', 'needs_review', 'rejected'].includes(result.decision)
    ? result.decision
    : 'needs_review';

  return {
    approved: decision !== 'rejected',
    decision,
    qualityScore: Math.max(0, Math.min(100, Number(result.qualityScore) || 0)),
    aiAuthenticity: Math.max(0, Math.min(100, Number(result.aiAuthenticity) || 0)),
    category: result.category || '其他',
    issues: Array.isArray(result.issues) ? result.issues : [],
    suggestions: Array.isArray(result.suggestions) && result.suggestions.length
      ? result.suggestions
      : ['建议补充更清晰图片和更完整说明。'],
    moderationLabels: decision === 'rejected' ? ['needs_manual_review'] : ['safe'],
    provider: 'gemini',
    aiUsed: true,
  };
}

async function callGeminiQualityCheck({ image, fields, detectedType }) {
  if (!GEMINI_API_KEY) {
    return null;
  }

  const prompt = `
你是“楚韵链迹”的用户上传内容质检员。
请根据图片和用户文字描述，判断这条文化遗产采集内容是否适合进入待审核内容池。

用户描述：
${fields.description || '无'}

定位区域：
${fields.regionName || '未知'}

素材类型：
${fields.assetType || 'image'}

请只返回 JSON，不要解释，不要 Markdown。
JSON 格式必须是：
{
  "decision": "approved | needs_review | rejected",
  "qualityScore": 0,
  "aiAuthenticity": 0,
  "category": "碑刻/题刻线索 | 古建筑纹样 | 民俗与口述线索 | 博物馆/展陈线索 | 无关内容 | 其他",
  "issues": ["英文问题标签"],
  "suggestions": ["给用户看的中文建议"]
}

判断标准：
- 图片清晰、像真实拍摄、和湖北文化遗产相关，decision 为 approved。
- 图片模糊、主体不清、描述太短，decision 为 needs_review。
- 疑似 AI 生成图、广告、无关图片、色情暴力、个人隐私，decision 为 rejected。
- suggestions 要温和，像产品提示。
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: detectedType,
                  data: image.buffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API 调用失败: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return normalizeAiQualityResult(extractJsonFromAiText(text));
}

function isPointInRing(longitude, latitude, ring) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersects = yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function isPointInPolygon(longitude, latitude, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  if (!isPointInRing(longitude, latitude, polygon[0])) return false;

  for (const hole of polygon.slice(1)) {
    if (isPointInRing(longitude, latitude, hole)) return false;
  }

  return true;
}

function findHubeiRegion(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  for (const feature of hubeiFeatures) {
    const geometry = feature.geometry || {};
    const coordinates = geometry.coordinates || [];
    let matched = false;

    if (geometry.type === 'Polygon') {
      matched = isPointInPolygon(lon, lat, coordinates);
    } else if (geometry.type === 'MultiPolygon') {
      matched = coordinates.some((polygon) => isPointInPolygon(lon, lat, polygon));
    }

    if (matched) {
      return {
        name: feature.properties?.name || '湖北省',
        level: feature.properties?.level || 'city',
      };
    }
  }

  return null;
}

function normalizeOptionalText(value, maxLength = 2000) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseOptionalJson(value, fallback = null) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function normalizeAssetType(value, detectedType) {
  const raw = normalizeOptionalText(value, 40).toLowerCase();
  if (raw === 'image') return 'photo';
  if (['photo', 'video', 'audio', 'text', 'oral-history'].includes(raw)) return raw;
  if (detectedType && detectedType.startsWith('video/')) return 'video';
  if (detectedType && detectedType.startsWith('audio/')) return 'audio';
  return 'photo';
}

function getUploadedSubmissionFile(files) {
  return files.media || files.image || files.file || Object.values(files)[0] || null;
}

function detectSubmissionMediaType(file) {
  const detectedImageType = detectImageType(file.buffer);
  if (detectedImageType) return detectedImageType;

  const contentType = String(file.contentType || '').toLowerCase();
  if (ALLOWED_MEDIA_TYPES.has(contentType)) return contentType;
  return null;
}

function getAbsolutePublicUrl(req, publicPath) {
  return `${req.protocol}://${req.get('host')}${publicPath}`;
}

function getAdminToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.headers['x-admin-token'] || '';
}

function requireAdmin(req, res, next) {
  if (getAdminToken(req) !== ADMIN_TOKEN) {
    return res.status(401).json({
      success: false,
      message: 'admin_token_required',
    });
  }

  return next();
}

async function readSubmissions() {
  try {
    const raw = await fs.promises.readFile(SUBMISSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeSubmissions(items) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.writeFile(SUBMISSIONS_FILE, JSON.stringify(items, null, 2), 'utf8');
}

function createSubmissionRecord(record) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const items = await readSubmissions();
    const lastId = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    const createdAt = new Date().toISOString();
    const location = {
      longitude: Number(record.longitude).toFixed(6),
      latitude: Number(record.latitude).toFixed(6),
      accuracy: record.locationAccuracy,
      regionName: record.regionName,
      regionLevel: record.regionLevel,
    };
    const submission = {
      id: lastId + 1,
      title: normalizeOptionalText(record.title, 120),
      assetType: record.assetType || 'photo',
      originalName: record.originalName,
      storedName: record.storedName,
      filePath: record.filePath,
      fileUrl: record.fileUrl,
      originalFileUrl: record.originalFileUrl || record.fileUrl || record.filePath,
      thumbnailUrl: record.thumbnailUrl || record.fileUrl || record.filePath,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      sha256: record.sha256,
      longitude: location.longitude,
      latitude: location.latitude,
      locationAccuracy: record.locationAccuracy,
      location,
      regionName: record.regionName,
      regionLevel: record.regionLevel,
      description: record.description,
      deviceId: record.deviceId,
      submitter: record.submitter || null,
      aiResult: record.aiResult || null,
      status: 'pending',
      reviewNote: '',
      reviewedAt: null,
      reviewer: null,
      reviewHistory: [],
      createdAt,
      updatedAt: createdAt,
    };

    items.unshift(submission);
    await writeSubmissions(items);
    return submission;
  });

  return writeQueue;
}

function updateSubmissionById(id, updater) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const items = await readSubmissions();
    const index = items.findIndex((item) => String(item.id) === String(id));

    if (index === -1) {
      const err = new Error('submission_not_found');
      err.status = 404;
      throw err;
    }

    const updated = updater({ ...items[index] });
    items[index] = updated;
    await writeSubmissions(items);
    return updated;
  });

  return writeQueue;
}

app.post('/api/verify-location', (req, res) => {
  const { longitude, latitude, timestamp, deviceId, signature } = req.body;
  const signatureResult = verifySignedLocationPayload({ longitude, latitude, timestamp, deviceId, signature });

  if (!signatureResult.ok) {
    return res.status(signatureResult.status).json({
      success: false,
      message: signatureResult.message,
    });
  }

  const region = findHubeiRegion(longitude, latitude);
  if (!region) {
    return res.status(400).json({
      success: false,
      message: '越界异常：您当前所在的位置不属于湖北非遗保护采集区范围内！',
    });
  }

  return res.json({
    success: true,
    regionName: region.name,
    regionLevel: region.level,
    message: `地理围栏安全校验通过！您当前位于：${region.name}`,
  });
});

app.post('/api/upload-image', async (req, res) => {
  try {
    const bodyBuffer = await readLimitedBody(req);
    const { fields, files } = parseMultipartForm(req, bodyBuffer);
    const image = files.image;

    if (!image || image.size === 0) {
      return res.status(400).json({
        success: false,
        message: '请先选择一张本地图片再上传。',
      });
    }

    const detectedType = detectImageType(image.buffer);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType)) {
      return res.status(415).json({
        success: false,
        message: '仅支持真实的 JPG、PNG、WEBP、GIF 图片上传。',
      });
    }

    const signatureResult = verifySignedLocationPayload(fields);
    if (!signatureResult.ok) {
      return res.status(signatureResult.status).json({
        success: false,
        message: signatureResult.message,
      });
    }

    const region = findHubeiRegion(fields.longitude, fields.latitude);
    if (!region) {
      return res.status(400).json({
        success: false,
        message: '越界异常：您当前所在的位置不属于湖北非遗保护采集区范围内！',
      });
    }

    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });

    const ext = IMAGE_EXTENSIONS[detectedType];
    const storedName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const storedPath = path.join(UPLOAD_DIR, storedName);
    const publicPath = `/uploads/${storedName}`;
    const fileUrl = `http://localhost:${PORT}${publicPath}`;
    const sha256 = crypto.createHash('sha256').update(image.buffer).digest('hex');

    await fs.promises.writeFile(storedPath, image.buffer);

    const locationAccuracy = Number.isFinite(Number(fields.locationAccuracy)) ? Number(fields.locationAccuracy) : null;
    let submission;
    try {
      submission = await createSubmissionRecord({
        originalName: image.originalName,
        storedName,
        filePath: publicPath,
        fileUrl,
        mimeType: detectedType,
        fileSize: image.size,
        sha256,
        longitude: Number(fields.longitude),
        latitude: Number(fields.latitude),
        locationAccuracy,
        regionName: region.name,
        regionLevel: region.level,
        description: normalizeOptionalText(fields.description),
        deviceId: normalizeOptionalText(fields.deviceId, 200),
      });
    } catch (storeErr) {
      await fs.promises.unlink(storedPath).catch(() => {});
      throw storeErr;
    }

    return res.json({
      success: true,
      regionName: region.name,
      regionLevel: region.level,
      submission: {
        id: submission.id,
        status: submission.status,
        createdAt: submission.createdAt,
      },
      file: {
        originalName: image.originalName,
        storedName,
        size: image.size,
        mimeType: detectedType,
        sha256,
        url: fileUrl,
      },
      message: `图片上传成功，采集记录 #${submission.id} 已进入本地待审核库。`,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error('图片上传接口异常:', err.message || err);
    return res.status(status).json({
      success: false,
      message: err.message || '图片上传失败，请检查本地服务状态。',
    });
  }
});

app.post('/api/submissions', async (req, res) => {
  try {
    const bodyBuffer = await readLimitedBody(req);
    const { fields, files } = parseMultipartForm(req, bodyBuffer);
    const media = getUploadedSubmissionFile(files);

    if (!media || media.size === 0) {
      return res.status(400).json({
        success: false,
        message: 'submission_file_required',
      });
    }

    const detectedType = detectSubmissionMediaType(media);
    if (!detectedType || !ALLOWED_MEDIA_TYPES.has(detectedType)) {
      return res.status(415).json({
        success: false,
        message: 'unsupported_submission_media_type',
      });
    }

    const signatureResult = verifySignedLocationPayload(fields);
    if (!signatureResult.ok) {
      return res.status(signatureResult.status).json({
        success: false,
        message: signatureResult.message,
      });
    }

    const region = findHubeiRegion(fields.longitude, fields.latitude);
    if (!region) {
      return res.status(400).json({
        success: false,
        message: 'location_outside_hubei',
      });
    }

    await fs.promises.mkdir(SUBMISSION_UPLOAD_DIR, { recursive: true });

    const ext = MEDIA_EXTENSIONS[detectedType] || path.extname(media.originalName) || '.bin';
    const storedName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const storedPath = path.join(SUBMISSION_UPLOAD_DIR, storedName);
    const publicPath = `/uploads/submissions/${storedName}`;
    const fileUrl = getAbsolutePublicUrl(req, publicPath);
    const sha256 = crypto.createHash('sha256').update(media.buffer).digest('hex');

    await fs.promises.writeFile(storedPath, media.buffer);

    const locationAccuracy = Number.isFinite(Number(fields.locationAccuracy)) ? Number(fields.locationAccuracy) : null;
    const aiResult = parseOptionalJson(fields.aiResult || fields.qualityResult, null);
    const submitter = parseOptionalJson(fields.submitter, null) || {
      userId: normalizeOptionalText(fields.userId, 120),
      userName: normalizeOptionalText(fields.userName, 120),
      openid: normalizeOptionalText(fields.openid, 160),
    };

    let submission;
    try {
      submission = await createSubmissionRecord({
        title: normalizeOptionalText(fields.title, 120),
        assetType: normalizeAssetType(fields.assetType || fields.type, detectedType),
        originalName: media.originalName,
        storedName,
        filePath: publicPath,
        fileUrl,
        originalFileUrl: publicPath,
        thumbnailUrl: detectedType.startsWith('image/') ? publicPath : '',
        mimeType: detectedType,
        fileSize: media.size,
        sha256,
        longitude: Number(fields.longitude),
        latitude: Number(fields.latitude),
        locationAccuracy,
        regionName: region.name,
        regionLevel: region.level,
        description: normalizeOptionalText(fields.description),
        deviceId: normalizeOptionalText(fields.deviceId, 200),
        submitter,
        aiResult,
      });
    } catch (storeErr) {
      await fs.promises.unlink(storedPath).catch(() => {});
      throw storeErr;
    }

    return res.status(201).json({
      success: true,
      serverBuild: SERVER_BUILD,
      submission: {
        id: submission.id,
        status: submission.status,
        createdAt: submission.createdAt,
        originalFileUrl: submission.originalFileUrl,
      },
      file: {
        originalName: media.originalName,
        storedName,
        size: media.size,
        mimeType: detectedType,
        sha256,
        url: fileUrl,
        publicPath,
      },
      message: 'submission_saved_pending_review',
    });
  } catch (err) {
    const status = err.status || 500;
    console.error('Submission save API error:', err.message || err);
    return res.status(status).json({
      success: false,
      message: err.message || 'submission_save_failed',
    });
  }
});

app.post('/api/quality-check', async (req, res) => {
  try {
    const bodyBuffer = await readLimitedBody(req);
    const { fields, files } = parseMultipartForm(req, bodyBuffer);
    const image = files.image;

    if (!image || image.size === 0) {
      return res.status(400).json({
        success: false,
        approved: false,
        decision: 'rejected',
        qualityScore: 0,
        issues: ['image_missing'],
        suggestions: ['请先上传一张现场图片，再执行 AI 内容质检。'],
        message: '缺少待检测图片。',
      });
    }

    const detectedType = detectImageType(image.buffer);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType)) {
      return res.status(415).json({
        success: false,
        approved: false,
        decision: 'rejected',
        qualityScore: 0,
        issues: ['unsupported_image_type'],
        suggestions: ['仅支持真实的 JPG、PNG、WEBP、GIF 图片。'],
        message: '图片格式不支持或文件头异常。',
      });
    }

    const signatureResult = verifySignedLocationPayload(fields);
    if (!signatureResult.ok) {
      return res.status(signatureResult.status).json({
        success: false,
        approved: false,
        decision: 'rejected',
        qualityScore: 0,
        issues: ['location_signature_failed'],
        suggestions: ['请刷新真实定位后重新提交。'],
        message: signatureResult.message,
      });
    }

    const localQuality = analyzeSubmissionQuality({ image, fields, detectedType });
    let aiQuality = null;
    let aiErrorMessage = null;

    try {
      aiQuality = await callGeminiQualityCheck({ image, fields, detectedType });
    } catch (aiError) {
      aiErrorMessage = formatGeminiError(aiError);
      console.error('Gemini AI 质检失败，已回退本地规则:', aiErrorMessage);
    }

    const quality = applyStrictQualityPolicy({ aiQuality, localQuality, aiErrorMessage });
    const sha256 = crypto.createHash('sha256').update(image.buffer).digest('hex');
    const status = quality.decision === 'rejected' ? 422 : 200;

    return res.status(status).json({
      success: quality.decision !== 'rejected',
      serverBuild: SERVER_BUILD,
      ...quality,
      file: {
        originalName: image.originalName,
        size: image.size,
        mimeType: detectedType,
        sha256,
      },
      message: quality.approved
        ? 'Gemini 内容质检通过，素材可进入公开流程。'
        : quality.decision === 'needs_review'
          ? 'AI 初筛完成，但未达到自动通过标准，已进入待人工审核。'
          : 'AI 内容质检发现明显风险，已暂缓本次提交。',
    });
  } catch (error) {
    const status = error.status || 500;
    console.error('AI 内容质检接口异常:', error.message || error);
    return res.status(status).json({
      success: false,
      approved: false,
      decision: 'rejected',
      qualityScore: 0,
      issues: ['quality_check_api_error'],
      suggestions: ['请确认本地后端服务正常运行后重试。'],
      message: error.message || 'AI 内容质检失败，请检查本地服务状态。',
    });
  }
});

app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
  try {
    const items = await readSubmissions();
    const status = normalizeOptionalText(req.query.status, 40);
    const assetType = normalizeOptionalText(req.query.assetType, 40);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    let filtered = items;

    if (status) {
      filtered = filtered.filter((item) => item.status === status);
    }

    if (assetType) {
      filtered = filtered.filter((item) => item.assetType === assetType || item.type === assetType);
    }

    return res.json({
      success: true,
      count: filtered.length,
      items: filtered.slice(0, limit),
    });
  } catch (err) {
    console.error('Admin submissions API error:', err.message || err);
    return res.status(500).json({
      success: false,
      message: err.message || 'admin_submissions_query_failed',
    });
  }
});

app.get('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const items = await readSubmissions();
    const submission = items.find((item) => String(item.id) === String(req.params.id));

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'submission_not_found',
      });
    }

    return res.json({
      success: true,
      submission,
    });
  } catch (err) {
    console.error('Admin submission detail API error:', err.message || err);
    return res.status(500).json({
      success: false,
      message: err.message || 'admin_submission_detail_failed',
    });
  }
});

app.patch('/api/admin/submissions/:id/review', requireAdmin, async (req, res) => {
  try {
    const status = normalizeOptionalText(req.body.status, 40);
    if (!REVIEW_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        message: 'invalid_review_status',
        allowedStatuses: Array.from(REVIEW_STATUSES),
      });
    }

    const reviewNote = normalizeOptionalText(req.body.reviewNote || req.body.note, 1000);
    const reviewer = normalizeOptionalText(req.body.reviewer, 120) || 'local-admin';
    const reviewedAt = new Date().toISOString();
    const submission = await updateSubmissionById(req.params.id, (item) => {
      const history = Array.isArray(item.reviewHistory) ? item.reviewHistory : [];

      return {
        ...item,
        status,
        reviewNote,
        reviewer,
        reviewedAt,
        updatedAt: reviewedAt,
        reviewHistory: [
          {
            status,
            reviewNote,
            reviewer,
            reviewedAt,
          },
          ...history,
        ],
      };
    });

    return res.json({
      success: true,
      submission,
      message: 'submission_review_updated',
    });
  } catch (err) {
    const status = err.status || 500;
    console.error('Admin submission review API error:', err.message || err);
    return res.status(status).json({
      success: false,
      message: err.message || 'submission_review_failed',
    });
  }
});

app.get('/api/submissions', async (req, res) => {
  try {
    const items = await readSubmissions();

    return res.json({
      success: true,
      count: items.length,
      items: items.slice(0, 50),
    });
  } catch (err) {
    console.error('采集记录查询接口异常:', err.message || err);
    return res.status(500).json({
      success: false,
      message: err.message || '采集记录查询失败。',
    });
  }
});

loadHubeiBoundary();

app.listen(PORT, () => {
  console.log('=================================================');
  console.log('楚韵链迹本地后端服务运行成功！');
  console.log(`服务构建标识: ${SERVER_BUILD}`);
  console.log(`Gemini API Key: ${GEMINI_API_KEY ? '已配置' : '未配置'}`);
  console.log(`监听本地端口: http://localhost:${PORT}`);
  console.log(`湖北 GeoJSON 边界已加载: ${hubeiFeatures.length} 个区域`);
  console.log(`采集记录保存文件: ${SUBMISSIONS_FILE}`);
  console.log(`地理围栏验证 API 已就绪: http://localhost:${PORT}/api/verify-location`);
  console.log(`本地图片上传 API 已就绪: http://localhost:${PORT}/api/upload-image`);
  console.log(`AI 内容质检 API 已就绪: http://localhost:${PORT}/api/quality-check`);
  console.log(`本地采集记录查询 API 已就绪: http://localhost:${PORT}/api/submissions`);
  console.log('=================================================');
});

setInterval(() => {}, 60 * 60 * 1000);
