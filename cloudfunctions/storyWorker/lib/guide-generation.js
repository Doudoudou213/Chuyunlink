'use strict';
const crypto=require('node:crypto');const {prepareGuideInput}=require('./guide-generation-evidence');const {read}=require('./guide-evidence');const {validateGuideOutput}=require('./guide-contract');const {createGuideClient}=require('./guide-client');
const PROMPT_VERSION='evidence-guide-v1',CODE_VERSION='guide-agent-v1';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function createGuideGenerationService({db,config,client=createGuideClient({config}),reserveGlobal=async()=>'',recordGlobal=async()=>{}}){
 async function generate(event,reviewer){
  const mode=config.guideMode||'off';if(!['mock','real'].includes(mode)||(mode==='real'&&(!config.enabled||!config.apiKey)))fail('GUIDE_DISABLED','讲解生成尚未启用；可先预览来源并使用人工草稿');
  for(const name of ['ai_jobs','guide_fragments','guide_generation_usage'])await db.createCollection(name).catch(e=>{if(!/exist/i.test(String(e.code)+e.message))throw e;});
  const selection={storyId:event.storyId,claimIds:event.claimIds,interest:event.interest};
  const input=await prepareGuideInput(db,selection),fingerprint=hash(input),jobId='guide_'+hash([fingerprint,mode,config.textModel,PROMPT_VERSION,CODE_VERSION]).slice(0,48),fragmentId=jobId;
  const token=crypto.randomBytes(16).toString('hex');
  const acquired=await db.runTransaction(async tx=>{const ref=tx.collection('ai_jobs').doc(jobId),old=await read(tx,'ai_jobs',jobId);
   if(old?.status==='completed'){const f=await read(tx,'guide_fragments',fragmentId);if(f&&f.status!=='archived')return {cached:true};fail('GUIDE_ARCHIVED','该草稿已停止使用，请在审核工作台处理');}
   if(old?.status==='processing'&&old.lockUntil>Date.now())fail('GUIDE_BUSY','相同材料的讲解正在生成，请稍后重试');
   if((old?.attempts||0)>=2)fail('GUIDE_ATTEMPTS','已达到本材料的两次任务尝试上限，请检查失败原因');
   await ref.set({type:'guide_generation',selection,fingerprint,fragmentId,status:'processing',attempts:(old?.attempts||0)+1,token,lockUntil:Date.now()+180000,model:mode==='mock'?'local-fixed-response':config.textModel,promptVersion:PROMPT_VERSION,codeVersion:CODE_VERSION,simulated:mode==='mock',createdBy:reviewer,createdAt:old?.createdAt||db.serverDate()});return {cached:false};});
  if(acquired.cached)return {ok:true,fragmentId,cached:true,simulated:mode==='mock'};
  let dayId='';
  async function fresh(database=db){const latest=await prepareGuideInput(database,selection);if(hash(latest)!==fingerprint)fail('GUIDE_SOURCE_CHANGED','来源或故事已变化，已停止生成与保存');const job=await read(database,'ai_jobs',jobId);if(job?.token!==token||job.status!=='processing'||job.lockUntil<Date.now())fail('GUIDE_JOB_EXPIRED','任务已失效，请重新读取');return latest;}
  const hooks={beforeAttempt:async()=>{await fresh();if(mode==='mock')return;const day=new Date().toISOString().slice(0,10);await db.runTransaction(async tx=>{const ref=tx.collection('guide_generation_usage').doc(day),u=await read(tx,'guide_generation_usage',day)||{};const reserve=Buffer.byteLength(JSON.stringify(input),'utf8')+2400+Math.min(config.maxOutputTokens,1800);if((u.calls||0)>=config.guideDailyCalls||(u.reservedTokens||0)+reserve>config.guideDailyTokens)fail('GUIDE_BUDGET','讲解生成已达到独立每日预算');await ref.set({calls:(u.calls||0)+1,reservedTokens:(u.reservedTokens||0)+reserve});});dayId=await reserveGlobal(config,jobId);await fresh();},onUsage:async usage=>{if(dayId)await recordGlobal(dayId,jobId,usage);}};
  try{let result;if(mode==='mock'){await hooks.beforeAttempt();result={output:{title:'模拟：'+input.resourceTitle,sentences:input.claims.slice(0,3).map(c=>({text:'材料记录：'+c.text+'可展开来源核对。',claimIds:[c.id]})),observations:[],gaps:['本地固定响应，仅测试流程；不可正式发布。']}};}else result=await client.generate(input,hooks);
   const output=validateGuideOutput(result.output,input);
   await db.runTransaction(async tx=>{await fresh(tx);const draft={id:fragmentId,resourceId:input.resourceId,storyId:input.storyId,storyVersion:input.storyVersion,claimIds:input.claimIds,sourceFingerprint:input.sourceFingerprint,...output,interests:input.interest==='通用'?[]:[input.interest],status:'draft',revision:1,publishedVersionId:'',simulated:mode==='mock',generatedBy:'guide_agent',generation:{jobId,model:mode==='mock'?'local-fixed-response':config.textModel,promptVersion:PROMPT_VERSION,codeVersion:CODE_VERSION,interest:input.interest},createdAt:db.serverDate()};await tx.collection('guide_fragments').doc(fragmentId).set(draft);await tx.collection('ai_jobs').doc(jobId).update({status:'completed',original:output,finishedAt:db.serverDate(),lockUntil:0});});return {ok:true,fragmentId,cached:false,simulated:mode==='mock'};
  }catch(e){await db.runTransaction(async tx=>{const j=await read(tx,'ai_jobs',jobId);if(j?.token===token&&j.status==='processing')await tx.collection('ai_jobs').doc(jobId).update({status:'failed',lastError:{code:String(e.code||'GUIDE_FAILED').slice(0,80)},lockUntil:0});});throw Object.assign(new Error('讲解未保存：'+(/^(GUIDE_|AI_DAILY)/.test(e.code||'')?e.message:'模型服务暂不可用，请检查服务状态后重试')),{code:e.code||'GUIDE_FAILED'});}
 }
 return {generate};
}
module.exports={createGuideGenerationService,PROMPT_VERSION,CODE_VERSION};
