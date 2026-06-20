const { Client } = require('pg');

// 1. 请在这里输入你确信正确的数据库密码
const PASSWORD_TO_TEST = '密码'; 

const dbConfig = {
  host: 'localhost',
  user: 'postgres',
  password: PASSWORD_TO_TEST, 
  database: 'chuyun_db',      
  port: 5432,
};

async function runDiagnostic() {
  console.log("=================================================");
  console.log("🔍 正在启动【楚韵链迹】数据库连接深度诊断...");
  console.log(`📍 尝试连接: localhost:${dbConfig.port}`);
  console.log(`👤 登录用户: ${dbConfig.user}`);
  console.log(`🗄️ 目标数据库: ${dbConfig.database}`);
  console.log("=================================================");

  const client = new Client(dbConfig);
  try {
    await client.connect();
    console.log("\n🎉 [诊断结果]: 恭喜！连接完全成功！密码是正确的！");
    console.log("👉 如果这里成功了，说明你的 `server.js` 没有重启或没有保存！");
  } catch (err) {
    console.log("\n❌ [诊断结果]: 连接失败！底层错误分析如下：\n");
    
    if (err.code === '28P01') {
      console.log(`🚨 错误代码: 28P01 (Password Authentication Failed)`);
      console.log(`👉 确定是密码不匹配！请排查以下 3 个最隐蔽的“低级失误”：`);
      console.log(`   1. 【文件未保存】：看看 HBuilderX 顶部的 \`server.js\` 标签页文件名旁是不是有一个“白色小圆点”？如果有，说明你改了密码但根本没按 Ctrl + S 保存！`);
      console.log(`   2. 【服务没重启】：Node.js 修改代码后，后台运行的进程不会自动更新！你必须在终端里按 Ctrl + C 强行结束 \`node tools/server.js\`，然后重新运行它，新密码才会生效！`);
      console.log(`   3. 【大小写或特殊字符】：检查你的密码里有没有 Caps Lock 大小写锁定了，或者多复制了空格？`);
    } else if (err.code === '3D000') {
      console.log(`🚨 错误代码: 3D000 (Database Does Not Exist)`);
      console.log(`👉 密码是对的，但是你本地没有创建名为 "${dbConfig.database}" 的数据库！`);
      console.log(`   请在 pgAdmin 中右键 Databases -> Create -> Database，命名为 chuyun_db。`);
    } else if (err.code === 'ECONNREFUSED') {
      console.log(`🚨 错误代码: ECONNREFUSED (Connection Refused)`);
      console.log(`👉 你的 PostgreSQL 服务根本没有启动，或者端口号不是 5432！`);
      console.log(`   请打开电脑的“服务”(services.msc)，找到 postgresql 服务并点击启动。`);
    } else {
      console.log(`🚨 错误代码: ${err.code || '未知'}`);
      console.log(`👉 详细报错信息: ${err.message}`);
    }
  } finally {
    await client.end();
    console.log("\n=================================================");
  }
}

runDiagnostic();