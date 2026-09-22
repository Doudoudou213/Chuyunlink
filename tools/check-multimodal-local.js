'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const names=fs.readdirSync(__dirname).filter(n=>/^test-(material|story|sourced-story|ai-consent)/.test(n)&&n.endsWith('.js'));
for(const name of [...names,'validate-cloudbase-build.js']) {
 const r=spawnSync(process.execPath,[path.join(__dirname,name)],{cwd:root,encoding:'utf8'});
 if(r.status!==0){process.stderr.write(r.stdout+r.stderr);process.exit(1);}
 console.log(name+': PASS');
}
const result=spawnSync(process.execPath,[path.join(__dirname,'sync-material-evidence.js'),'--check'],{encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
console.log('All local multimodal regression checks passed. No network services invoked.');

