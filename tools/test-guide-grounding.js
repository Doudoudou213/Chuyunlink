'use strict';
const assert=require('node:assert/strict');
const {inspectGuide}=require('../cloudfunctions/storyWorker/lib/guide-grounding');
function screen(text,evidence,kind='unknown',extra={}){
 const input={resourceTitle:'黄鹤楼',sourceFingerprint:'v1',sourceContextFingerprint:'v1',claims:[{id:'c',text:evidence,sourceLinkIds:['s']}],sources:[{id:'s',excerpt:evidence,context:{kind,qualifiers:[]}}]};
 return inspectGuide({title:'文化资料',sentences:[{text,claimIds:['c']}],observations:[],gaps:[],...extra},input);
}
// Debug regression fixtures, not an independent fixed acceptance set or accuracy benchmark.
const cases=[
 ['冒认亲历','我们现场观察到黄鹤楼位于蛇山。','黄鹤楼位于蛇山。','official','EYEWITNESS'],
 ['官方转述','资料记载黄鹤楼位于蛇山。','黄鹤楼位于蛇山。','official',null],
 ['合法引语','投稿者说：“我亲眼看见石刻。”','我亲眼看见石刻。','observation',null],
 ['假引语','投稿者说：“我亲眼看见皇帝。”','画面可见石刻。','observation','EYEWITNESS'],
 ['否定例子','不能声称我们亲眼看见石刻。','画面可见石刻。','unknown',null],
 ['否定后冒认','不能声称我们亲眼看见石刻，但我们现场观察到皇帝。','画面可见石刻。','unknown','EYEWITNESS'],
 ['假现场核验','实际数量我们未在现场核对。','编钟共65件。','official','EYEWITNESS'],
 ['事件错配','黄鹤楼始建于1985年。','黄鹤楼始建于223年，重建于1985年。','official','DATE_CONFLICT'],
 ['事件正确','黄鹤楼始建于223年，重建于1985年。','黄鹤楼始建于223年，重建于1985年。','official',null],
 ['单位错配','编钟共65组。','编钟共65件。','official','NUMBER'],
 ['单位正确','编钟共65件。','编钟共65件。','official',null],
 ['中文数词','编钟共六十五件。','编钟共65件。','official',null],
 ['限定丢失','这里是一处古代遗址。','这里可能是一处古代遗址。','unknown','QUALIFIER'],
 ['限定保留','这里可能是一处古代遗址。','这里可能是一处古代遗址。','unknown',null],
 ['口述变定论','古人曾在这里建造寺庙。','古人曾在这里建造寺庙。','oral','ATTRIBUTION'],
 ['口述有归属','据讲述者口述，古人曾在这里建造寺庙。','古人曾在这里建造寺庙。','oral',null],
 ['图像推断','这是真迹，始建于223年。','画面可见一处楼阁。','image_observation','IMAGE_INFERENCE'],
 ['图像描述','画面可见一处楼阁。','画面可见一处楼阁。','image_observation',null],
 ['因果增强','这种纹饰传承到了黄鹤楼。','两处材料都有凤鸟纹。','unknown','CAUSAL'],
 ['比较案例','两处材料都有凤鸟纹。','两处材料都有凤鸟纹。','unknown',null],
 ['后半句造事实','编钟共65件，皇帝每天在此主持盛大的宗教祭祀。','编钟共65件。','official','SUPPORT'],
 ['已有事实','资料记载，编钟共65件。','编钟共65件。','official',null],
 ['标题越界','黄鹤楼位于蛇山。','黄鹤楼位于蛇山。','official','SUPERLATIVE',{title:'中国最早的楼阁'}],
 ['标题中性','黄鹤楼位于蛇山。','黄鹤楼位于蛇山。','official',null,{title:'黄鹤楼的位置'}],
 ['假方位','请看左侧第三块碑。','现场有石碑。','unknown','LOCATOR'],
 ['有据方位','请看左侧第三块碑。','现场观察记录：请看左侧第三块碑。','unknown',null],
 ['过度存疑','据称黄鹤楼位于蛇山，具体位置尚不确定。','黄鹤楼位于蛇山。','official','OVERHEDGE'],
 ['正常记载','黄鹤楼位于蛇山。','黄鹤楼位于蛇山。','official',null],
 ['阅读建议','可以展开来源查看原始材料。','编钟共65件。','unknown',null],
 ['观察提示冒认','编钟共65件。','编钟共65件。','official','EYEWITNESS',{observations:[{text:'我们现场观察到皇帝。',claimIds:['c']}]}]
];
async function main(){let hard=0,legal=0;for(const [name,text,evidence,kind,code,extra] of cases){const r=screen(text,evidence,kind,extra);if(code)assert(r.issues.some(i=>i.code===code),name+': missing '+code);else{assert.equal(r.status,'screened',name+': '+JSON.stringify(r.issues));legal++;}if(r.status==='blocked')hard++;}assert.notEqual(screen('编钟共65件。','编钟共65件。').fingerprint,screen('编钟共65组。','编钟共65件。').fingerprint);console.log(`Guide grounding: ${cases.length} debug contrasts passed; ${hard} known hard violations blocked; ${legal} legal controls without warnings. Semantic accuracy still requires human judgement.`);}
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1)});
module.exports={screen,cases};
