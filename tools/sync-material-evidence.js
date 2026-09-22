'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(__dirname,'lib/material-evidence.js'),'utf8');
for(const name of ['appCore','adminSubmissions','materialWorker','storyAgentWorker','storyWorker']) {
  const dest=path.join(root,'cloudfunctions',name,'lib/material-evidence.js');
  if(process.argv.includes('--check')) {
    if(!fs.existsSync(dest)||fs.readFileSync(dest,'utf8')!==source) throw Error('Material rules out of sync: '+name);
  } else { fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source); }
}
console.log('Material evidence rules synchronized.');
