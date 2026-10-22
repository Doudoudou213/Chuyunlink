/* Deterministic excerpts from the current local editorial response.
 * No question generation, network request, storage, or publication fallback. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ChuJourneyInquiryData=factory();
})(globalThis,function(){
  'use strict';
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const text=(value,max,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||!!value.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const id=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
  const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const unique=values=>new Set(values).size===values.length;
  function url(value){
    if(!text(value,2048)||/[\s\\]/.test(value))return null;
    try{const parsed=new URL(value);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password?parsed.href:null;}catch{return null;}
  }
  function source(raw,clean){
    if(!object(raw)||!object(clean)||!text(raw.title,240)||!text(raw.excerpt||'',3000,true)||
      !text(raw.contributorName||'',512,true)||!url(raw.url))return null;
    const projected={title:raw.title,excerpt:raw.excerpt||'',credit:raw.contributorName||'',url:url(raw.url)};
    return Object.keys(projected).every(key=>clean[key]===projected[key])?Object.freeze(projected):null;
  }
  function project(raw,data){
    try{
      const cap=raw?.editorialInquiries;
      if(raw?.ok!==true||raw.available!==true||raw.localTest!==true||raw.walk?.simulated!==true||data?.localTest!==true||
        !keys(cap,['schemaVersion','mode','publishAllowed','resourceId','fingerprint','revision','points'])||
        cap.schemaVersion!==1||cap.mode!=='editorial-excerpts'||cap.publishAllowed!==false||
        !id(cap.resourceId)||cap.resourceId!==raw.walk.resourceId||cap.resourceId!==data.resourceId||
        !text(cap.fingerprint,128)||cap.fingerprint!==raw.walk.fingerprint||cap.fingerprint!==data.fingerprint||
        typeof cap.revision!=='string'||!/^[a-f0-9]{64}$/.test(cap.revision)||!Array.isArray(cap.points)||!cap.points.length||cap.points.length>4||
        JSON.stringify(cap).length>16384||!Array.isArray(raw.walk.points)||!Array.isArray(data.points)||
        !unique(cap.points.map(point=>point?.pointId))||
        !unique(raw.walk.points.map(point=>point?.id))||!unique(data.points.map(point=>point?.id)))return null;
      const questionCounts=new Map();
      for(const point of cap.points)for(const question of Array.isArray(point?.questions)?point.questions:[]){
        questionCounts.set(question?.id,(questionCounts.get(question?.id)||0)+1);
      }
      const result={};
      for(const entry of cap.points){
        if(!keys(entry,['pointId','questions'])||!id(entry.pointId)||!Array.isArray(entry.questions)||entry.questions.length!==2)continue;
        const original=raw.walk.points.find(point=>point.id===entry.pointId),clean=data.points.find(point=>point.id===entry.pointId);
        if(!original||!clean||!text(original.reading,16000)||original.reading!==clean.reading||
          !Array.isArray(original.sources)||!original.sources.length||original.sources.length>8||
          !Array.isArray(clean.sources)||clean.sources.length!==original.sources.length)continue;
        const paragraphs=original.reading.split('\n\n');
        if(paragraphs.length>16||paragraphs.some(paragraph=>!text(paragraph,4000)))continue;
        const questions=[],labels=new Set();
        let valid=true;
        for(const question of entry.questions){
          if(!keys(question,['id','label','paragraphs'])||!id(question.id)||questionCounts.get(question.id)!==1||
            !text(question.label,80)||/[<>\u0000-\u001f\u007f]/.test(question.label)||labels.has(question.label)||
            !Array.isArray(question.paragraphs)||!question.paragraphs.length||question.paragraphs.length>2||
            !unique(question.paragraphs.map(paragraph=>paragraph?.index))){valid=false;break;}
          labels.add(question.label);
          const excerpts=[],citations=new Map();
          for(const selection of question.paragraphs){
            if(!keys(selection,['index','sourceIndexes'])||!Number.isInteger(selection.index)||selection.index<0||selection.index>=paragraphs.length||
              !Array.isArray(selection.sourceIndexes)||!selection.sourceIndexes.length||selection.sourceIndexes.length>8||!unique(selection.sourceIndexes)){
              valid=false;break;
            }
            for(const index of selection.sourceIndexes){
              if(!Number.isInteger(index)||index<0||index>=original.sources.length){valid=false;break;}
              const citation=source(original.sources[index],clean.sources[index]);
              if(!citation){valid=false;break;}
              citations.set(index,citation);
            }
            if(!valid)break;
            excerpts.push(paragraphs[selection.index]);
          }
          if(!valid)break;
          questions.push(Object.freeze({id:question.id,label:question.label,paragraphs:Object.freeze(excerpts),sources:Object.freeze([...citations.values()])}));
        }
        // A malformed question removes the whole scene, never just the broken citation.
        if(valid&&questions.length===2&&!own(result,entry.pointId))result[entry.pointId]=Object.freeze(questions);
      }
      return Object.keys(result).length?Object.freeze(result):null;
    }catch{return null;}
  }
  function revision(raw,data){
    const projected=project(raw,data);
    // Also bind the projected text and sources: a stale claimed revision must not
    // keep an earlier answer alive after the latest response changes.
    return projected?JSON.stringify([raw.editorialInquiries.revision,projected]):null;
  }
  return {project,revision};
});
