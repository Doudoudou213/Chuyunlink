'use strict';
require('./lib/site-walk-workspace-preview').start(Number(process.argv[2])||4202).then(s=>console.log('Local fake database, no production or paid calls: '+s.url+'/site-walk-admin.html')).catch(e=>{console.error(e);process.exitCode=1;});
