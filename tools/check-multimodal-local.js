'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
for(const name of ['appCore','adminSubmissions','materialWorker','storyAgentWorker','storyWorker']) {
 const dirs=['lib','domains'];
 for(const dir of dirs){const folder=path.join(root,'cloudfunctions',name,dir);if(!fs.existsSync(folder))continue;
 for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',path.join(folder,file)],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);}}
}
const names=fs.readdirSync(__dirname).filter(n=>/^test-(material|story|sourced-story|ai-consent)/.test(n)&&n.endsWith('.js')&&!n.endsWith('-ui.js'));
for(const name of [...names,'validate-cloudbase-build.js']) {
 const r=spawnSync(process.execPath,[path.join(__dirname,name)],{cwd:root,encoding:'utf8'});
 if(r.status!==0){process.stderr.write(r.stdout+r.stderr);process.exit(1);}
 console.log(name+': PASS');
}
const result=spawnSync(process.execPath,[path.join(__dirname,'sync-material-evidence.js'),'--check'],{encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
for(const name of ['appCore','materialWorker'])if(fs.readFileSync(path.join(root,'cloudfunctions',name,'lib/material-impacts.js'),'utf8')!==fs.readFileSync(path.join(__dirname,'lib/material-impacts.js'),'utf8'))throw Error('Material propagation rules out of sync');
console.log('All local multimodal regression checks passed. No network services invoked.');
