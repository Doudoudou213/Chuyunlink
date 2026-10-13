'use strict';
// No real vision provider is wired here. Production returns manual matching; test adapters are injected only by local tests.
const C=require('../lib/site-walk-core'),E=require('../lib/exploration-core');
function createExplorationRecognitionService({db,adapter=null}){return {async recognize(e,uid){if(!uid)C.fail('UNAUTHENTICATED','请登录后使用照片识别');const live=await E.get(db,C.id(e.resourceId));if(!live.available)C.fail('WALK_SOURCE','本站景物资料需要复核');if(!adapter)return {ok:true,available:false,reason:'照片识别尚未接入，照片只在本机预览，请手动选择眼前景物。',candidates:[]};
 if(e.consent?.accepted!==true||e.consent?.version!=='exploration-photo-v1')C.fail('PHOTO_CONSENT','需要对本次照片分析单独授权');
 if(typeof e.image!=='string'||e.image.length>350000||!/^data:image\/jpeg;base64,\/[9]j\/[A-Za-z0-9+/=\r\n]+$/.test(e.image))C.fail('PHOTO_INPUT','请使用去除元数据的单张小尺寸 JPEG');
 const result=await adapter.match({image:e.image,objects:live.map.objects.map(o=>({id:o.id,label:o.label})),requestId:C.id(e.requestId)});
 const fresh=await E.get(db,e.resourceId);if(!fresh.available||fresh.walk.fingerprint!==live.walk.fingerprint)C.fail('WALK_SOURCE','识别期间景物资料已变化');
 const candidates=(Array.isArray(result?.candidates)?result.candidates:[]).slice(0,3).filter(x=>live.map.objects.some(o=>o.id===x.objectId)).map(x=>({objectId:x.objectId,label:live.map.objects.find(o=>o.id===x.objectId).label}));
 return {ok:true,available:true,simulated:true,candidates:[...new Map(candidates.map(x=>[x.objectId,x])).values()],requiresUserConfirmation:true};
}};}
module.exports={createExplorationRecognitionService};
