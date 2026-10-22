'use strict';
// A static-only sandbox for the visual study. No cloud adapter, credentials or mutable fixture.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const files=new Set(['explore-leaf-demo.html','static/exploration-leaf-demo.css','static/exploration-leaf-demo.js','static/exploration-leaf-motion.js','static/exploration-gilded-profiles.js','static/assets/gsap-3.15.0.min.js','static/assets/longcang-editorial-v1.woff2','static/assets/paper-fibres-soft-v1.webp','static/assets/exploration-motion/hhl-full-park-v2.webp']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.woff2':'font/woff2'};
async function start(port=0){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid local port');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    let name;try{name=decodeURIComponent(req.url.split('?')[0]).replace(/^\//,'');}catch{res.writeHead(404).end();return;}
    if(!name)name='explore-leaf-demo.html';
    if(!files.has(name)){res.writeHead(404).end();return;}
    try{const file=await fs.realpath(path.join(root,name));if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}const data=await fs.readFile(file);res.setHeader('Content-Type',types[path.extname(name)]);res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);}
    catch{res.writeHead(404).end();}
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((yes,no)=>server.close(e=>e?no(e):yes()))};
}
module.exports={start};
if(require.main===module)start(Number(process.argv[2])||4219).then(s=>console.log(s.url+'/explore-leaf-demo.html')).catch(e=>{console.error(e);process.exitCode=1;});
