(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChuExplorationReadiness=factory();})(globalThis,function(){
  'use strict';
  const clean=v=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,100):'';
  const scenes=['tower','copper','baiyun','pond'];
  function project(snapshot,assets,resourceId,now=Date.now()){
    if(!snapshot?.ok||!assets?.ok||!Array.isArray(snapshot.options)||!Array.isArray(assets.items))throw Error('资料读取不完整，请重新检查。');
    const r=snapshot.root;if(r&&r.resourceId!==resourceId)throw Error('地点已变化，请重新打开导览。');
    const draft=r?.draft||snapshot.publishedDraft||{title:'',points:[]};
    if(!Array.isArray(draft.points)||draft.points.length>12)throw Error('观察点格式需要复核。');
    const objects=draft.exploration?.objects||[],edges=draft.exploration?.edges||[];
    const published=snapshot.versions?.find(v=>v.versionId===r?.publishedVersionId);
    const add=(key,label,state,note,target)=>({key,label,state,note,target});
    function assetStatus(p,o,type,option){
      const id=o?.[type==='image'?'imageId':'audioId'],label=type==='image'?'现场参照图片':'讲解录音';
      if(!id)return add(type,label,'optional',type==='image'?'尚未绑定；需核对实景与使用权，不用画稿代替现场照片。':'尚未绑定；可先提供文字阅读，不用无声文件代替录音。','asset-editor');
      const a=assets.items.find(a=>a.id===id);
      if(!a)return add(type,label,'needs','已绑定，但本次登记列表未找到；需核对，不认定素材不存在。','asset-editor');
      if(a.resourceId!==resourceId||a.pointId!==p.id||a.guideVersionId!==p.guideVersionId||a.type!==type)return add(type,label,'needs','绑定的地点、观察点、讲解版本或类型不匹配。','asset-editor');
      if(a.status!=='approved'||a.revokedAt||!a.publicUseConfirmed||!a.rightsConfirmed||!a.reviewedBy||!a.attribution||!a.rightsNote||!['own','licensed','official'].includes(a.rightsKind))return add(type,label,'needs','登记已停用或公开授权记录不完整，请重新核实。','asset-editor');
      if(!(Date.parse(a.validUntil)>now))return add(type,label,'needs','素材复核已到期，不能沿用原授权状态。','asset-editor');
      if(!option||!a.sourceIds?.length||a.sourceIds.some(id=>!option.sources?.some(s=>s.id===id)))return add(type,label,'needs','素材来源与当前可用讲解不一致。','asset-editor');
      return add(type,label,'recorded',type==='image'?'已有图片登记；是否实景、拍摄位置与公开许可仍需人工核对。':'已有音频登记；实际声音、稿件一致性与公开许可仍需人工核对。','asset-editor');
    }
    const points=draft.points.map((p,i)=>{
      const option=snapshot.options.find(o=>o.guideVersionId===p.guideVersionId&&o.observationKey===p.observationKey);
      const matches=objects.filter(o=>o.pointId===p.id),o=matches.length===1?matches[0]:null;
      const image=assetStatus(p,o,'image',option),audio=assetStatus(p,o,'audio',option);
      const a=assets.items.find(a=>a.id===o?.audioId),bound=scenes.includes(o?.artScene)&&objects.filter(x=>x.artScene===o.artScene).length===1;
      const checks=[
        add('source','讲解与出处',option?.sources?.length&&option?.text?'recorded':'needs',option?.sources?.length&&option?.text?'已匹配当前可选的已发布观察材料；不代表此次现场核对完成。':'未匹配当前可用材料，请先复核讲解和来源，不沿用旧稿。','wa-option'),
        add('access','位置与通行说明',clean(p.accessNote).length>=4?'recorded':'needs',clean(p.accessNote).length>=4?'已填写说明；站立位置、台阶、封闭情况仍须实地检查。':'缺少通行核实依据；不能从手绘图推算道路。','wa-points'),
        add('art','原画对应',matches.length!==1||o?.artScene&&!bound?'needs':bound?'recorded':'optional',matches.length!==1?'示意对象需逐点匹配。':o?.artScene&&!bound?'原画绑定未知或重复，需核对。':bound?'已选择原画对象；需人工核对画中与现场对象是否一致。':'未绑定原画；仍可提供文字，不根据名称自动匹配。','map-editor'),image,audio,
        add('captions','逐句字幕',audio.state==='recorded'&&a?.captions?.length?'recorded':'optional',audio.state==='recorded'&&a?.captions?.length?'已有字幕登记；仍需逐句试听校对，不自动判定同步正确。':'可选：有录音后再补原文字幕；无字幕时保留文字阅读。','asset-editor')
      ];
      return {id:clean(p.id),title:clean(p.title)||'未命名观察点',order:i+1,checks};
    });
    const global=[];
    if(!points.length)global.push('尚无已保存观察点；先选择当前可用的讲解材料。');
    if(r?.paused)global.push('公开导览已暂停；这份清单不会解除暂停。');
    else if(!published)global.push('尚未找到当前发布记录；清单不是发布许可。');
    else if(!(Date.parse(published.validUntil)>now))global.push('当前发布记录已到复核时间，需要重新核实。');
    else global.push('已有发布记录；公开可用性仍由服务端逐次检查，不以本清单判断。');
    if(edges.some(e=>clean(e.accessNote).length<4))global.push('画卷中有路径未填写通行依据；先补齐或去掉路径，不能猜测。');
    global.push('本次只检查已保存内容，不包括编辑框内未保存的改动。来源/素材列表最多返回100条，未匹配项目需继续核对。');
    return {schemaVersion:1,resourceId:clean(resourceId),title:clean(draft.title)||'待准备的导览',revision:r?.revision||0,
      basis:r?.draft?'已保存草稿':'最新发布版本',checkedAt:new Date(now).toISOString(),points,global,
      needs:points.reduce((n,p)=>n+p.checks.filter(c=>c.state==='needs').length,0)+edges.filter(e=>clean(e.accessNote).length<4).length+(points.length?0:1)};
  }
  function packet(report){
    const lines=['楚韵链迹 · 现场资料采集单','仅供准备，不是审核通过或现场通行证明。',report.title,'地点编号：'+report.resourceId,
      '依据：'+report.basis+' / 修订 '+report.revision,'检查时间：'+report.checkedAt,'',...report.global.map(x=>'提醒：'+x),''];
    for(const p of report.points){lines.push('【'+p.order+' · '+p.title+'】',...p.checks.map(c=>c.label+'：'+c.note),
      '现场名称/展牌核对：________________','可安全站立观察的位置及参照物：________________',
      '入口至此处/下一处的实际通行路径：________________','台阶、绕行、休息点及封闭条件（不确定写待核）：________________',
      '现场照片编号、拍摄日期、公开许可凭据编号：________________','讲解应补充或纠正的事实及来源编号：________________',
      '录音与字幕校对结果、授权凭据编号：________________','核对人（内部填写）、时间及再次复核日期：________________','');}
    lines.push('回填顺序：核对讲解与来源 → 登记有公开许可的素材 → 保存草稿 → 预览 → 人工现场核对 → 原发布流程。',
      '本单不含来源正文、媒体地址、账号身份和内部授权说明。填写后可能含内部信息，分享前请检查；不会自动上传或导入审核结果。');
    return '\ufeff'+lines.join('\n');
  }
  return {project,packet};
});
