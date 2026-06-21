// tools/server.js
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const SECURE_KEY = 'ChuYunLianJi@2026_Secret';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

const dbConfig = {
  host: 'localhost',
  user: 'postgres',
  password: '123456',
  database: 'chuyun_db',
  port: 5432,
};

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

async function findHubeiRegion(longitude, latitude) {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    const queryText = `
      SELECT name, level
      FROM hubei_regions
      WHERE ST_Contains(geom, ST_SetSRID(ST_Point($1, $2), 4326))
      LIMIT 1;
    `;
    const dbResult = await client.query(queryText, [longitude, latitude]);
    return dbResult.rows[0] || null;
  } finally {
    await client.end();
  }
}

app.post('/api/verify-location', async (req, res) => {
  const { longitude, latitude, timestamp, deviceId, signature } = req.body;
  const signatureResult = verifySignedLocationPayload({ longitude, latitude, timestamp, deviceId, signature });

  if (!signatureResult.ok) {
    return res.status(signatureResult.status).json({
      success: false,
      message: signatureResult.message,
    });
  }

  try {
    const region = await findHubeiRegion(longitude, latitude);

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
  } catch (err) {
    console.error('数据库查询出错:', err.message);
    return res.status(500).json({
      success: false,
      message: `数据库异常: ${err.message}`,
    });
  }
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

    const region = await findHubeiRegion(fields.longitude, fields.latitude);
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
    const sha256 = crypto.createHash('sha256').update(image.buffer).digest('hex');

    await fs.promises.writeFile(storedPath, image.buffer);

    return res.json({
      success: true,
      regionName: region.name,
      regionLevel: region.level,
      file: {
        originalName: image.originalName,
        storedName,
        size: image.size,
        mimeType: detectedType,
        sha256,
        url: `http://localhost:${PORT}/uploads/${storedName}`,
      },
      message: `图片上传成功，已通过 ${region.name} 地理围栏校验。`,
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

app.listen(PORT, () => {
  console.log('=================================================');
  console.log('楚韵链迹本地后端安全服务器运行成功！');
  console.log(`监听本地端口: http://localhost:${PORT}`);
  console.log(`地理围栏验证 API 已就绪: http://localhost:${PORT}/api/verify-location`);
  console.log(`本地图片上传 API 已就绪: http://localhost:${PORT}/api/upload-image`);
  console.log('=================================================');
});
