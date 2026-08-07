'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const core = read('cloudfunctions/appCore/index.js');
const client = read('static/cloudbase-app.js');
const html = read('index.html');
const adminFunction = read('cloudfunctions/adminSubmissions/index.js');
const adminHtml = read('admin.html');
const guide = read('docs/REWARD_REDEMPTION.md');

const checks = [
  ['兑换必须使用正式账号', core.includes('requireStableAccount(userInfo);')],
  ['积分价格只从云端福利读取', core.includes('Number(reward.pointsCost)')],
  ['扣积分和扣库存位于数据库事务', core.includes("action: 'redeemReward'") && core.includes('return db.runTransaction')],
  ['库存扣减使用事务内最新值', core.includes('redeemedCount: redeemedCount + 1')],
  ['用户积分使用服务端计算结果', core.includes('points: pointsAfter')],
  ['幂等请求映射到确定兑换记录', core.includes('redemptionDocumentId(uid, clientRequestId)')],
  ['兑换码使用密码学随机数', core.includes('crypto.randomBytes(12)')],
  ['兑换会写入积分流水', core.includes('POINT_LEDGER_COLLECTION')],
  ['前端兑换请求不上传积分价格', /action:\s*'redeemReward',[\s\S]{0,180}rewardId:\s*activeReward\.id,[\s\S]{0,180}clientRequestId:/.test(client) && !/action:\s*'redeemReward',[\s\S]{0,220}pointsCost:/.test(client)],
  ['用户端展示云端兑换记录', html.includes('cloud-my-redemptions') && client.includes('renderCloudRewards')],
  ['敏感集合已记录禁止客户端读写规则', guide.includes('"read": false') && guide.includes('"write": false') && guide.includes('reward_redemption_logs')],
  ['核销查询使用兑换码哈希', /function findRedemptionByCode[\s\S]{0,500}codeHash/.test(adminFunction)],
  ['核销事务内重新读取兑换记录', /function redeemRewardCode[\s\S]{0,1600}runAdminTransaction[\s\S]{0,500}ref\.get/.test(adminFunction)],
  ['只有待使用凭证可核销', adminFunction.includes("if (status !== 'issued')") && adminFunction.includes("status: 'redeemed'")],
  ['核销写入独立日志', adminFunction.includes('REDEMPTION_LOG_COLLECTION') && adminFunction.includes("toStatus: 'redeemed'")],
  ['核销成功通知用户', adminFunction.includes("type: 'reward_redeemed'")],
  ['核销操作受管理员权限入口保护', adminFunction.includes("if (action === 'redeemRewardCode')") && adminFunction.indexOf("if (action === 'redeemRewardCode')") > adminFunction.indexOf('if (!isAdmin)')],
  ['管理端包含先查询后核销工作台', adminHtml.includes('redemption-lookup-form') && adminHtml.includes('data-redeem-code') && adminHtml.includes('redeemRewardCode')]
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
  if (!passed) failed += 1;
}

if (failed) {
  throw new Error(`兑换链路安全检查失败：${failed} 项`);
}

console.log(`Reward security validation passed (${checks.length} checks).`);
