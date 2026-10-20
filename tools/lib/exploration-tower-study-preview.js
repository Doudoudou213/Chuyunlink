'use strict';
// Original single-scene specimen stays separate from the four-scene review.
const {createEditorialPreview} = require('./exploration-editorial-preview');
const source = require('../fixtures/tower-study.json');
const resourceId = 'hhl-tower-study';
const draft = {...source, points:[{...source, id:'tower', artScene:'tower', title:'黄鹤楼主楼'}]};
const preview = createEditorialPreview({
  draft, resourceId, pagePath:'/tower-study.html', endpoint:'/__tower-study', single:true, fingerprintSource:source,
  noticeTitle:'主楼讲解审阅样章', walkTitle:'黄鹤楼主楼 · ' + source.title + '（待审样章）',
  link:{url:'http://127.0.0.1:4221/four-scenes.html?resourceId=hhl-four-scenes-study', title:'四景叙事样章'}
});
module.exports = preview;
if (require.main === module) preview.start(Number(process.argv[2]) || 4220).then(server => console.log(server.url + '/tower-study.html?resourceId=' + resourceId)).catch(error => {console.error(error);process.exitCode = 1;});
