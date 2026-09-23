'use strict';
const {first,hash,hasMaterialConsent,hasResearchConsent,fileFingerprint}=require('./material-evidence');
const {redactSensitiveText}=require('./privacy');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const POLICIES={video_frames:{asset:'video',unit:'frames',limit:60,max:120,bytes:50*1024*1024},video_audio:{asset:'video',unit:'seconds',limit:1200,max:120,bytes:50*1024*1024},image_observation:{asset:'image',unit:'images',limit:20,max:1,bytes:5*1024*1024},audio_transcript:{asset:'audio',unit:'seconds',limit:1800,max:600,bytes:30*1024*1024}};
function normalizeResult(kind,result,duration) {
  if(!result||!Array.isArray(result.blocks)||!result.blocks.length||result.blocks.length>40) fail('INVALID_MATERIAL_OUTPUT','识别结果没有有效片段或片段过多');
  let previousEnd=0;
  return result.blocks.map((b,i)=>{
    const text=redactSensitiveText(String(b.text||'').trim()).text;
    if(!text||text.length>1600) fail('INVALID_MATERIAL_OUTPUT','识别片段长度不合适');
    if(kind==='audio_transcript'||kind==='video_audio') {
      const start=Number(b.startSeconds),end=Number(b.endSeconds);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<previousEnd||end<=start||end>duration) fail('INVALID_TIMECODE','转写时间段无效');
      previousEnd=end;
      return {text,locator:{type:kind==='video_audio'?'video_audio_time':'audio_time',startSeconds:start,endSeconds:end},index:i};
    }
    if(kind==='image_observation'||kind==='video_frames') {
      if(kind==='video_frames' && (!Number.isFinite(b.timeSeconds)||b.timeSeconds<0||b.timeSeconds>duration||result.blocks.length>6)) fail('INVALID_FRAME_TIME','关键帧数量或时间位置无效');
      const box=b.region;
      if(!box||!['x','y','width','height'].every(k=>Number.isFinite(box[k]))||box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>1||box.y+box.height>1) fail('INVALID_IMAGE_REGION','图片观察区域无效');
      return {text,locator:{type:kind==='video_frames'?'video_frame':'image_region',...(kind==='video_frames'?{timeSeconds:b.timeSeconds}:{}),boundingBox:{x:box.x,y:box.y,width:box.width,height:box.height}},index:i,
        uncertainty:redactSensitiveText(String(b.uncertainty||'尚需人工核对')).text.slice(0,300)};
    }
    fail('UNSUPPORTED_MATERIAL_KIND','暂不支持这种材料处理');
  });
}
const mockAdapter={simulated:true,provider:'local_mock',version:'fixed-v1',
  async process({kind,duration}){if(kind==='video_frames')return {blocks:[{text:'[模拟关键帧观察] 画面可见建筑轮廓，未识别历史身份。',timeSeconds:0,region:{x:0,y:0,width:1,height:1}}]};if(kind==='image_observation')return {blocks:[{text:'[模拟观察] 画面中有对称展开的轮廓，不确认纹样名称、年代或来源。',region:{x:0,y:0,width:1,height:1},uncertainty:'流程演示，未读取原图'}]};return {blocks:[{text:'[模拟转写] 讲述者介绍了当地修缮活动；本段仅用于流程演示。',startSeconds:0,endSeconds:Math.min(5,duration)}]};}};
