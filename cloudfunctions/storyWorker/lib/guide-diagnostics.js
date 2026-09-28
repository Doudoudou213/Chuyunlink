'use strict';
function diagnosis(code){
 const c=String(code||'GUIDE_FAILED');
 const rules=[
 [/^(ENOTFOUND|EAI_AGAIN)$/,'network','无法找到模型服务地址','检查接口域名和云函数网络；换模型名称通常不能解决。',true],
 [/TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|AI_PROVIDER_NETWORK/,'network','模型连接超时或中断','核对服务状态与网络，费用可能已产生；先查看预算，再决定重试。',true],
 [/CERT|TLS|EPROTO/,'network','安全连接失败','检查服务地址与证书，不要关闭证书校验。',false],
 [/HTTP_401|HTTP_403/,'credential','接口未授权','检查服务端密钥、模型权限及服务地区，不要把密钥发到聊天或填写在网页。',false],
 [/HTTP_429/,'capacity','接口额度或并发受限','检查供应商余额与限流，稍后再试。',true],
 [/HTTP_5\d\d/,'provider','模型服务暂时异常','稍后重试；持续失败再评估更换供应商。',true],
 [/HTTP_400|HTTP_404|ADAPTER_CONFIG/,'adapter','接口或参数不匹配','核对地址、模型名称、结构化输出和输出长度参数。',false],
 [/PRICE|MONEY|BUDGET|AI_DAILY|TRIAL_CONFIG/,'budget','费用条件未满足','检查人民币单价与本轮累计预留；不通过重置试跑编号绕过5元上限。',false],
 [/DISABLED|KEY_NOT/,'configuration','真实调用尚未就绪','检查讲解独立开关、密钥与模型配置；不会自动开启。',false],
 [/SOURCE|CONSENT|SELECTION|INPUT|PRIVACY/,'evidence','来源条件未满足','核对已发布故事、已确认事实、有效授权和来源；资料不足先补充。',false],
 [/BUSY/,'running','已有相同任务运行中','刷新试跑记录，避免连续重复点击。',false],
 [/ATTEMPTS|ARCHIVED/,'stopped','该任务已停止重试','查看失败记录或归档原因，处理后由管理员重新安排。',false],
 [/INVALID_JSON|EMPTY_OUTPUT|CITATION|CLAIM|GUIDE_OUTPUT|GUIDE_TEXT|GUIDE_LENGTH|GUIDE_SCOPE|GUIDE_OBSERV/,'output','模型输出未通过检查','核对输出格式和引用；不降低事实与来源要求。',false]
 ];
 const match=rules.find(r=>r[0].test(c));const r=match||[null,'unknown','任务未完成','查看任务阶段并检查配置；保留原内容，不反复盲目重试。',false];
 return {code:match?c.slice(0,80):'GUIDE_FAILED',category:r[1],message:r[2],nextStep:r[3],retryable:r[4]};
}
module.exports={diagnosis};
