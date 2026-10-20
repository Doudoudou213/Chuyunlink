'use strict';
// Four editorial chapters, not four published guide records or a walking route.
const {createEditorialPreview} = require('./exploration-editorial-preview');
const draft = require('../fixtures/four-scenes-study.json');
const resourceId = 'hhl-four-scenes-study';
const preview = createEditorialPreview({
  draft, resourceId, pagePath:'/four-scenes.html', endpoint:'/__four-scenes', themes:true,
  noticeTitle:'四景叙事审阅样章', walkTitle:'黄鹤楼 · ' + draft.title + '（待审样章）',
  link:{url:'http://127.0.0.1:4220/tower-study.html?resourceId=hhl-tower-study', title:'第一阶段主楼样章'}
});
module.exports = preview;
if (require.main === module) preview.start(Number(process.argv[2]) || 4221).then(server => console.log(server.url + '/four-scenes.html?resourceId=' + resourceId)).catch(error => {console.error(error);process.exitCode = 1;});
