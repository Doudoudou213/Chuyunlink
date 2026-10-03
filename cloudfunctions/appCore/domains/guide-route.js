'use strict';
const {loadPublicTheme}=require('./story-themes');
const comparisonTypes=new Set(['visually_similar_to','same_theme_as','same_type_as','located_near','co_occurs_with']);
// Route order never reverses the direction or meaning of an approved relation.
function compose(resourceIds,themes,themeId){
 const matches=themes.filter(t=>new Set(t.nodes.filter(n=>resourceIds.includes(n.resourceId)).map(n=>n.resourceId)).size>=2);
 const theme=matches.find(t=>t.id===themeId)||(!themeId?matches[0]:null);
 const transitions=resourceIds.slice(1).map((to,i)=>{const from=resourceIds[i];const base={from,to,kind:'separate',text:'下一站独立介绍，暂不建立文化联系。',relations:[]};if(!theme)return base;
 const left=theme.nodes.filter(n=>n.resourceId===from),right=theme.nodes.filter(n=>n.resourceId===to);if(!left.length||!right.length)return base;
 const ids=new Map([...left,...right].map(n=>[n.id,n]));const relations=theme.relations.filter(r=>(left.some(n=>n.id===r.from)&&right.some(n=>n.id===r.to))||(left.some(n=>n.id===r.to)&&right.some(n=>n.id===r.from))).map(r=>({...r,fromLabel:ids.get(r.from).label,toLabel:ids.get(r.to).label,comparison:comparisonTypes.has(r.type),sources:theme.sources.filter(s=>r.sourceLinkIds.includes(s.id))}));
 return {...base,kind:relations.length?'confirmed':'comparison',text:relations.length?'以下为已确认关系，箭头保留原关系方向，与行走方向无关。':'这两站同属专题，可比较观察；这不表示存在传播、传承或因果关系。',relations};});
 return {ok:true,options:matches.map(t=>({id:t.id,title:t.title})),theme:theme?{id:theme.id,version:theme.version,title:theme.title,introduction:theme.introduction}:null,transitions};
}
function createGuideRouteService({db}){return {async get(e){const ids=[...new Set(Array.isArray(e.resourceIds)?e.resourceIds:[])];if(!ids.length||ids.length>8||ids.some(id=>!/^[\w-]{1,128}$/.test(id)))throw Error('请选择有效站点');let roots;try{roots=(await db.collection('story_themes').limit(30).get()).data||[];}catch(err){if(!/not.*exist|ResourceNotFound/i.test(String(err.code)+err.message))throw err;roots=[];}const themes=[];for(const root of roots){if(root.archivedAt||!root.publishedVersionId)continue;const theme=await loadPublicTheme(db,root._id||root.id);if(theme)themes.push(theme);}return compose(ids,themes,String(e.themeId||''));}};}
module.exports={compose,createGuideRouteService};
