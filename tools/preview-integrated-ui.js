'use strict';
// Read-only local preview. Never loads the production SDK or forwards requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css',
  '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.svg':'image/svg+xml', '.geojson':'application/json', '.json':'application/json', '.mp3':'audio/mpeg' };
const pages = new Set(['index.html','admin.html','themes.html','guide.html','explore.html','explore-journey.html','explore-admin.html','explore-motion-demo.html']);
const paperPosts = `<script>
window.addEventListener('load',()=>setTimeout(()=>{
 const feed=document.getElementById('discover-share-feed');if(!feed)return;
 const samples=[
  {id:'paper-preview-photo',title:'纹样采集笔记（本地示例）',description:'仅用于查看纸纹、照片与文字的衔接，不是真实用户投稿。',assetType:'photo',thumbnailUrl:'./static/assets/community-fieldnotes-cover-v1.webp'},
  {id:'paper-preview-audio',title:'一段口述的整理（本地示例）',description:'核对文字区域的纸纤维和轻微褶皱，音频不提供播放。',assetType:'audio'}
 ];
 feed.innerHTML=samples.map(item=>renderApprovedSubmissionCard({...item,feedId:'approved-'+item.id,regionName:'荆楚',contributorName:'本地示例',completeness:100,reviewedAt:'2026-10-14',storyCard:{title:'记录眼前所见',introduction:'这里展示的是排版测试文字。淡纸纹留在文字下方，图片保持原有颜色与清晰度。',sourceCount:1}})).join('');
 window.lucide?.createIcons?.();
 feed.scrollIntoView({block:'start'});
},800));
</script>`;
const bootstrap = `<script>
window.CHULINK_LOCAL_PREVIEW=true;
window.cloudbase={init:()=>({
 auth:()=>({getLoginState:async()=>({user:{uid:'local_preview',isAnonymous:true}})}),
 getTempFileURL:async()=>({fileList:[]}),
 callFunction:async({data})=>({result:data.action==='bootstrap'
 ? {ok:true,profile:{nickname:'本地预览',points:0},stats:{total:0,pending:0},mySubmissions:[],publicSubmissions:[],myRedemptions:[],myFeedback:[],rewards:[]}
 : ['getResources','getPublicSubmissions','getNotifications','getContentEffects'].includes(data.action)
 ? {ok:true,items:[],resources:[],unreadCount:0,enabled:false}
 : {ok:false,error:{code:'LOCAL_PREVIEW_ONLY',message:'本地外观预览未连接云端，此操作不会写入生产数据'}}})
})};
window.addEventListener('DOMContentLoaded',()=>{
 const note=document.createElement('div'); note.textContent='本地整合预览 · 云端操作已隔离';
 note.style.cssText='position:fixed;right:8px;bottom:76px;z-index:99999;padding:5px 9px;background:#f3ebdd;color:#68584c;font:11px sans-serif;pointer-events:none;border-radius:3px';
 document.body.append(note);
});
</script>`;
function start(port=4214){
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; form-action 'none'; base-uri 'none'");
  if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
  let name;try{name=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1)||'index.html';}catch{return res.writeHead(400).end();}
  if(name.includes('\\')||name.split('/').some(v=>v==='..'||v==='.')||name.includes('\0'))return res.writeHead(404).end();
  const ext=path.extname(name);
  if(!pages.has(name)&&!(name.startsWith('static/')&&types[ext])&&name!=='hubei_boundary.geojson')return res.writeHead(404).end();
  const file=path.resolve(root,name);
  try{
   if(!fs.realpathSync(file).startsWith(root+path.sep))return res.writeHead(404).end();
   let body=fs.readFileSync(file);
   if(ext==='.html'){
    body=body.toString('utf8').replace(/<script\b[^>]*src=["']https?:[^"']+["'][^>]*>\s*<\/script>/gi,'').replace('<head>','<head>'+bootstrap);
    if(name==='index.html'&&new URL(req.url,'http://local').searchParams.get('sample')==='paper-posts')body=body.replace('</body>',paperPosts+'</body>');
   }
   res.setHeader('Content-Type',types[ext]||'application/octet-stream');
   res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404).end();}
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));});
}
module.exports={start};
if(require.main===module)start(Number(process.argv[2])||4214).then(s=>console.log('Isolated integrated preview: http://127.0.0.1:'+s.address().port+'/?view=profile')).catch(e=>{console.error(e.message);process.exitCode=1;});