function createProcessingService({db,adapters={},readAsset,config={}}) {
  async function run(event,uid) {
    const kind=event.kind,policy=POLICIES[kind];
    if(!policy) fail('UNSUPPORTED_MATERIAL_KIND','暂不支持这种材料处理');
    const submissionId=String(event.submissionId||'');
    if(!/^[\w-]+$/.test(submissionId)) fail('INVALID_ID','投稿编号无效');
    const origin=first(await db.collection('submissions').doc(submissionId).get());
    if(!hasMaterialConsent(origin)||origin.assetType!==policy.asset) fail('MATERIAL_NOT_ELIGIBLE','材料类型、审核或授权不满足要求');
    const real=event.real===true;
    if(real && (config.allowPaid!==true || !adapters[kind] || !readAsset)) fail('MATERIAL_PROVIDER_DISABLED','真实材料服务尚未配置或启用');
    const adapter=real?adapters[kind]:mockAdapter;
    if(real&&adapter.simulated!==false) fail('MATERIAL_PROVIDER_DISABLED','真实适配器配置无效');
    const fingerprint=fileFingerprint(origin), pipelineVersion=kind+'-'+adapter.version;
    const jobId='material_job_'+hash([submissionId,fingerprint,pipelineVersion,real]).slice(0,40);
    const analysisId='material_analysis_'+hash(jobId).slice(0,40),token=hash([jobId,Date.now(),Math.random()]);
    const fresh=async reader=>{
      const s=first(await reader.collection('submissions').doc(submissionId).get());
      if(!hasMaterialConsent(s)||(real&&!hasResearchConsent(s))||fileFingerprint(s)!==fingerprint) fail('MATERIAL_SOURCE_CHANGED','材料来源或授权已变化');return s;
    };
    const cached=await db.runTransaction(async tx=>{
      await fresh(tx);
      const a=first(await tx.collection('material_analyses').doc(analysisId).get());
      if(a&&a.invalidatedAt)fail('MATERIAL_NEW_VERSION_REQUIRED','此材料版本已停用，请使用新来源或新处理版本');
      if(a&&['needs_review','approved','rejected'].includes(a.status))return a;
      const ref=tx.collection('material_analysis_jobs').doc(jobId),job=first(await ref.get());
      if(job&&job.status==='processing'&&job.lockUntil>Date.now())fail('MATERIAL_JOB_BUSY','材料正在处理');
      if(job&&job.attempts>=3)fail('MATERIAL_RETRY_LIMIT','任务已达到重试上限');
      await ref.set({submissionId,kind,status:'processing',token,lockUntil:Date.now()+120000,attempts:(job&&job.attempts||0)+1,
        sourceFingerprint:fingerprint,pipelineVersion,simulated:!real,createdBy:uid,updatedAt:db.serverDate()});return null;
    });
    if(cached)return {ok:true,cached:true,analysisId,simulated:cached.simulated};
    try {
      let asset=null,duration=10;
      if(real){await fresh(db);asset=await readAsset(origin,policy);duration=policy.asset==='image'?1:Number(asset.durationSeconds);
        if(!Number.isFinite(duration)||duration<=0||duration>policy.max||!Number.isFinite(asset.size)||asset.size<=0||asset.size>policy.bytes)fail('MATERIAL_LIMIT','材料时长或大小超限');}
      await db.runTransaction(async tx=>{
        await fresh(tx);
        const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()).replaceAll('/','-');
        const ref=tx.collection('material_usage_daily').doc((real?'real_':'mock_')+kind+'_'+day);
        const row=first(await ref.get()),used=Number(row&&row.used)||0,units=policy.unit==='seconds'?Math.ceil(duration):policy.unit==='frames'?6:1;
        if(used+units>(config.budgets&&config.budgets[kind]||policy.limit))fail('MATERIAL_BUDGET_EXCEEDED','该类材料今日预算已用完');
        await ref.set({kind,unit:policy.unit,used:used+units,simulated:!real,day,updatedAt:db.serverDate()});
      });
      await fresh(db);
      let timeout;
      const result=await Promise.race([adapter.process({kind,asset,duration,beforeCall:async()=>{await fresh(db);const j=first(await db.collection('material_analysis_jobs').doc(jobId).get());if(!j||j.token!==token||j.status!=='processing'||j.invalidatedAt)fail('MATERIAL_JOB_STOPPED','材料任务已停止');}}),new Promise((_,reject)=>{
        timeout=setTimeout(()=>reject(Object.assign(new Error('材料服务处理超时'),{code:'MATERIAL_TIMEOUT'})),Math.min(60000,config.timeoutMs||30000));
      })]).finally(()=>clearTimeout(timeout));
      const blocks=normalizeResult(kind,result,duration);
      await db.runTransaction(async tx=>{
        await fresh(tx);
        const ref=tx.collection('material_analysis_jobs').doc(jobId),job=first(await ref.get());
        if(!job||job.token!==token||job.invalidatedAt)fail('MATERIAL_JOB_STOPPED','材料任务已经停止');
        await tx.collection('material_analyses').doc(analysisId).set({jobId,submissionId,sourceId:submissionId,sourceType:'submission',
          resourceId:origin.resourceId||'',kind,status:'needs_review',simulated:!real,usableForStory:false,
          durationSeconds:duration,sourceFingerprint:fingerprint,pipelineVersion,provider:adapter.provider,model:adapter.version,blocks,
          extractedText:blocks.map(b=>b.text).join('\n'),reviewedText:'',reviewVersion:0,createdAt:db.serverDate(),updatedAt:db.serverDate()});
        await ref.update({status:'completed',lockUntil:0,updatedAt:db.serverDate()});
      });
      return {ok:true,cached:false,analysisId,simulated:!real};
    }catch(e){
      await db.runTransaction(async tx=>{const ref=tx.collection('material_analysis_jobs').doc(jobId),j=first(await ref.get());
        if(j&&j.token===token)await ref.update({status:'failed',lockUntil:0,lastError:{code:e.code||'MATERIAL_PROCESSING_FAILED',message:'材料处理未完成，请检查任务状态后重试'},updatedAt:db.serverDate()});});throw e;
    }
  }
  return {run};
}
module.exports={POLICIES,normalizeResult,createProcessingService};
