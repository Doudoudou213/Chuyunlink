'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ink = require('../static/map-route-ink');
let count = 0;
function test(name, run) { run(); count++; console.log('PASS ' + name); }
const p = [[30.55,114.26],[30.551,114.261],[30.552,114.264]];
const result = {provider:'amap-web-service', mode:'walk', polyline:p, legs:[{polyline:p}]};
test('原始坐标逐点一致，不拟合不重复偏移', () => {
  let calls=0; const g=ink.routeSegments(result, x=>{calls++;return [...x];});
  assert.deepEqual(g.segments,[p]); assert.equal(calls,3); assert.equal(g.animatable,true);
});
test('分段间不人为连线',()=>{const q=p.map(x=>[x[0]+.1,x[1]+.1]); assert.deepEqual(ink.routeSegments({...result,legs:[{polyline:p},{polyline:q}]},x=>x).segments,[p,q]);});
test('拒绝模拟或未知服务数据',()=>{for(const bad of [{...result,simulated:true},{...result,provider:'mock'},null]) assert.throws(()=>ink.routeSegments(bad,x=>x));});
test('非法坐标不能通过过滤后跨缺口连线',()=>{for(const invalid of [null,[NaN,114],['30',114],[91,114]]) assert.throws(()=>ink.routeSegments({...result,legs:[{polyline:[p[0],invalid,p[2]]}]},x=>x));});
test('公交与双点回退不伪装成连续道路动画',()=>{assert.equal(ink.routeSegments({...result,mode:'transit'},x=>x).animatable,false); assert.equal(ink.routeSegments({...result,legs:[{polyline:p.slice(0,2)}]},x=>x).animatable,false);});
test('按真实 SVG 长度而非顶点数量推进',()=>{assert.deepEqual(ink.frameAt([100,300],.5),[{visible:100,offset:0},{visible:100,offset:200}]);});
test('进度边界与倒放确定性',()=>{assert.equal(ink.frameAt([100],-1)[0].offset,100); assert.equal(ink.frameAt([100],2)[0].offset,0); assert.deepEqual(ink.frameAt([100,300],.25),ink.frameAt([100,300],.25));});

function eventTarget() {
  const events=new Map();
  return {on(names,fn){names.split(' ').forEach(n=>{if(!events.has(n))events.set(n,new Set());events.get(n).add(fn);});return this;},
    off(names,fn){names.split(' ').forEach(n=>events.get(n)?.delete(fn));return this;},
    fire(n,arg){[...(events.get(n)||[])].forEach(fn=>fn(arg));},
    addEventListener(n,fn){this.on(n,fn);}, removeEventListener(n,fn){this.off(n,fn);}};
}
function element() {return {children:[],style:{removeProperty(name){delete this[name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];}},
  setAttribute(n,v){this[n]=v;},appendChild(child){child.parentNode=this;this.children.push(child);},remove(){this.removed=true;},
  getTotalLength(){return 100;},getPointAtLength(v){return {x:v,y:7};},parentNode:{appendChild(c){this.tip=c;}}};}
