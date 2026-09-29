'use strict';
const https = require('node:https'), dns = require('node:dns').promises;
const { allowedUrl, HOSTS } = require('./official-source-registry');
const { hash } = require('./guide-source-context');
const fail = code => { throw Object.assign(Error('官网原文暂时无法核对'), { code }); };
function publicIPv4(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const a = ip.split('.').map(Number);
  return a.every(x => x <= 255) && a[0] > 0 && a[0] < 224 && ![10,127].includes(a[0]) && !(a[0]===100&&a[1]>=64&&a[1]<=127) && !(a[0]===169&&a[1]===254) && !(a[0]===172&&a[1]>=16&&a[1]<=31) && !(a[0]===192&&[0,168].includes(a[1])) && !(a[0]===198&&[18,19,51].includes(a[1])) && !(a[0]===203&&a[1]===0&&a[2]===113);
}
async function fetchOfficial(url, redirects = 0) {
  if (!allowedUrl(url) || redirects > 2) fail('OFFICIAL_URL');
  const u = new URL(url);
  const addresses = await Promise.race([dns.resolve4(u.hostname),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Object.assign(Error('DNS timeout'),{code:'OFFICIAL_TIMEOUT'})),3000);timer.unref();})]);
  if (!addresses.length || addresses.some(ip => !publicIPv4(ip))) fail('OFFICIAL_ADDRESS');
  const response = await new Promise((resolve, reject) => {
    const req = https.get(u, { headers: {Accept:'text/html,application/xhtml+xml,text/plain','Accept-Encoding':'identity','User-Agent':'ChuLink-Evidence/1.0'}, lookup: (host,opts,cb) => opts.all ? cb(null,[{address:addresses[0],family:4}]) : cb(null,addresses[0],4) }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {res.resume();clearTimeout(timer);try{if(!res.headers.location)throw Error('No location');const next=new URL(res.headers.location,u).href;if(!allowedUrl(next))throw Error('Unapproved redirect');resolve({redirect:next});}catch{reject(Object.assign(Error('Invalid redirect'),{code:'OFFICIAL_URL'}));}return;}
      if (res.statusCode!==200 || !/^(text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(res.headers['content-type']||'') || (res.headers['content-encoding'] && res.headers['content-encoding']!=='identity')) {res.resume();clearTimeout(timer);reject(Object.assign(Error('Invalid page'),{code:[404,410].includes(res.statusCode)?'OFFICIAL_GONE':'OFFICIAL_RESPONSE'}));return;}
      const chunks=[];let length=0;
      res.on('data',chunk=>{length+=chunk.length;if(length>524288)req.destroy(Object.assign(Error('Page too large'),{code:'OFFICIAL_SIZE'}));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{clearTimeout(timer);const bytes=Buffer.concat(chunks);const head=bytes.subarray(0,2048).toString('ascii');const charset=/gb2312|gbk|gb18030/i.test(String(res.headers['content-type'])+head)?'gb18030':'utf-8';resolve({html:new TextDecoder(charset).decode(bytes),url:u.href});});
    });
    const timer=setTimeout(()=>req.destroy(Object.assign(Error('Page timeout'),{code:'OFFICIAL_TIMEOUT'})),7000);
    req.on('error',e=>{clearTimeout(timer);reject(e);});
  });
  if (response.redirect) return fetchOfficial(response.redirect,redirects+1);
  return response;
}
function decode(s) {return s.replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';}).replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,x=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x]));}
function plain(s) {return decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
function extractArticle(page) {
  const url=allowedUrl(page.url);if(!url||typeof page.html!=='string'||page.html.length>524288)fail('OFFICIAL_RESPONSE');
  const clean=page.html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|nav|header|footer|form|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const title=plain(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||clean.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'官方文章').slice(0,160);
  const body=clean.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1]||clean;
  const blocks=body.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi)||body.split(/<br\s*\/?>|<\/div>/i);
  const paragraphs=blocks.slice(0,250).map((x,i)=>({paragraph:i+1,text:plain(x)})).filter(x=>x.text.length>=12&&x.text.length<=4000).slice(0,120);
  if(!paragraphs.length)fail('OFFICIAL_NO_TEXT');
  return {url,title,publisher:HOSTS[new URL(url).hostname].publisher,pageHash:hash(paragraphs),paragraphs};
}
module.exports={fetchOfficial,extractArticle,publicIPv4};
