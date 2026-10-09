'use strict';
// Offline diagnostic export only. Never connects to a database or provider.
// Counts are operational outcomes, NOT historical correctness or human approval rates.
function summarize(rows){
 const groups=new Map();
 for(const r of rows){if(!Array.isArray(r.version)||r.version.length!==4||!['answered','unsupported','insufficient','source_changed','unavailable','failed','processing'].includes(r.status))continue;
  const key=JSON.stringify(r.version);if(!groups.has(key))groups.set(key,{version:r.version,total:0,outcomes:{},attemptedCalls:0,knownCostCny:0,unknownCostRequests:0,reservedCny:0,latencies:[]});
  const g=groups.get(key);g.total++;g.outcomes[r.status]=(g.outcomes[r.status]||0)+1;g.attemptedCalls+=Number.isFinite(r.calls)?r.calls:0;
  if(r.usageKnown&&Number.isFinite(r.estimatedMicros))g.knownCostCny+=r.estimatedMicros/1e6;else g.unknownCostRequests++;
  g.reservedCny+=(Number.isFinite(r.reservedMicros)?r.reservedMicros:0)/1e6;if(Number.isFinite(r.elapsedMs))g.latencies.push(r.elapsedMs);
 }
 return [...groups.values()].map(({latencies,...g})=>({...g,averageLatencyMs:latencies.length?Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length):null,answerDeliveryRate:g.total>=10?(g.outcomes.answered||0)/g.total:null,note:g.total<10?'样本不足10条，仅看次数；不代表事实正确率':'运行指标不代表事实正确性或人工审核质量'}));
}
if(require.main===module){const file=process.argv[2];if(!file)throw Error('请提供已经授权导出的本地诊断JSON路径');const data=JSON.parse(require('node:fs').readFileSync(file,'utf8'));console.log(JSON.stringify(summarize(Array.isArray(data)?data:Object.values(data)),null,2));}
module.exports={summarize};
