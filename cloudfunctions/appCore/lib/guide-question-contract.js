'use strict';
const {fail} = require('./guide-question-evidence');
const {inspectGuide} = require('./guide-grounding');
function keys(obj, allowed) { return obj && typeof obj==='object' && !Array.isArray(obj) && Object.keys(obj).every(k=>allowed.includes(k)); }
function checkAnswer(raw,context) {
 if(!keys(raw,['outcome','sentences'])||!['answer','insufficient'].includes(raw.outcome)||!Array.isArray(raw.sentences)||raw.sentences.length>6)fail('QA_OUTPUT','回答未通过检查');
 if(raw.outcome==='insufficient'){if(raw.sentences.length)fail('QA_OUTPUT','回答未通过检查');return raw;}
 if(!raw.sentences.length)fail('QA_OUTPUT','回答为空');
 const sentences=raw.sentences.map(s=>{
  if(!keys(s,['text','pieceIds'])||typeof s.text!=='string'||!s.text.trim()||s.text.length>500||!Array.isArray(s.pieceIds)||!s.pieceIds.length||s.pieceIds.length>6||new Set(s.pieceIds).size!==s.pieceIds.length||s.pieceIds.some(id=>!context.pieces.some(p=>p.id===id)))fail('QA_OUTPUT','回答依据不匹配');
  if(/[<>]|https?:|cloud:\/\/|\b\d{11}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(s.text))fail('QA_OUTPUT','回答未通过公开检查');
  return {text:s.text.trim(),pieceIds:[...s.pieceIds]};
 });
 if(sentences.map(s=>s.text).join('').length>500)fail('QA_OUTPUT','回答过长');
 const report=inspectGuide({title:'',sentences:sentences.map(s=>({text:s.text,claimIds:s.pieceIds})),observations:[]},{resourceTitle:context.title,claims:context.pieces.map(p=>({id:p.id,text:p.text,sourceLinkIds:p.sourceIds})),sources:context.sources});
 // Live replies have no human exemption: even a warning falls back instead of passing through.
 if(report.issues.length)fail('QA_OUTPUT','回答仍有待核对之处');
 return {outcome:'answer',sentences};
}
function checkVerification(raw,answer) {
 if(!keys(raw,['answersQuestion','checks'])||raw.answersQuestion!==true||!Array.isArray(raw.checks)||raw.checks.length!==answer.sentences.length||raw.checks.some((c,i)=>!keys(c,['index','supported'])||c.index!==i||c.supported!==true))fail('QA_OUTPUT','回答依据尚不充分');
}
module.exports={checkAnswer,checkVerification};
