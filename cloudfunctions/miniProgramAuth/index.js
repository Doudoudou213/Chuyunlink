'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');
const https = require('https');

function response(ok, payload = {}) {
  return Object.assign({ ok }, payload);
}

function parseBody(event) {
  if (!event) return {};
  if (event.code) return event;
  if (event.body && typeof event.body === 'object') return event.body;
  if (typeof event.body === 'string') {
    try { return JSON.parse(event.body); } catch (_) { return {}; }
  }
  return {};
}

function requiredConfig() {
  const config = {
    appId: String(process.env.WX_APPID || '').trim(),
    secret: String(process.env.WX_SECRET || '').trim(),
    envId: String(process.env.TCB_ENV || '').trim(),
    privateKeyId: String(process.env.TCB_CUSTOM_PRIVATE_KEY_ID || '').trim(),
    privateKey: String(process.env.TCB_CUSTOM_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim()
  };
  if (!config.appId || !config.secret || !config.envId || !config.privateKeyId || !config.privateKey) {
    const error = new Error('微信登录云函数尚未完成环境变量配置');
    error.code = 'AUTH_CONFIG_INCOMPLETE';
    throw error;
  }
  return config;
}

function exchangeCode(config, code) {
  const path = `/sns/jscode2session?appid=${encodeURIComponent(config.appId)}&secret=${encodeURIComponent(config.secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: 'api.weixin.qq.com', path, timeout: 8000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('微信登录响应格式不正确')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('微信登录请求超时')));
    request.on('error', reject);
  });
}

exports.main = async (event = {}) => {
  try {
    const body = parseBody(event);
    const code = String(body.code || '').trim();
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(code)) {
      return response(false, { code: 'WX_CODE_INVALID', message: '微信登录凭证无效，请重新进入小程序' });
    }
    const config = requiredConfig();
    const session = await exchangeCode(config, code);
    if (!session || session.errcode || !session.openid) {
      console.warn('[miniProgramAuth] jscode2session failed:', session && session.errcode || 'NO_OPENID');
      return response(false, { code: 'WX_SESSION_FAILED', message: '微信身份校验失败，请稍后重试' });
    }
    const customUserId = `wxmp_${crypto.createHash('sha256').update(`${config.appId}:${session.openid}`).digest('hex').slice(0, 24)}`;
    const app = cloudbase.init({
      env: config.envId,
      credentials: {
        env_id: config.envId,
        private_key_id: config.privateKeyId,
        private_key: config.privateKey
      }
    });
    const ticket = app.auth().createTicket(customUserId, { refresh: 60 * 60 * 1000 });
    return response(true, { ticket });
  } catch (error) {
    console.error('[miniProgramAuth]', error && error.code || 'OPERATION_FAILED');
    return response(false, {
      code: error && error.code || 'AUTH_OPERATION_FAILED',
      message: error && error.message || '微信登录服务暂时不可用'
    });
  }
};
