'use strict';
const C=require('./site-walk-core');
function url(value,type){let u;try{u=new URL(value);}catch{C.fail('EXPLORATION_ASSET','请输入公开素材链接');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!u.hostname.includes('.')||/^(?:\d|\[)/.test(u.hostname)||!/\.(?:com|cn|org|net|edu|gov|io|app)$/i.test(u.hostname)||!(/\.(png|jpe?g|webp)$/i.test(u.pathname)&&type==='image'||/\.(mp3|m4a|wav|ogg)$/i.test(u.pathname)&&type==='audio'))C.fail('EXPLORATION_ASSET','只接受无私有凭证的公开 HTTPS 图片或音频地址');return u.href;}
function captions(raw,approvedText,duration){
 if(raw==null)return [];
 if(!Array.isArray(raw)||raw.length>60)C.fail('EXPLORATION_ASSET','字幕最多60条');
 return raw.map((c,i)=>{
  if(!c||typeof c.text!=='string'||!c.text.trim()||c.text.length>160||!String(approvedText||'').includes(c.text.trim())||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>duration||i>0&&c.start<raw[i-1].end)C.fail('EXPLORATION_ASSET','字幕需摘自本版已审讲解，时间不能重叠或超出音频');
  return {start:c.start,end:c.end,text:c.text.trim()};
 });
}
async function validate(db,raw,resourceId,now){
 const pointId=C.id(raw.pointId),guideVersionId=C.id(raw.guideVersionId),g=await C.guide(db,guideVersionId,resourceId);
 if(!['own','licensed','official'].includes(raw.rightsKind)||raw.publicUseConfirmed!==true||raw.rightsConfirmed!==true||C.text(raw.rightsNote,500).length<8||!C.text(raw.attribution,150))C.fail('EXPLORATION_ASSET','请核实并记录素材公开使用权、作者与出处；官网可访问不等于允许复制');
 if(!Array.isArray(raw.sourceIds)||!raw.sourceIds.length||raw.sourceIds.length>8||raw.sourceIds.some(id=>!g.sources.some(s=>s.id===id)))C.fail('EXPLORATION_ASSET','素材需绑定当前讲解中的真实来源');
 const until=Date.parse(raw.validUntil);if(!Number.isFinite(until)||until<=now||until>now+366*86400000)C.fail('EXPLORATION_ASSET','请设置一年以内的素材复核日期');
 const type=raw.type;if(!['image','audio'].includes(type))C.fail('EXPLORATION_ASSET','素材类型无效');
 const duration=type==='audio'?Number(raw.duration):0;if(type==='audio'&&(!Number.isFinite(duration)||duration<=0||duration>600))C.fail('EXPLORATION_ASSET','音频时长需在十分钟以内');
 const cues=type==='audio'?(raw.cues||[]):[];if(!Array.isArray(cues)||cues.length>12||cues.some((c,i)=>!Number.isFinite(c.at)||c.at<0||c.at>=duration||i>0&&c.at<=cues[i-1].at||!['observation','location'].includes(c.detailId)))C.fail('EXPLORATION_ASSET','音频时间点或细节编号无效');
 const lines=type==='audio'?captions(raw.captions,g.f.text,duration):[];
 return {resourceId,pointId,guideVersionId,type,url:url(raw.url,type),attribution:C.text(raw.attribution,150),rightsKind:raw.rightsKind,rightsNote:C.text(raw.rightsNote,500),publicUseConfirmed:true,rightsConfirmed:true,sourceIds:[...new Set(raw.sourceIds)],validUntil:new Date(until).toISOString(),duration,cues:cues.map(({at,detailId})=>({at,detailId})),...(lines.length?{captions:lines}:{}),status:'approved'};
}
async function resolve(db,map,points,now=Date.now()){
 const assets={};if(!map)return assets;
 for(const o of map.objects)for(const [field,type]of [['imageId','image'],['audioId','audio']])if(o[field]){
  const a=await C.read(db,'exploration_assets',C.id(o[field])),p=points.find(p=>p.id===o.pointId);
  if(!a||a.status!=='approved'||a.revokedAt||!a.publicUseConfirmed||!a.rightsConfirmed||!a.reviewedBy||a.pointId!==p.id||a.guideVersionId!==p.guideVersionId||a.type!==type||!(Date.parse(a.validUntil)>now)||!a.sourceIds?.length||a.sourceIds.some(id=>!p.sources.some(s=>s.id===id)))C.fail('WALK_SOURCE','景物素材或公开授权需要复核');
  assets[o[field]]={id:o[field],type,url:url(a.url,type),attribution:a.attribution,sourceIds:a.sourceIds,validUntil:a.validUntil,duration:a.duration,cues:a.cues,...(a.captions?.length?{captions:captions(a.captions,p.reading,a.duration)}:{})};
 }
 return assets;
}
module.exports={validate,resolve,url,captions};