function harness(reduced=false) {
  const tasks=new Map(); let id=0; const lines=[], controls=[], map=eventTarget(),doc=eventTarget(),win=eventTarget();
  doc.hidden=false;doc.createElement=element;doc.createElementNS=element;
  const media=Object.assign(eventTarget(),{matches:reduced});win.matchMedia=()=>media;
  const L={polyline(coords,options){const line=Object.assign(eventTarget(),{coords,options,svg:element(),addTo(){return this;},getElement(){return this.svg;}});lines.push(line);return line;},
    control(options){const c={options,addTo(){this.box=this.onAdd();return this;},remove(){this.removed=true;}};controls.push(c);return c;},
    DomUtil:{create:element},DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}}};
  const ctx={module:{exports:{}},window:win,document:doc,
    requestAnimationFrame(fn){tasks.set(++id,fn);return id;},cancelAnimationFrame(n){tasks.delete(n);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/map-route-ink.js'),'utf8'),ctx);
  const controller=ctx.module.exports.draw({map,group:{},segments:[p],L});
  return {controller,lines,controls,map,doc,win,media,tasks,step(time){const list=[...tasks.values()];tasks.clear();list.forEach(fn=>fn(time));}};
}
test('笔尖直接读取同一路径，不生成第二条曲线',()=>{const h=harness();h.step(0);h.step(0);h.step(4000);const main=h.lines[1];assert.equal(main.svg.style.strokeDashoffset,'50');assert.equal(main.svg.parentNode.tip.cx,'50');assert.equal(main.svg.parentNode.tip.cy,'7');assert.deepEqual(h.lines[0].coords,main.coords);h.controller.destroy();});
test('地图移动/缩放/尺寸改变显示完整线并取消帧',()=>{for(const event of ['movestart','zoomstart','resize']){const h=harness();h.step(0);h.step(0);h.map.fire(event);assert.equal(h.controller.getProgress(),1);assert.equal(h.tasks.size,0);assert.equal(h.lines[1].svg.style.strokeDashoffset,undefined);h.controller.destroy();}});
test('切页/后台时无残留循环，重播不请求云端',()=>{const h=harness();h.step(0);h.win.fire('chu:view-changing',{detail:{tabId:'profile'}});assert.equal(h.tasks.size,0);h.controller.play();h.doc.hidden=true;h.doc.fire('visibilitychange');assert.equal(h.tasks.size,0);h.controller.destroy();});
test('减少动态效果直接保留完整路径',()=>{const h=harness(true);h.step(0);assert.equal(h.controller.getProgress(),1);assert.equal(h.tasks.size,0);h.controller.destroy();});
test('清除图层后重播不能复活旧动画',()=>{const h=harness();h.step(0);h.lines[1].fire('remove');h.controller.play();assert.equal(h.tasks.size,0);});
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
test('清空/静默更新均失效请求，成功绘制不会失效自己',()=>{assert.match(html,/function clearMapPlannerPreview\(invalidate = true\)/);assert.match(html,/if \(invalidate\) mapPlannerRouteRequestId \+= 1/);assert.match(html,/clearMapPlannerPreview\(false\)/);assert.match(html,/const requestId = mapPlannerRouteRequestId/);});
test('异步旧请求返回不能绘制',()=>{const start=html.indexOf('const result = await window.planCloudRoute');assert(html.indexOf('if (requestId !== mapPlannerRouteRequestId) return;',start)<html.indexOf('ChuRouteInk.routeSegments',start));});
test('新地点坐标/出处/无虚构奖励',()=>{const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/map-exploration-points.js'),'utf8'),ctx);const a=ctx.window.CHULINK_EXPLORATION_POINTS;assert.equal(a.length,3);assert.equal(new Set(a.map(x=>x.id)).size,3);a.forEach(x=>{assert.equal(x.coordinateSystem,'gcj02');assert.equal(x.points,0);assert(x.sourceUrl.startsWith('https://ditu.amap.com/place/'));});assert.equal(a[2].recommendationEligible,false);});
test('只保留右下角可访问的双箭头，点击从头重播',()=>{
  const h=harness(), c=h.controls[0], button=c.box.children[0];
  assert.equal(c.options.position,'bottomright'); assert.equal(c.box.children.length,1);
  assert.equal(button['aria-label'],'重播路线描线'); assert.match(button.innerHTML,/<svg/);
  h.step(0);h.step(0);h.step(4000);assert.equal(h.controller.getProgress(),.5);
  button.onclick();assert.equal(h.controller.getProgress(),0);assert.equal(h.tasks.size,1);
  h.controller.destroy();assert.equal(c.removed,true);
});
test('无字大头针替换原图标，路线仍移除底层状态点',()=>{
  const icon=html.slice(html.indexOf('function createHeritageIcon'),html.indexOf('function escapeHtml'));
  assert.match(icon,/chu-map-pin-marker/);assert.doesNotMatch(icon,/chu-map-seal|heritage-marker|chu-explore-marker/);
  const routeIcon=html.slice(html.indexOf('function createRoutePointIcon'),html.indexOf('function createRouteArrowIcon'));
  assert.match(routeIcon,/const icon = createHeritageIcon/);assert.doesNotMatch(routeIcon,/route-marker/);
  assert.match(html,/createRoutePointIcon\(String\(index \+ 1\), 'target', false, item.status\)/);
  const draw=html.slice(html.indexOf('function drawMapPlannerPoints'),html.indexOf('function fitMapPlannerBounds'));
  assert(draw.indexOf('mapPlannerRenderedIds.add')<draw.indexOf('L.marker'));
  assert.match(html,/!mapPlannerRenderedIds.has\(item.id\) && !mapActivityRenderedIds.has\(item.id\)/);
  const clear=html.slice(html.indexOf('function clearMapPlannerPreview'),html.indexOf('function getMapPlannerCity'));
  assert.match(clear,/mapPlannerRenderedIds.clear\(\)/);assert.match(clear,/renderHeritageMapMarkers\(\)/);
});
test('真实标记函数替换并恢复状态点，云端刷新不重新叠底',()=>{
  const markerNodes=[];
  const group={clearLayers(){markerNodes.length=0;}};
  const ctx={heritageMap:{},heritageMarkerLayerGroup:group,
    heritageLandmarks:[{id:'a',coords:p[0],status:'pending',label:'待采',title:'A'},
      {id:'b',coords:p[1],status:'verified',label:'已采',title:'B'},{id:'c',coords:p[2],status:'explore',title:'C'}],
    mapPlannerRenderedIds:new Set(),mapActivityRenderedIds:new Set(),
    getLandmarkMapLatLng:x=>x.coords,escapeHtml:x=>String(x),focusLandmark(){},selectMapPlannerPoint(){},
    L:{divIcon:options=>({options}),marker(coords,options){return {coords,options,addTo(){markerNodes.push(this);return this;},bindTooltip(){return this;},on(){return this;}};}}
  };
  vm.runInNewContext(html.slice(html.indexOf('function createHeritageIcon'),html.indexOf('function escapeHtml')),ctx);
  vm.runInNewContext(html.slice(html.indexOf('function createRoutePointIcon'),html.indexOf('function createRouteArrowIcon')),ctx);
  vm.runInNewContext(html.slice(html.indexOf('function renderHeritageMapMarkers'),html.indexOf('function refreshUnifiedResourceUi')),ctx);
  ctx.renderHeritageMapMarkers();assert.equal(markerNodes.length,3);
  assert.match(markerNodes[0].options.icon.options.className,/pin-red/);
  assert.match(markerNodes[1].options.icon.options.className,/pin-green/);
  assert.match(markerNodes[2].options.icon.options.className,/pin-gold/);
  for(const status of ['pending','verified','explore']) {
    const icon=ctx.createRoutePointIcon('12','target',false,status).options;
    assert.equal(icon.html.replace(/<[^>]+>/g,''),'');
    assert.equal(icon.className,ctx.createHeritageIcon(status).options.className+' pin-route');
    assert.deepEqual(Array.from(icon.iconAnchor),[22,37]);
    assert.deepEqual(Array.from(icon.iconSize),[44,44]);
  }
  ctx.mapPlannerRenderedIds.add('a');ctx.renderHeritageMapMarkers();
  assert.equal(markerNodes.length,2);assert(!markerNodes.some(m=>m.options.title==='A'));
  ctx.renderHeritageMapMarkers();assert.equal(markerNodes.length,2);
  ctx.mapPlannerRenderedIds.clear();ctx.renderHeritageMapMarkers();assert.equal(markerNodes.length,3);
  ctx.mapActivityRenderedIds.add('b');ctx.renderHeritageMapMarkers();assert.equal(markerNodes.length,2);
});
console.log(count+' route integration checks passed; no network, no reward mutation.');
