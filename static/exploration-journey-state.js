/* Isolated prototype state. Browsing is not arrival, attendance or a reward. */
(function (root) {
  'use strict';
  const routes = Object.freeze({
    first: Object.freeze({ title: '初识名楼', subtitle: '从楼阁的轮廓，读到水边的留白', stops: Object.freeze(['tower','copper','baiyun','pond']) }),
    garden: Object.freeze({ title: '园林慢读', subtitle: '从一池水开始，慢慢看见楼与园', stops: Object.freeze(['pond','baiyun','tower']) })
  });
  const KEY = 'chulink:journey-demo:v1';
  const VERSION = 1;
  function create(route = 'first', now = Date.now()) {
    if (!Object.hasOwn(routes,route)) throw new Error('Unknown experience');
    return { version: VERSION, route, index: 0, phase: 'active', observed: [], note: '', updatedAt: now };
  }
  function restore(value, now = Date.now()) {
    if (!value || value.version !== VERSION || !Object.hasOwn(routes,value.route) || !Number.isFinite(value.updatedAt) || value.updatedAt > now+60000 || now-value.updatedAt > 7*86400000) return null;
    const stops = routes[value.route].stops;
    if (!Number.isInteger(value.index) || value.index < 0 || value.index >= stops.length || !['active','paused','finished'].includes(value.phase)) return null;
    return { version: VERSION, route: value.route, index: value.index, phase: value.phase === 'active' ? 'paused' : value.phase,
      observed: [...new Set(Array.isArray(value.observed) ? value.observed.filter(id => stops.includes(id)) : [])],
      note: typeof value.note === 'string' ? value.note.slice(0,120) : '', updatedAt: value.updatedAt };
  }
  function transition(state, action, payload, now = Date.now()) {
    const next = { ...state, observed: [...state.observed], updatedAt: now };
    const stops = routes[state.route].stops;
    if (action === 'resume' && state.phase === 'paused') next.phase = 'active';
    if (action === 'pause' && state.phase === 'active') next.phase = 'paused';
    if (action === 'finish' && state.phase === 'active') next.phase = 'finished';
    if (action === 'review' && state.phase === 'finished') next.phase = 'active';
    if (action === 'note') next.note = String(payload || '').slice(0,120);
    if (state.phase === 'active') {
      if (action === 'select' && stops.includes(payload)) next.index = stops.indexOf(payload);
      if (action === 'previous') next.index = Math.max(0,state.index-1);
      if (action === 'observe') {
        const id = stops[state.index];
        if (!next.observed.includes(id)) next.observed.push(id);
        if (next.index < stops.length-1) next.index++;
        else next.phase = 'finished';
      }
    }
    return next;
  }
  const api = Object.freeze({routes,KEY,create,restore,transition});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChuJourneyState = api;
})(typeof window === 'undefined' ? globalThis : window);
