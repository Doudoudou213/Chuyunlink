'use strict';
const keywords={建筑:['建筑','楼阁','重建','屋顶','结构','立柱','石阶'],碑刻:['碑','石刻','铭文','题刻','文字'],地方故事:['传说','口述','故事','讲述','相传']};
function contentPlan(claims,interest){
 const words=keywords[interest]||[];
 const preferred=claims.filter(c=>words.some(w=>c.text.includes(w))).map(c=>c.id);
 const fallback=interest!=='通用'&&!preferred.length;
 return {requestedInterest:interest,effectiveInterest:fallback?'通用':interest,
  preferredClaimIds:preferred,availableClaimIds:claims.map(c=>c.id),
  note:fallback?'当前已选材料不足以支撑这一兴趣，采用通用重点，不编造差异。':'优先编排与兴趣相关的已有事实；不改变事实本身。',
  lengthNote:'20至500字；材料少可短于一分钟，不为凑长度重复或新增事实。完全不足时返回 insufficient。',
  fixedReadingAdvice:'可以展开来源查看已有材料。'
 };
}
function contentQuality(output,input){
 const used=[...new Set(output.sentences.flatMap(s=>s.claimIds))];
 return {usedClaimIds:used,unusedClaimIds:input.claims.filter(c=>!used.includes(c.id)).map(c=>c.id),
  charCount:[...output.text].length,estimatedReadingSeconds:Math.ceil([...output.text].length/3),
  durationNote:'按每秒约3字估算；未经过真实朗读验收。',
  effectiveInterest:input.contentPlan?.effectiveInterest||input.interest||'通用',
  interestNote:input.contentPlan?.note||'',
  note:'覆盖量仅表示引用了几项材料，不代表内容正确，也不要求把所有事实塞进讲解。'};
}
module.exports={contentPlan,contentQuality};
