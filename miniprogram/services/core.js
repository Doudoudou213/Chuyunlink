const { app } = require('../libs/cloudbase');
const { ensurePublicSession } = require('./auth');

async function callCore(data) {
  await ensurePublicSession();
  const response = await app.callFunction({ name: 'appCore', data });
  let result = response && response.result !== undefined ? response.result : response;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch (_) {}
  }
  if (!result || result.ok !== true) {
    const details = result && result.error || {};
    const error = new Error(details.message || '云端服务暂时不可用');
    error.code = details.code || 'CLOUD_OPERATION_FAILED';
    throw error;
  }
  return result;
}

module.exports = { callCore };
