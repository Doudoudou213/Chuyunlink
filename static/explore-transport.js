(function(){
  'use strict';
  let connection;
  function loadSDK(){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      let settled=false,timer;
      function finish(error){
        if(settled)return;
        settled=true;clearTimeout(timer);script.onload=null;script.onerror=null;
        if(error){script.remove();reject(error);}else resolve();
      }
      script.src='https://static.cloudbase.net/cloudbase-js-sdk/2.28.6/cloudbase.full.js';
      script.onload=()=>finish(window.cloudbase?null:Error('云端连接组件未能加载，请重试。'));
      script.onerror=()=>finish(Error('网络暂不可用，请稍后重试'));
      // Bound only our SDK load. Business calls and authentication stay with GuideCloud.
      timer=setTimeout(()=>finish(Error('连接加载超时，请检查网络后重试。')),8000);
      try{document.head.append(script);}catch(error){finish(error);}
    });
  }
  async function connect(){
    if(window.ExplorationAdapter)return window.ExplorationAdapter;
    if(connection)return connection;
    const attempt=(async()=>{
      if(!window.cloudbase)await loadSDK();
      return {
        async identity(){
          const existing=await GuideCloud.identity();
          if(existing?.uid)return existing.uid;
          await GuideCloud.call({action:'getSiteWalk',resourceId:new URLSearchParams(location.search).get('resourceId')||'yellow-crane-tower'});
          const user=await GuideCloud.identity();return user?.uid||'guest';
        },
        call:data=>GuideCloud.call(data)
      };
    })();
    connection=attempt;
    try{return await attempt;}
    catch(error){
      // An older failed attempt must not clear a newer connection.
      if(connection===attempt)connection=null;
      throw error;
    }
  }
  window.ExploreTransport={
    async identity(){return (await connect()).identity();},
    async call(data){return (await connect()).call(data);}
  };
})();
