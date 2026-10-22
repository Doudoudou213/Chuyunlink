'use strict';
// Original-art selections only; no claim about real-world geometry or history.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scenes = require('../static/exploration-journey-study-scenes');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/exploration-gilded-profiles.js'),'utf8'),context);
const profiles = context.window.ChuParkGildedProfiles;
let checks = 0;
const check = (value,label) => {assert(value,label);checks++;};
check(Object.keys(scenes).join(',') === 'tower,copper,baiyun,pond','only the four explicitly registered original-art scenes');
for(const [id,scene] of Object.entries(scenes)) {
  const profile = profiles[id];
  check(Object.isFrozen(scene) && Object.isFrozen(scene.looks),id+' configuration cannot mutate at runtime');
  check(scene.rect.every((value,index)=>value===profile.sourceRect[['x','y','width','height'][index]]),id+' original registered rectangle');
  check(scene.looks.length===2 && new Set(scene.looks.map(look=>look.key)).size===2,id+' exactly two distinct, finite choices');
  check(scene.looks[0].key===scene.detail,id+' first look preserves existing detail contract');
  for(const look of scene.looks) {
    check(Object.isFrozen(look) && Object.isFrozen(look.contours),id+'/'+look.key+' deeply frozen');
    check(/^[a-z][a-z0-9-]{0,39}$/.test(look.key),id+' safe stable key');
    check(look.label.length>=2 && look.label.length<=10,id+' short display label');
    check(look.caption.length<=55 && !/[<>]/.test(look.caption),id+' short plain observation prompt');
    check(look.scale>=1 && look.scale<=2.5,id+' bounded zoom');
    check(look.origin.length===2 && look.origin.every(Number.isFinite) && look.shift.length===2 && look.shift.every(Number.isFinite),id+' finite position');
    check(look.origin[0]>=scene.rect[0] && look.origin[0]<=scene.rect[0]+scene.rect[2] && look.origin[1]>=scene.rect[1] && look.origin[1]<=scene.rect[1]+scene.rect[3],id+' focus stays within registered scene');
    check(look.contours.length>0 && look.contours.every(index=>scene.contours.includes(index)&&profile.contours[index]?.points?.length),id+' highlights only existing traced contours');
  }
  check(JSON.stringify(scene.looks[0].origin)!==JSON.stringify(scene.looks[1].origin) || scene.looks[0].scale!==scene.looks[1].scale,id+' two views are not duplicated buttons');
}
console.log('PASS original-art observation configuration: '+checks+' checks');
