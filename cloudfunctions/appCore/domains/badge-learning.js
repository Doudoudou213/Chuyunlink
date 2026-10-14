'use strict';
const crypto = require('node:crypto');
const { read, hash } = require('../lib/badge-evidence');
const VERSION = '2026-10-13.v1';
// Collection practice, not unverified historical claims. Answers stay on the server.
const LESSONS = [
  { id: 'permission', title: '先问一句，才留下记录', body: '进入私人空间前先取得同意。记录讲述者的声音时，说明用途和可能公开的范围，确认录音及使用授权；不要把同意拍照自动理解为同意公开姓名。', question: '对方允许录音，但没有同意公开姓名，应该怎么做？', options: ['直接公开姓名', '按已确认的授权范围使用，并隐藏姓名', '把姓名交给模型决定'], answer: 1, explanation: '录制、使用和公开姓名的范围应分别确认。' },
  { id: 'context', title: '细节也需要来处', body: '记录纹样时，先拍整体，再记录纹样所在部位和细节。备注拍摄地点与对象名称，区分眼前观察和资料推测，便于他人复核。', question: '怎样让一张纹样特写更容易复核？', options: ['只保留裁剪后的纹样', '增加饱和度', '同时记录整体、部位和对象说明'], answer: 2, explanation: '整体和部位信息能把细节放回它所在的对象。' },
  { id: 'transcription', title: '看不清的字，留一个问号', body: '整理碑刻、题记时保留影像与文字对应关系。不确定的字标注疑问，不根据想象补成确定结论，也不为获取清晰文字触碰或拓印未获许可的文物。', question: '题记中有一个字看不清，应当如何整理？', options: ['标注存疑并保留对应影像', '根据语感猜一个字', '当作没有这个字'], answer: 0, explanation: '明确不确定性，比填入未经证实的字更有帮助。' },
  { id: 'sources', title: '给一条纠错留下出处', body: '提出纠错时，说明需要修正的具体问题，附可核对的书名、页码或来源链接，并区分原文与自己的解释。同一问题重复提交不构成新的贡献。', question: '哪种纠错更便于管理员核对？', options: ['只写“这里错了”', '指出问题并给出可核对的出处', '反复提交同一句建议'], answer: 1, explanation: '具体问题与可靠出处应一起留下。' },
  { id: 'privacy', title: '上传前，再看一眼', body: '检查照片边缘、音频和备注中是否混入证件、联系方式、住址或未成年人信息。只提供采集所需资料，发现无关私人信息时先处理，再提交复核。', question: '照片里拍进了无关人员的证件信息，应当怎么做？', options: ['直接上传', '写一句免责声明即可', '先移除无关私人信息，再提交'], answer: 2, explanation: '避免收集和公开与采集目的无关的私人信息。' }
];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const recordId = (uid, lessonId) => hash([uid, lessonId, VERSION]);
function createBadgeLearning({ db, clock = () => Date.now() }) {
  async function records(uid, store = db) {
    return Promise.all(LESSONS.map(lesson => read(store, 'badge_learning', recordId(uid, lesson.id))));
  }
  async function metrics(uid, store = db) {
    const rows = (await records(uid, store)).filter(r => r && r.userId === uid && r.version === VERSION && LESSONS.some(l => l.id === r.lessonId));
    return { completed_learning_topics: rows.filter(r => r.completedAt).length, correct_quiz_questions: rows.filter(r => r.passed === true).length };
  }
  async function start(uid, event) {
    if (!uid) fail('UNAUTHENTICATED', '请先登录');
    const rows = await records(uid);
    const lesson = event.lessonId ? LESSONS.find(l => l.id === event.lessonId) : LESSONS.find((l, i) => rows[i]?.passed !== true);
    if (event.lessonId && !lesson) fail('BADGE_LESSON_INVALID', '没有找到这节小课');
    if (!lesson) return { ok: true, complete: true };
    const token = crypto.randomBytes(24).toString('hex');
    await db.collection('badge_learning_sessions').doc(hash([uid, lesson.id])).set({ userId: uid, lessonId: lesson.id,
      tokenHash: hash(token), version: VERSION, expiresAt: clock() + 30 * 60 * 1000, answered: false });
    return { ok: true, complete: false, lesson: { id: lesson.id, title: lesson.title, body: lesson.body,
      question: lesson.question, options: lesson.options, version: VERSION, token } };
  }
  async function answer(uid, event) {
    if (!uid) fail('UNAUTHENTICATED', '请先登录');
    const lesson = LESSONS.find(l => l.id === event.lessonId);
    if (!lesson || !Number.isInteger(event.answer) || event.answer < 0 || event.answer >= lesson.options.length || typeof event.token !== 'string') fail('BADGE_ANSWER_INVALID', '请选择本课的一项答案');
    return db.runTransaction(async tx => {
      const sessionId = hash([uid, lesson.id]);
      const session = await read(tx, 'badge_learning_sessions', sessionId);
      if (!session || session.userId !== uid || session.version !== VERSION || session.tokenHash !== hash(event.token) || session.expiresAt < clock()) fail('BADGE_LESSON_EXPIRED', '本次学习已过期，请重新打开');
      if (session.answered) return { ok: true, correct: session.correct, explanation: lesson.explanation, cached: true };
      const id = recordId(uid, lesson.id), previous = await read(tx, 'badge_learning', id);
      const correct = event.answer === lesson.answer;
      await tx.collection('badge_learning').doc(id).set({ userId: uid, lessonId: lesson.id, version: VERSION,
        completedAt: previous?.completedAt || new Date(clock()).toISOString(), passed: previous?.passed === true || correct });
      await tx.collection('badge_learning_sessions').doc(sessionId).set({ ...session, answered: true, correct });
      return { ok: true, correct, explanation: lesson.explanation, cached: false };
    });
  }
  return { metrics, start, answer };
}
module.exports = { createBadgeLearning, LESSONS, VERSION };
