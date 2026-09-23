'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fakeDb } = require('./test-story-agent-reviews');
const { loadConfig, publicConfig } = require('../cloudfunctions/storyAgentWorker/lib/config');
const { validateAgentOutput, classifyRelationRisk } = require('../cloudfunctions/storyAgentWorker/lib/contract');
const { sanitizeSubmission, selectRelevantResources, resolveEntityMatches, rankEntityMatches } = require('../cloudfunctions/storyAgentWorker/lib/retrieval');
const { inputFingerprint, jobIdFor, candidateIdFor, estimateCostYuan } = require('../cloudfunctions/storyAgentWorker/lib/job-contract');
const { createTokenHubClient } = require('../cloudfunctions/storyAgentWorker/lib/tokenhub-client');

const root = path.resolve(__dirname, '..');

function validOutput() {
  return {
    summary: '投稿文字中提到一处凤鸟纹花窗，需要与已确认资源继续比较。',
    entities: [{
      temporaryId: 'entity_1', name: '凤鸟纹', entityType: 'detail_or_motif',
      summary: '投稿文字描述的花窗凤鸟形纹样', aliases: ['凤纹']
    }],
    relations: [{
      fromTemporaryId: 'entity_1', toResourceId: 'suizhou-window-carving',
      relationType: 'documents', reason: '投稿文字直接记录了该资源中的凤鸟纹花窗',
      evidenceLinkIds: ['evidence_1'], confidence: 0.86
    }],
    missingEvidence: [{ gapType: 'visual_detail', request: '补充花窗正面近景照片', reason: '当前只有文字描述，无法比较具体轮廓' }]
  };
}

