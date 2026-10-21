(function(){
  'use strict';
  const ids=['study','question','admin','scenario','review'];
  const status=document.getElementById('suite-status');
  try {
    const links=JSON.parse(document.getElementById('suite-links').textContent);
    if(!links||Object.keys(links).length!==ids.length)throw Error('入口不完整');
    const checked=ids.map(id=>{
      const u=new URL(links[id]);
      if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\d+$/.test(u.port)||u.username||u.password||u.hash)throw Error('非本机入口');
      return [id,u.href];
    });
    for(const [id,url]of checked){const a=document.getElementById('open-'+id);a.href=url;a.removeAttribute('aria-disabled');}
    status.textContent='本机入口已就绪';
  } catch {
    status.textContent='入口未准备好，请重新启动本地试用服务后刷新。没有连接线上服务。';
  }
})();
