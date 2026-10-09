'use strict';
require('./lib/guide-question-preview').start(Number(process.argv[2]||4198)).then(p=>console.log('LOCAL FIXED RESPONSES ONLY: '+p.url)).catch(e=>{console.error(e.message);process.exitCode=1;});
