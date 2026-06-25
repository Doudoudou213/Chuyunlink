// tools/server.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const SECURE_KEY = 'ChuYunLianJi@2026_Secret';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ROOT_DIR = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const HUBEI_GEOJSON_FILE = path.join(ROOT_DIR, 'hubei_boundary.geojson');
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

let hubeiFeatures = [];
let writeQueue = Promise.resolve();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

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

<<<<<<< Updated upstream
function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function analyzeSubmissionQuality({ image, fields, detectedType }) {
  const description = (fields.description || '').trim();
  const fileName = (image.originalName || fields.fileNameHint || '').toLowerCase();
  const issues = [];
  const suggestions = [];
  let score = 88;
  let highRisk = false;

  if (image.size < 50 * 1024) {
    score -= 22;
    issues.push('image_too_small');
    suggestions.push('图片文件过小，建议上传更清晰的现场原图。');
  } else if (image.size < 200 * 1024) {
    score -= 8;
    issues.push('image_low_detail');
    suggestions.push('图片细节可能不足，建议靠近主体再拍一张。');
  }

  if (image.size > 8 * 1024 * 1024) {
    score -= 4;
    issues.push('image_large');
    suggestions.push('图片较大，后续可压缩后再进入正式存证流程。');
  }

  if (!description) {
    score -= 12;
    issues.push('description_missing');
    suggestions.push('建议补充地点、年代、来源或现场观察说明。');
  } else if (description.length < 12) {
    score -= 7;
    issues.push('description_too_short');
    suggestions.push('描述略短，可以补充采集对象和文化背景。');
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
    issues.push('possible_ad_or_contact');
    suggestions.push('描述里不要放联系方式、广告链接或无关推广信息。');
  }

  if (!fields.regionName) {
    score -= 4;
    issues.push('region_context_missing');
  }

  if (detectedType === 'image/gif') {
    score -= 6;
    issues.push('gif_lower_confidence');
    suggestions.push('GIF 动图不利于细节识别，建议补充一张静态清晰照片。');
  }

  const qualityScore = clampScore(score);
  const decision = highRisk || qualityScore < 55
    ? 'rejected'
    : qualityScore < 75
      ? 'needs_review'
      : 'approved';

  const approved = decision !== 'rejected';
  const aiAuthenticity = clampScore(highRisk ? Math.min(45, qualityScore) : 92 + Math.min(6, Math.floor((qualityScore - 75) / 4)));
  const category = description.includes('碑') || description.includes('刻')
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
  };
}

async function findHubeiRegion(longitude, latitude) {
  const client = new Client(dbConfig);
=======
function isPointInRing(longitude, latitude, ring) {
  let inside = false;
>>>>>>> Stashed changes

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
  writeQueue = writeQueue.then(async () => {
    const items = await readSubmissions();
    const lastId = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    const submission = {
      id: lastId + 1,
      originalName: record.originalName,
      storedName: record.storedName,
      filePath: record.filePath,
      fileUrl: record.fileUrl,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      sha256: record.sha256,
      longitude: Number(record.longitude).toFixed(6),
      latitude: Number(record.latitude).toFixed(6),
      locationAccuracy: record.locationAccuracy,
      regionName: record.regionName,
      regionLevel: record.regionLevel,
      description: record.description,
      deviceId: record.deviceId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    items.unshift(submission);
    await writeSubmissions(items);
    return submission;
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

<<<<<<< Updated upstream
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

    const quality = analyzeSubmissionQuality({ image, fields, detectedType });
    const sha256 = crypto.createHash('sha256').update(image.buffer).digest('hex');
    const status = quality.approved ? 200 : 422;

    return res.status(status).json({
      success: quality.approved,
      ...quality,
      file: {
        originalName: image.originalName,
        size: image.size,
        mimeType: detectedType,
        sha256,
      },
      message: quality.approved
        ? 'AI 内容质检完成，素材可进入待审核内容池。'
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
=======
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
>>>>>>> Stashed changes
    });
  }
});

<<<<<<< Updated upstream
=======
loadHubeiBoundary();

>>>>>>> Stashed changes
app.listen(PORT, () => {
  console.log('=================================================');
  console.log('楚韵链迹本地后端服务运行成功！');
  console.log(`监听本地端口: http://localhost:${PORT}`);
  console.log(`湖北 GeoJSON 边界已加载: ${hubeiFeatures.length} 个区域`);
  console.log(`采集记录保存文件: ${SUBMISSIONS_FILE}`);
  console.log(`地理围栏验证 API 已就绪: http://localhost:${PORT}/api/verify-location`);
  console.log(`本地图片上传 API 已就绪: http://localhost:${PORT}/api/upload-image`);
<<<<<<< Updated upstream
  console.log(`AI 内容质检 API 已就绪: http://localhost:${PORT}/api/quality-check`);
=======
  console.log(`本地采集记录查询 API 已就绪: http://localhost:${PORT}/api/submissions`);
>>>>>>> Stashed changes
  console.log('=================================================');
});
