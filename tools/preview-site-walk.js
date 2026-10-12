'use strict';
require('./lib/site-walk-preview').start(Number(process.argv[2]||4199)).then(p=>console.log('LOCAL EXAMPLE ONLY, NOT AN ACTUAL ONSITE ROUTE: '+p.url)).catch(e=>{console.error(e.message);process.exitCode=1;});
