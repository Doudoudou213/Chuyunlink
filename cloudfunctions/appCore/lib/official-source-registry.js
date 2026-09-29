'use strict';
// Reviewed exact hosts and public article seeds. Category/domain suffix alone is not approval.
const HOSTS = Object.freeze({
  'ylj.wuhan.gov.cn': { publisher: '武汉市园林和林业局', category: 'government' },
  'wlj.wuhan.gov.cn': { publisher: '武汉市文化和旅游局', category: 'culture_department' },
  'hbww.org.cn': { publisher: '湖北省博物馆', category: 'museum' }
});
const ARTICLES = Object.freeze([
  { aliases: ['黄鹤楼','武汉黄鹤楼'], url: 'https://ylj.wuhan.gov.cn/zwgk/zwxxgkzl_12298/jggk_12304/xsdwszjzz_12308/202001/t20200110_726398.shtml' },
  { aliases: ['晴川阁','武汉晴川阁'], url: 'https://wlj.wuhan.gov.cn/zfxxgk/fdzdgknr/jgjj/zsdw/202008/t20200827_1437251.shtml' },
  { aliases: ['曾侯乙编钟'], url: 'https://hbww.org.cn/zgzb/p/4695.html' }
]);
function allowedUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOSTS[u.hostname] || u.search || u.hash || !/\.(?:s?html?)$/i.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}
function catalogSearch(title) {
  const name = String(title || '').replace(/\s/g, '');
  return ARTICLES.filter(a => a.aliases.some(alias => name.includes(alias))).slice(0, 3).map(a => a.url);
}
module.exports = { HOSTS, ARTICLES, allowedUrl, catalogSearch };