async function main() {
  const config = loadConfig({});
  assert.equal(config.enabled, false, '智能体必须默认关闭');
  assert.equal(config.shadowMode, true, '第一阶段必须默认影子模式');
  assert.equal(config.providerMaxAttempts, 2);
  assert.equal(config.codeVersion, 'story-agent-code-v3-material-evidence');
  const safeConfig = publicConfig({ ...config, apiKey: 'must-not-leak' });
  assert.equal(safeConfig.apiKeyConfigured, true);
  assert.equal(JSON.stringify(safeConfig).includes('must-not-leak'), false, '公开配置不得泄漏密钥');

  const submission = sanitizeSubmission({
    title: '随州花窗', description: '记录一处凤鸟纹花窗', assetType: 'image', regionName: '湖北随州',
    uid: 'private-user', fileID: 'cloud://private', latitude: 31.7, longitude: 113.3
  });
  assert.equal(JSON.stringify(submission).includes('private'), false, '模型输入不得包含用户、文件和精确坐标');

  const selected = selectRelevantResources({ ...submission, boundResourceId: 'bound-resource' }, [
    { _id: 'other', title: '武汉桥梁', status: 'published', summary: '桥梁建筑', region: '湖北武汉' },
    { _id: 'bound-resource', title: '随州木雕花窗', status: 'published', summary: '凤鸟纹木雕花窗', region: '湖北随州' }
  ], 2);
  assert.equal(selected[0].id, 'bound-resource', '管理员已绑定资源必须优先');

  const validated = validateAgentOutput(validOutput(), {
    allowedResourceIds: ['suizhou-window-carving'], allowedEvidenceIds: ['evidence_1']
  });
  assert.equal(validated.entities.length, 1);
  assert.equal(classifyRelationRisk(validated.relations[0]), 'medium');
  assert.equal(classifyRelationRisk({ ...validated.relations[0], relationType: 'changed_over_time' }), 'high');
  assert.equal(classifyRelationRisk({ ...validated.relations[0], evidenceLinkIds: [] }), 'insufficient');
  assert.throws(() => validateAgentOutput({ ...validOutput(), relations: [{ ...validOutput().relations[0], toResourceId: 'invented' }] }, {
    allowedResourceIds: ['suizhou-window-carving'], allowedEvidenceIds: ['evidence_1']
  }), /未提供给模型的资源/);

  const resolved = resolveEntityMatches(validated.entities, [{ _id: 'confirmed_entity', name: '凤鸟纹', aliases: [] }]);
  assert.equal(resolved[0].matchedEntityId, 'confirmed_entity');
  const knownEntities = [{ _id: 'feng', name: '凤鸟纹', aliases: ['凤纹'], entityType: 'detail_or_motif',
    resourceId: 'r1', region: { province: '湖北省', city: '随州市' } }];
  assert.equal(rankEntityMatches({ name: '凤纹', aliases: [], entityType: 'detail_or_motif' }, knownEntities,
    { resourceId: 'r1', region: { province: '湖北', city: '随州' } })[0].level, 'strong');
  assert.equal(rankEntityMatches({ name: '楚凤纹', aliases: [], entityType: 'detail_or_motif' }, knownEntities,
    { resourceId: 'r1', region: '湖北随州' })[0].level, 'review');
  assert.equal(rankEntityMatches({ name: '武汉黄鹤楼', aliases: [], entityType: 'building_or_site' },
    [{ _id: 'tower', name: '黄鹤楼', entityType: 'building_or_site', resourceId: 'tower-resource', region: '湖北武汉' }],
    { resourceId: 'tower-resource', region: '湖北省武汉市' })[0].level, 'review');
  assert.equal(rankEntityMatches({ name: '编钟', aliases: [], entityType: 'heritage_object' },
    [{ _id: 'bells', name: '曾侯乙编钟', entityType: 'heritage_object', resourceId: 'bells-resource', region: '湖北随州' }],
    { resourceId: 'bells-resource', region: '湖北随州' })[0].level, 'review', '泛称和具体文物不得直接判定相同');
  assert.equal(rankEntityMatches({ name: '凤鸟纹', aliases: [], entityType: 'heritage_object' }, knownEntities,
    { resourceId: 'r1' }).length, 0, '实体类型冲突时不得建议合并');
  assert.equal(rankEntityMatches({ name: '凤鸟纹', aliases: [], entityType: 'detail_or_motif' }, knownEntities,
    { resourceId: 'other', region: '湖南长沙' }).length, 0, '地区冲突且资源不同时不得建议合并');

  const fingerprintA = inputFingerprint(config, 'submission_1', { submission, resources: selected });
  const fingerprintB = inputFingerprint(config, 'submission_1', { resources: selected, submission });
  assert.equal(fingerprintA, fingerprintB, '输入指纹应与对象键顺序无关');
  assert.equal(jobIdFor(fingerprintA), jobIdFor(fingerprintB), '同一输入应复用任务');
  assert.equal(candidateIdFor('job', 'entity', 'entity_1'), candidateIdFor('job', 'entity', 'entity_1'));
  assert.equal(estimateCostYuan({ inputTokens: 5000, outputTokens: 1500 }, config), 0.011);

  let requestedBody = null;
  const client = createTokenHubClient({
    config: { ...config, apiKey: 'secret', enabled: true },
    transport: async (_url, _options, body) => {
      requestedBody = JSON.parse(body);
      return {
        id: 'request_1', usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
        choices: [{ message: { content: JSON.stringify(validOutput()) } }]
      };
    }
  });
  const result = await client.analyze({
    submission, allowedResources: [{ id: 'suizhou-window-carving', title: '随州木雕花窗' }],
    evidenceLinks: [{ id: 'evidence_1', resourceId: 'suizhou-window-carving', summary: '已确认投稿文字' }], knownEntities: []
  });
  assert.equal(result.usage.totalTokens, 700);
  assert.equal(requestedBody.response_format.json_schema.strict, true);

  const workerSource = fs.readFileSync(path.join(root, 'cloudfunctions/storyAgentWorker/index.js'), 'utf8');
  assert.match(workerSource, /AGENT_SHADOW_MODE_REQUIRED/);
  assert.match(workerSource, /formalGraphWrites:\s*0/);
  assert.equal(/collection\((?:ENTITIES|'story_entities')\)\.doc\([^)]*\)\.(?:set|update|remove)/.test(workerSource), false,
    '影子模式不得写入正式实体集合');
  assert.equal(/collection\(['"]story_relations['"]\).*\.(?:set|update|remove)/s.test(workerSource), false,
    '影子模式不得写入正式关系集合');

  const cloudbase = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));
  const functionConfig = cloudbase.functions.find((item) => item.name === 'storyAgentWorker');
  assert.ok(functionConfig, 'cloudbaserc 必须声明 storyAgentWorker');
  assert.equal(functionConfig.envVariables.AGENT_ENABLED, 'false');
  assert.equal(functionConfig.envVariables.AGENT_SHADOW_MODE, 'true');
  assert.equal(Object.hasOwn(functionConfig.envVariables, 'TOKENHUB_API_KEY'), false, '密钥不能进入部署配置');

  async function runWithWithdrawal(moment) {
    const consent = { status: 'approved', aiAnalysisConsent: true,
      aiConsentVersion: 'ai-analysis-consent-v1', aiConsentScope: 'approved_public_submission_text' };
    const db = fakeDb({
      submissions: {
        s1: { ...consent, title: '随州花窗', description: '记录一处具有凤鸟纹样的木雕花窗', resourceId: 'r1' },
        s2: { ...consent, title: '另一份记录', description: '有来源的花窗记录' }
      },
      resources: { r1: { status: 'published', title: '随州木雕花窗', summary: '花窗与凤鸟纹样' } },
      story_evidence_links: { ev1: { status: 'confirmed', resourceId: 'r1', submissionId: 's2', evidenceSummary: '另一份已授权的花窗记录' } }
    });
    const worker = {};
    let modelInput = null;
    if (moment === 'initial') db.data().submissions.s2.aiAnalysisConsent = false;
    const workerEnv = {
      ADMIN_UIDS: 'admin', AGENT_ENABLED: 'true', AGENT_SHADOW_MODE: 'true', TOKENHUB_API_KEY: 'test-key'
    };
    vm.runInNewContext(workerSource, {
      exports: worker, console: { error() {} }, process: { env: workerEnv },
      require(id) {
        if (id === './lib/config') return { loadConfig: () => loadConfig(workerEnv), publicConfig };
        if (id === '@cloudbase/node-sdk') return { SYMBOL_CURRENT_ENV: 'test', init: () => ({
          database: () => db, auth: () => ({ getUserInfo: () => ({ uid: 'admin' }) })
        }) };
        if (id === './lib/tokenhub-client') return { createTokenHubClient: () => ({
          async analyze(input, hooks) {
            modelInput = input;
            if (moment === 'before') db.data().submissions.s2.aiAnalysisConsent = false;
            await hooks.beforeAttempt(1);
            if (moment === 'during') db.data().submissions.s2.aiAnalysisConsent = false;
            if (moment === 'primary') {
              db.data().submissions.s1.aiAnalysisConsent = false;
              db.data().story_agent_jobs[Object.keys(db.data().story_agent_jobs)[0]].status = 'consent_revoked';
            }
            return { output: {
              summary: '候选关联仍须管理员核对',
              entities: [{ temporaryId: 'entity_1', name: '凤鸟纹', entityType: 'detail_or_motif',
                summary: '投稿文字描述的凤鸟形纹样', aliases: [] }],
              relations: [], missingEvidence: []
            }, providerAttempts: 1, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
          }
        }) };
        return require(path.join(root, 'cloudfunctions/storyAgentWorker', id));
      }
    }, { filename: 'storyAgentWorker/index.js' });
    return { response: await worker.main({ action: 'analyzeSubmission', submissionId: 's1' }), db, modelInput: () => modelInput };
  }
  const normal = await runWithWithdrawal('');
  assert.equal(normal.response.ok, true);
  assert.equal(Object.keys(normal.db.data().story_agent_candidates).length, 1);
  const initiallyRevoked = await runWithWithdrawal('initial');
  assert.equal(initiallyRevoked.response.ok, true);
  assert.equal(initiallyRevoked.modelInput().evidenceLinks.length, 0, '未授权的其他投稿不能进入模型输入');
  for (const moment of ['before', 'during', 'primary']) {
    const stopped = await runWithWithdrawal(moment);
    assert.equal(stopped.response.ok, false, `${moment}: 撤回后不得完成分析`);
    assert.equal(Object.keys(stopped.db.data().story_agent_candidates || {}).length, 0,
      `${moment}: 撤回后不得保存候选`);
    if (moment === 'primary') {
      assert.equal(Object.values(stopped.db.data().story_agent_jobs)[0].status, 'consent_revoked');
    }
  }
  console.log('Cultural research agent shadow-mode tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
