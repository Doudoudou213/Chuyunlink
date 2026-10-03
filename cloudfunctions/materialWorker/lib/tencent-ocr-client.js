'use strict';

const { redactSensitiveText, textHash } = require('./privacy');

function cleanText(value, maxLength = 5000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function boundingBox(item) {
  const polygon = Array.isArray(item && item.Polygon) ? item.Polygon : [];
  if (polygon.length) {
    return polygon.slice(0, 8).map((point) => ({
      x: Number(point && point.X) || 0,
      y: Number(point && point.Y) || 0
    }));
  }
  const box = item && item.ItemPolygon;
  if (!box) return null;
  return {
    x: Number(box.X) || 0,
    y: Number(box.Y) || 0,
    width: Number(box.Width) || 0,
    height: Number(box.Height) || 0
  };
}

function buildExtraction(response) {
  const detections = Array.isArray(response && response.TextDetections)
    ? response.TextDetections.slice(0, 500)
    : [];
  const rawLines = detections
    .map((item) => cleanText(item && item.DetectedText, 1000))
    .filter(Boolean);
  const rawText = rawLines.join('\n').slice(0, 20000);
  const redacted = redactSensitiveText(rawText);
  const redactedLines = redacted.text.split('\n');
  const confidences = detections.map((item) => cleanConfidence(item && item.Confidence)).filter((value) => value != null);
  const averageConfidence = confidences.length
    ? confidences.reduce((total, value) => total + value, 0) / confidences.length
    : null;
  const qualityFlags = [];
  if (!rawLines.length) qualityFlags.push('no_text_detected');
  if (averageConfidence != null && averageConfidence < 0.72) qualityFlags.push('low_average_confidence');
  return {
    kind: 'image_ocr',
    provider: 'tencent_ocr',
    model: 'GeneralBasicOCR-2018-11-19',
    simulated: false,
    extractedText: redacted.text.slice(0, 5000),
    rawTextHash: textHash(rawText),
    blocks: detections.map((item, index) => ({
      index,
      text: cleanText(redactedLines[index], 1000),
      confidence: cleanConfidence(item && item.Confidence),
      boundingBox: boundingBox(item)
    })),
    quality: {
      score: averageConfidence == null ? 0 : Number(averageConfidence.toFixed(4)),
      flags: qualityFlags,
      detectedLineCount: rawLines.length
    },
    privacy: {
      requiresHumanReview: true,
      redacted: redacted.redacted,
      flags: redacted.flags,
      counts: redacted.counts
    },
    requestId: cleanText(response && response.RequestId, 128)
  };
}

function retryableError(error) {
  const code = String(error && (error.code || error.Code) || '');
  const message = String(error && error.message || '');
  return /RequestLimitExceeded|InternalError|ServiceUnavailable|ResourceUnavailable|FailedOperation|Timeout|Network/i.test(`${code} ${message}`);
}

function safeProviderError(error) {
  const code = cleanText(error && (error.code || error.Code) || 'TENCENT_OCR_FAILED', 100);
  const message = cleanText(error && error.message || '腾讯云 OCR 调用失败', 500)
    .replace(/(?:secret(?:id|key)?|credential)[=:]\s*[^\s,;]+/gi, '[凭证字段已隐藏]');
  return Object.assign(new Error(message), {
    code: code.startsWith('TENCENT_OCR_') ? code : `TENCENT_OCR_${code}`,
    retryable: retryableError(error)
  });
}

function defaultTransport(config) {
  let sdk;
  try {
    sdk = require('tencentcloud-sdk-nodejs-ocr');
  } catch (error) {
    throw Object.assign(new Error('materialWorker 缺少腾讯云 OCR SDK 依赖'), { code: 'TENCENT_OCR_SDK_MISSING' });
  }
  const OcrClient = sdk.ocr.v20181119.Client;
  const client = new OcrClient({
    credential: {
      secretId: config.secretId,
      secretKey: config.secretKey
    },
    region: config.region,
    profile: {
      signMethod: 'TC3-HMAC-SHA256',
      httpProfile: {
        reqMethod: 'POST',
        reqTimeout: config.requestTimeoutSeconds,
        endpoint: 'ocr.tencentcloudapi.com'
      }
    }
  });
  return (params) => client.GeneralBasicOCR(params);
}

function createTencentOcrClient({ config, transport }) {
  if (!config || !config.secretId || !config.secretKey) {
    throw Object.assign(new Error('尚未配置腾讯云 OCR 专用密钥'), { code: 'TENCENT_OCR_CREDENTIALS_MISSING' });
  }
  const request = transport || defaultTransport(config);
  return {
    async recognizeImage(imageUrl, options = {}) {
      const url = cleanText(imageUrl, 2000);
      if (!/^https:\/\//i.test(url)) {
        throw Object.assign(new Error('OCR 只接受 HTTPS 短时图片地址'), { code: 'INVALID_OCR_IMAGE_URL' });
      }
      let lastError;
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        try {
          if (typeof options.beforeAttempt === 'function') {
            await options.beforeAttempt(attempt);
          }
          const response = await request({
            ImageUrl: url,
            LanguageType: config.languageType,
            IsWords: false
          });
          return { extraction: buildExtraction(response), providerAttempts: attempt };
        } catch (error) {
          lastError = safeProviderError(error);
          if (!lastError.retryable || attempt >= config.maxAttempts) break;
        }
      }
      throw lastError;
    }
  };
}

module.exports = {
  buildExtraction,
  safeProviderError,
  createTencentOcrClient
};
