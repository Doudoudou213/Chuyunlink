'use strict';
const {createStoryAgentEvaluationService,calculateMetrics,comparisonRows}=require('./story-agent-evaluations');
function screeningSummary(samples){const active=samples.filter(s=>s.active!==false&&s.sourceValid!==false),screened=active.filter(s=>s.groundingSummary);return {screened:screened.length,legacy:active.length-screened.length,warningCount:screened.reduce((n,s)=>n+s.groundingSummary.warningCount,0),retainedCount:screened.reduce((n,s)=>n+s.groundingSummary.retainedCount,0)};}
function createGuideEvaluationService({db}){const evaluations=createStoryAgentEvaluationService({db});return {async handle(e,reviewer){
 await db.createCollection('guide_fragment_logs').catch(e=>{if(!/exist/i.test(String(e.code)+e.message))throw e;});
 const version=String(e.version||'guide-v1');if(!/^guide-[a-zA-Z0-9._-]{1,30}$/.test(version))throw Object.assign(Error('讲解评测版本以 guide- 开头，使用字母或数字'),{code:'GUIDE_EVAL_VERSION'});
 const {set}=await evaluations.createSet({version,title:'讲解反馈 '+version},reviewer);
 if(e.action==='selectGuideEvaluation')return evaluations.selectSample({setId:set.id,reviewId:e.reviewId,split:e.split,candidateType:'guide'},reviewer);
 const workspace=await evaluations.workspace({setId:set.id});const reviews=(await db.collection('guide_fragment_logs').where({action:'generation_review'}).limit(100).get()).data||[];
 return {ok:true,version,sets:workspace.sets.filter(s=>s.version.startsWith('guide-')),samples:workspace.samples,
  groups:['debug','fixed'].map(split=>({split,screening:screeningSummary(workspace.samples.filter(s=>s.split===split)),metrics:calculateMetrics(workspace.samples.filter(s=>s.split===split)),comparisons:comparisonRows(workspace.samples.filter(s=>s.split===split))})),
  reviews:reviews.map(r=>({id:r._id,fragmentId:r.fragmentId,decision:r.decision,humanRating:r.humanRating,simulated:r.simulated===true,selected:workspace.selectedReviewIds.includes(r._id)})),limitNote:'本页最多显示100条反馈和200条样本；统计仅覆盖当前评测集已收录样本。引用存在不代表历史判断正确。'};
 }};}
module.exports={createGuideEvaluationService};
