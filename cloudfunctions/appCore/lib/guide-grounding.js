'use strict';
// Deterministic risk screening, not a semantic entailment or historical truth score.
const {hash}=require('./guide-source-context');
const RULE_VERSION='guide-grounding-v1';
const labels={
 EYEWITNESS:'讲解者冒认现场经历', DATE_CONFLICT:'年代与所引事实中的事件不符',
 LOCATOR:'现场方位没有对应依据', NUMBER:'数字、单位或事件对应需要核对',
 QUALIFIER:'原材料的限定可能被省略', ATTRIBUTION:'请保留观察者或讲述者归属',
 CAUSAL:'可能新增因果、传播或传承关系', SUPERLATIVE:'可能新增最早、唯一等判断',
 OVERHEDGE:'给已有记载额外增加了存疑说法', IMAGE_INFERENCE:'画面描述不能单独支持年代或真伪',
 SUPPORT:'部分表述与所引材料差异较大，请核对是否有新增判断'
};
function checkedText(text,evidence){
 // Exempt attributed verbatim quotations only. Unattributed quote marks cannot bypass checks.
 let s=String(text||'').replace(/(投稿者|讲述者|作者|资料|材料)[^。！？“「]{0,12}(?:说|写道|记载|记录|提到)[：:]?[“「]([^”」]+)[”」]/g,(all,who,quote)=>evidence.includes(quote)?'【已核对引语】':all);
 // A narrow negative example, not a blanket sentence-level exemption.
 s=s.replace(/(?:不能|不可|不得|并非|不应)(?:声称|说成|称为)?[“「]?(?:我|我们)(?:在)?(?:现场|亲眼)[^，。；！？”」]{0,18}[”」]?/g,'【否定示例】');
 return s;
}
function eventDates(text){const result=[];for(const clause of text.split(/[，。；！？]/)){for(const event of ['始建','重建','出土','开放']){const re=new RegExp('(?:'+event+'(?:年代)?(?:于|是|为)?(?:公元)?(\\d{3,4})年|(\\d{3,4})年(?:[^，。；！？]{0,4})'+event+')','g');for(const m of clause.matchAll(re))result.push({event,year:m[1]||m[2]});}}return result;}
function inspectGuide(output,input){
 const issues=[],claims=input.claims||[],sources=input.sources||[];
 const allIds=claims.map(c=>c.id);
 const units=[{path:'title',text:output.title,claimIds:allIds},...(output.sentences||[]).map((s,i)=>({...s,path:'sentences.'+i})),...(output.observations||[]).map((s,i)=>({...s,path:'observations.'+i}))];
 for(const unit of units){
  const selected=claims.filter(c=>(unit.claimIds||[]).includes(c.id));
  const links=new Set(selected.flatMap(c=>c.sourceLinkIds||[]));
  const refs=sources.filter(s=>links.has(s.id));
  const evidence=[...selected.map(c=>c.text),...refs.map(s=>s.excerpt)].join('；');
  const raw=String(unit.text||''),t=checkedText(raw,evidence);
  const add=(code,severity='warning')=>{if(!issues.some(i=>i.path===unit.path&&i.code===code))issues.push({id:hash([RULE_VERSION,unit.path,raw,unit.claimIds,code]).slice(0,20),path:unit.path,code,severity,message:labels[code],text:raw,claimIds:unit.claimIds||[],sourceIds:refs.map(s=>s.id)});};
  if(/(?:我|我们)(?:在)?现场[^，。；！？]{0,12}(?:观察到|看到|看见|核对|核实|验证)|(?:我|我们)(?:曾|已经|刚刚)?亲眼(?:看见|看到|见到)|(?:我们|我)未(?:在)?现场[^，。；！？]{0,8}(?:核对|验证|核实)/.test(t))add('EYEWITNESS','blocker');
  const loc=t.match(/(?:左边|右边|左侧|右侧|前方|身后)第[一二三四五六七八九十\d]+(?:块|座|根|个)[^，。；！？]{0,3}/g)||[];
  if(loc.some(x=>!evidence.includes(x)))add('LOCATOR','blocker');
  // Only exact event/year contradictions are definitive; other numeric differences remain review warnings.
  const expected=eventDates(selected.map(c=>c.text).join('；'));
  for(const d of eventDates(t)){const values=[...new Set(expected.filter(x=>x.event===d.event).map(x=>x.year))];if(values.length===1&&values[0]!==d.year&&!/约|可能|相传|据说/.test(t+selected.map(c=>c.text).join(''))){const subject=String(input.resourceTitle||'');const bound=subject&&t.includes(subject+d.event)&&selected.some(c=>c.text.includes(subject+d.event));add(bound?'DATE_CONFLICT':'NUMBER',bound?'blocker':'warning');}}
  for(const n of t.match(/\d+(?:\.\d+)?(?:年|件|组|座|米|公里|层|个|吨)/g)||[])if(!evidence.includes(n))add('NUMBER');
  const qualifiers=[...new Set([...refs.flatMap(s=>s.context?.qualifiers||[]),...selected.flatMap(c=>c.text.match(/可能|相传|据说|大约|约有|推测|尚待考证/g)||[])])];
  if(qualifiers.some(q=>!t.includes(q))&&unit.path!=='title')add('QUALIFIER');
  if(refs.length&&refs.every(s=>['oral','audio_transcript','observation'].includes(s.context?.kind))&&!/投稿者|讲述者|口述|据.*(?:说|记载|记录)|材料(?:中|记录|显示)|录音|相传|已核对引语/.test(t)&&unit.path!=='title')add('ATTRIBUTION');
  for(const word of ['传承','源于','导致','因此形成','传播至','唯一','最早','第一座','首创'])if(t.includes(word)&&!evidence.includes(word))add(['唯一','最早','第一座','首创'].includes(word)?'SUPERLATIVE':'CAUSAL');
  if(refs.some(s=>s.context?.kind==='official')&&/尚不确定|尚未.*核实|未能.*验证|据称/.test(t)&&!/尚不确定|尚未.*核实|未能.*验证|据称/.test(evidence))add('OVERHEDGE');
  if(refs.length&&refs.every(s=>s.context?.kind==='image_observation')&&/始建|年代|真迹|赝品|建于|朝代/.test(t))add('IMAGE_INFERENCE');
  for(let clause of t.split(/[，。；！？]/)){
   clause=clause.replace(/【已核对引语】|【否定示例】/g,'').trim();
   if(/^(?:可|可以|请)?(?:展开来源(?:查看原始材料|阅读原始记录|仔细阅读原始记录|阅读记录|核对|查看)|通过来源了解其记录内容)$/.test(clause))continue;
   if(clause.length<8||evidence.includes(clause))continue;
   const chars=clause.match(/[\u4e00-\u9fff]/g)||[];let matches=0;
   for(let i=0;i<chars.length-1;i++)if(evidence.includes(chars[i]+chars[i+1]))matches++;
   if(chars.length>=8&&matches/Math.max(1,chars.length-1)<(unit.path==='title'?0.35:0.22))add('SUPPORT');
  }
 }
 const fingerprint=hash([RULE_VERSION,output.title,output.sentences,output.observations,output.gaps,input.sourceFingerprint,input.sourceContextFingerprint,claims.map(c=>({id:c.id,text:c.text,sourceLinkIds:c.sourceLinkIds})),sources.map(s=>({id:s.id,excerpt:s.excerpt,context:s.context}))]);
 return {ruleVersion:RULE_VERSION,fingerprint,status:issues.some(i=>i.severity==='blocker')?'blocked':issues.length?'needs_review':'screened',issues,note:'规则未发现问题不代表事实已经正确，仍需人工审核。'};
}
function assertNoBlockers(report){if(report.status==='blocked')throw Object.assign(Error('讲解存在明确越界，已停止保存或发布，请查看逐句问题'),{code:'GUIDE_GROUNDING_BLOCKED',grounding:report});}
function assertPublishable(report,resolution){assertNoBlockers(report);const warnings=report.issues.filter(i=>i.severity==='warning');if(!warnings.length)return;if(resolution?.fingerprint!==report.fingerprint||warnings.some(i=>typeof resolution.reasons?.[i.id]!=='string'||resolution.reasons[i.id].trim().length<8||resolution.reasons[i.id].length>500))throw Object.assign(Error('仍有待核对句子：请修改后保存，或逐项填写至少8字的保留理由'),{code:'GUIDE_GROUNDING_REVIEW'});require('./guide-contract').checkGuidePrivacy(resolution.reasons);}
function publishedGuideValid(fragment,checked){
 if(fragment.sentences&&fragment.text!==fragment.sentences.map(s=>s.text).join(''))return false;
 if(!fragment.grounding)return true; // Historical human-reviewed versions are not silently migrated.
 if(fragment.grounding.ruleVersion!==RULE_VERSION)return false;
 const output={title:fragment.title,sentences:fragment.sentences||[{text:fragment.text,claimIds:fragment.claimIds}],observations:(fragment.observations||[]).map(o=>({...o,claimIds:o.claimIds||fragment.claimIds})),gaps:fragment.gaps||[]};
 const input={resourceTitle:checked.resource.title,sourceFingerprint:checked.fingerprint,sourceContextFingerprint:checked.contextFingerprint,claims:checked.claims.map(c=>({id:c.id,text:c.claimText,sourceLinkIds:c.sourceLinkIds})),sources:checked.sources.map(s=>({id:s.id,excerpt:s.link.evidenceSummary,context:require('./guide-source-context').contextFor(s.link)}))};
 const report=inspectGuide(output,input);
 if(report.fingerprint!==fragment.grounding.fingerprint)return false;
 try{assertPublishable(report,fragment.groundingResolution);return true;}catch(e){if(/^GUIDE_(GROUNDING|OUTPUT)/.test(e.code||''))return false;throw e;}
}
module.exports={publishedGuideValid,RULE_VERSION,inspectGuide,assertNoBlockers,assertPublishable};
