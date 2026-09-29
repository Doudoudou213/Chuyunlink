'use strict';
// Explicit opt-in to public HTTPS reads. Never calls AI or changes a database.
const {ARTICLES}=require('../cloudfunctions/adminSubmissions/lib/official-source-registry');
const {fetchOfficial,extractArticle}=require('../cloudfunctions/adminSubmissions/lib/official-source-fetch');
(async()=>{
 if(!process.argv.includes('--live')){console.log('No requests. Use --live to read the registered public articles; no model/database operations.');return;}
 for(const source of ARTICLES){try{const article=extractArticle(await fetchOfficial(source.url));console.log(JSON.stringify({resource:source.aliases[0],host:new URL(article.url).hostname,paragraphs:article.paragraphs.length,relevantParagraphs:article.paragraphs.filter(p=>source.aliases.some(alias=>p.text.includes(alias))).length,status:'fetched',verifiedSupport:false}));}catch(e){console.log(JSON.stringify({resource:source.aliases[0],status:'unavailable',code:['OFFICIAL_TIMEOUT','OFFICIAL_GONE','OFFICIAL_NO_TEXT','OFFICIAL_SIZE'].includes(e.code)?e.code:'FETCH_FAILED'}));}}
})().catch(()=>{console.error('Catalog check failed; no private diagnostics printed.');process.exit(1);});
