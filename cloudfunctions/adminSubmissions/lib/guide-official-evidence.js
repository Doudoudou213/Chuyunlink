'use strict';
const {hash}=require('./guide-source-context');
const {read}=require('./guide-evidence');
const {allowedUrl}=require('./official-source-registry');
const fingerprint = f => hash([f.id,f.title,f.text,f.sentences||[],f.claimIds,f.sourceFingerprint,f.sourceContextFingerprint||'']);
const fail=()=>{throw Object.assign(Error('官方原文依据已变化，请重新检索并核对'),{code:'GUIDE_SOURCE_INVALID'});};
async function loadApproved(db,f,now=Date.now()) {
  const approval=f.officialEvidence;
  if(!approval)return {state:'unmatched',items:[]};
  const row=await read(db,'guide_official_searches',approval.searchId);
  if(!row||row.status!=='active'||row.simulated||row.fragmentId!==f.id||row.fingerprint!==fingerprint(f)||row.fingerprint!==approval.fingerprint||row.digest!==approval.digest||hash(row.items)!==row.digest||!Number.isFinite(row.validUntil)||!Array.isArray(approval.selectedIds))fail();
  if(row.validUntil<=now)return {state:'expired',items:[]};
  const items=approval.selectedIds.map(id=>row.items.find(x=>x.id===id));
  if(!items.length||items.some(x=>!x||!allowedUrl(x.url)||x.quoteHash!==hash(x.quote)||typeof x.paragraphText!=='string'||!Number.isInteger(x.quoteStart)||!Number.isInteger(x.quoteEnd)||x.quoteStart<0||x.quoteEnd<=x.quoteStart||x.paragraphText.slice(x.quoteStart,x.quoteEnd)!==x.quote))fail();
  return {state:'verified',items};
}
async function approve(db,f,review,now=Date.now()) {
  if(!review?.selectedIds?.length)return null;
  if(review.supportReviewed!==true||review.publicExcerptAllowed!==true||!Array.isArray(review.selectedIds)||review.selectedIds.length>12||typeof review.searchId!=='string')throw Object.assign(Error('请核对所选原文支持讲解，并确认这些节选允许公开'),{code:'OFFICIAL_REVIEW'});
  const row=await read(db,'guide_official_searches',review.searchId);
  const approval={searchId:review.searchId,fingerprint:fingerprint(f),digest:row?.digest,selectedIds:[...new Set(review.selectedIds)]};
  const result=await loadApproved(db,{...f,officialEvidence:approval},now);
  if(result.state!=='verified')fail();
  return approval;
}
function publicView(result,claimIds) {
  const ids=new Set(claimIds||[]),items=result.items.filter(x=>ids.has(x.claimId));
  const covered=[...ids].filter(id=>items.some(x=>x.claimId===id));
  return {state:ids.size&&covered.length===ids.size?'verified':result.state==='expired'?'expired':'unmatched',coveredClaimIds:covered,items:items.map(x=>({claimId:x.claimId,url:x.url,title:x.title,publisher:x.publisher,quote:x.quote,paragraph:x.paragraph,retrievedAt:x.retrievedAt}))};
}
module.exports={fingerprint,loadApproved,approve,publicView};
