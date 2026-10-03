'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {createVideoDecoder,createVideoAdapters}=require('../cloudfunctions/materialWorker/lib/video-adapter');
const {normalizeResult,createProcessingService}=require('../cloudfunctions/materialWorker/lib/processing');
const {fakeDb}=require('./lib/fake-material-db');
async function main(){
 let calls=[];
 const decode=createVideoDecoder({ffmpeg:'fixture-ffmpeg',ffprobe:'fixture-ffprobe',runFile:async(binary,args)=>{
  calls.push({binary,args});if(binary==='fixture-ffprobe')return JSON.stringify({format:{duration:'12'}});
  await fs.writeFile(args.at(-1),Buffer.from('fixture-media'));return '';
 }});
 const frames=await decode({bytes:Buffer.from('fixture-video')},'video_frames');assert.equal(frames.frames.length,6);assert.equal(frames.frames[5].timeSeconds,10);
 const audio=await decode({bytes:Buffer.from('fixture-video')},'video_audio');assert.equal(audio.durationSeconds,12);
 assert.ok(calls.every(c=>c.args.includes('-protocol_whitelist')));
 await assert.rejects(fs.access(calls[0].args.at(-1)));
 let checked=0;const adapters=createVideoAdapters({decode,observe:async()=>({text:'轮廓观察',region:{x:0,y:0,width:1,height:1}}),transcribe:async()=>({blocks:[{text:'口述内容',startSeconds:0,endSeconds:2}]})});
 const output=await adapters.video_frames.process({asset:{bytes:Buffer.from('video')},beforeCall:async()=>{checked++;}});assert.equal(checked,7);
 assert.equal(normalizeResult('video_frames',output,12)[5].locator.timeSeconds,10);
 assert.throws(()=>normalizeResult('video_frames',{blocks:[{...output.blocks[0],timeSeconds:99}]},12),/时间/);
 const db=fakeDb({submissions:{s:{_id:'s',status:'approved',assetType:'video',fileID:'cloud://private',size:20,materialAnalysisConsent:true,materialConsentVersion:'multimodal-material-consent-v1',materialConsentScope:'approved_original_file_extraction'}}});
 const processor=createProcessingService({db});
 const a=await processor.run({submissionId:'s',kind:'video_frames'},'admin');const b=await processor.run({submissionId:'s',kind:'video_audio'},'admin');
 assert.notEqual(a.analysisId,b.analysisId);assert.equal((await processor.run({submissionId:'s',kind:'video_frames'},'admin')).cached,true);
 console.log('Video: bounded split adapter, fixed decoder responses, timestamps, temp cleanup, subcall consent and independent child caches passed (no real decoder/model).');
}main().catch(e=>{console.error(e);process.exitCode=1;});
