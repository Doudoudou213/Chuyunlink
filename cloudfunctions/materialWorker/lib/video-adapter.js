'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process');
const run=(binary,args)=>new Promise((resolve,reject)=>execFile(binary,args,{timeout:60000,maxBuffer:2*1024*1024,windowsHide:true},(e,stdout)=>e?reject(Object.assign(new Error('视频拆分失败'),{code:'VIDEO_DECODE_FAILED'})):resolve(stdout)));
function createVideoDecoder({ffmpeg,ffprobe,runFile=run}) {
  return async function decode(asset,kind) {
    if(!ffmpeg||!ffprobe)throw Object.assign(new Error('视频拆分工具未配置'),{code:'VIDEO_DECODER_DISABLED'});
    if(!asset||!Buffer.isBuffer(asset.bytes)||!asset.bytes.length||asset.bytes.length>50*1024*1024)throw Error('视频大小不满足限制');
    const tempRoot=path.resolve(os.tmpdir());
    const dir=await fs.mkdtemp(path.join(tempRoot,'chulink-video-'));
    if(!path.resolve(dir).startsWith(tempRoot+path.sep))throw Error('临时目录超出允许范围');
    try {
      const input=path.join(dir,'source.bin');await fs.writeFile(input,asset.bytes);
      const metadata=JSON.parse(await runFile(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration','-of','json',input]));
      const duration=Number(metadata.format&&metadata.format.duration);
      if(!Number.isFinite(duration)||duration<=0||duration>120)throw Error('第一版仅处理两分钟以内的视频');
      if(kind==='video_audio') {
        const output=path.join(dir,'audio.wav');
        await runFile(ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',input,'-vn','-ac','1','-ar','16000','-t',String(duration),'-y',output]);
        const bytes=await fs.readFile(output);if(bytes.length>8*1024*1024)throw Error('音频轨超过安全上限');
        return {bytes,durationSeconds:duration,size:bytes.length};
      }
      if(kind!=='video_frames')throw Error('视频处理方式不支持');
      const frames=[];
      for(let i=0;i<6;i++) {
        const timeSeconds=Number((duration*i/6).toFixed(3)),output=path.join(dir,'frame-'+i+'.jpg');
        await runFile(ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file,pipe','-ss',String(timeSeconds),'-i',input,'-frames:v','1','-vf','scale=640:-2','-y',output]);
        const bytes=await fs.readFile(output);if(bytes.length>2*1024*1024)throw Error('关键帧超过安全上限');
        frames.push({bytes,timeSeconds});
      }
      return {frames,durationSeconds:duration};
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  };
}
function createVideoAdapters({decode,transcribe,observe,version='video-v1'}) {
 return {
  video_audio:{simulated:false,provider:'video_audio_adapter',version,async process({asset,beforeCall}) {
    await beforeCall();const audio=await decode(asset,'video_audio');await beforeCall();return transcribe(audio);
  }},
  video_frames:{simulated:false,provider:'video_frame_adapter',version,async process({asset,beforeCall}) {
    await beforeCall();const {frames}=await decode(asset,'video_frames');const blocks=[];
    for(const frame of frames){await beforeCall();const result=await observe(frame.bytes);blocks.push({text:result.text,region:result.region,uncertainty:result.uncertainty,timeSeconds:frame.timeSeconds});}
    return {blocks};
  }}};
}
module.exports={createVideoDecoder,createVideoAdapters};
