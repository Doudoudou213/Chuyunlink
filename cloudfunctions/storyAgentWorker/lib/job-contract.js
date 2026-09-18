'use strict';

const crypto = require('crypto');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = stableValue(value[key]);
      return output;
    }, {});
  }
  return value;
}

function digest(value, length = 40) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex').slice(0, length);
}

function inputFingerprint(config, submissionId, input) {
  return digest({
    provider: config.provider,
    model: config.textModel,
    promptVersion: config.promptVersion,
    submissionId,
    input
  }, 48);
}

function jobIdFor(fingerprint) {
  return `story_agent_${String(fingerprint || '').slice(0, 48)}`;
}

function candidateIdFor(jobId, candidateType, candidateKey) {
  return `agent_candidate_${digest({ jobId, candidateType, candidateKey }, 40)}`;
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(JSON.stringify(value || {}).length / 2));
}

function estimateCostYuan(usage, config) {
  const input = Math.max(0, Number(usage && usage.inputTokens) || 0);
  const output = Math.max(0, Number(usage && usage.outputTokens) || 0);
  return Number(((input * config.inputPricePerMillion + output * config.outputPricePerMillion) / 1000000).toFixed(6));
}

module.exports = { stableValue, digest, inputFingerprint, jobIdFor, candidateIdFor, estimateTokens, estimateCostYuan };
