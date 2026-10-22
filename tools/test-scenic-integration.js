'use strict';
// Local source contracts only. Browser and production checks are separate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const index=read('index.html'),journey=read('explore-journey.html'),deploy=read('tools/deploy-cloudbase.ps1');
const files=['scenic-entry.js','scenic-entry.css','scenic-return.js','scenic-host.js','scenic-reading-fallback.js','scenic-reading-fallback.css'];
for(const file of files){assert(fs.existsSync(path.join(root,'static',file)));assert(deploy.includes("'"+file+"'"),file+' release manifest');}
assert.equal((index.match(/src="\.\/static\/scenic-return\.js"/g)||[]).length,1);
assert(index.indexOf('static/scenic-return.js')<index.indexOf('const overlay = document.createElement'));
assert(index.includes('window.ChuScenicReturn?.read(new URLSearchParams(location.search).get(\'scenicReturn\'))'));
assert(index.includes('window.ChuScenicEntry?.onLandmark(item)'));
assert(index.indexOf('static/cloudbase-app.js')<index.indexOf('static/scenic-host.js'));
assert(journey.indexOf('static/scenic-reading-fallback.js')<journey.indexOf('static/exploration-journey-live.js'));
assert(journey.includes('id="scenic-reading-fallback" hidden'));
const bridge=read('static/cloudbase-app.js').split('window.ChuScenicApi = data => {')[1].split('\n  };')[0];
assert(bridge.includes("data?.action !== 'getSiteExploration'"));
assert(bridge.includes("callCore({ action: 'getSiteExploration', resourceId: data.resourceId })"));
const entry=read('static/site-walk-entry.js');
assert(entry.includes("value.atlas?'explore-journey.html':'onsite.html'"));
assert(entry.includes("action:'getSiteWalk'"));
assert(!deploy.includes("'four-scenes.html'"));assert(!deploy.includes("'trial-suite.html'"));
assert(!deploy.includes("'tools/fixtures'"));
assert(read('cloudfunctions/appCore/lib/exploration-core.js').includes('C.publicWalk(db,resourceId,now)'));
assert(!read('static/scenic-entry.js').includes('askSiteExploration'));
console.log('PASS scenic integration source contracts: scoped read bridge, original gates, startup/return hooks, reviewed-only entry and explicit deployment assets. No cloud calls.');
