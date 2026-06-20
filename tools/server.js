// tools/server.js
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = 3000; // 本地服务运行在 3000 端口
const SECURE_KEY = "ChuYunLianJi@2026_Secret"; // 前后端约定的安全混淆密钥

// 允许跨域请求（方便前端 H5/小程序 调试连接）
app.use(cors());
app.use(express.json());

// 1. 配置你的本地数据库连接（必须匹配你的 chuyun_db 和密码）
const dbConfig = {
  host: 'localhost',
  user: 'postgres',
  password: '123456', // ⚠️这里请修改为你安装 PostgreSQL 时设置的密码！
  database: 'chuyun_db',      // 我们之前新建的数据库
  port: 5432,
};

// 2. 编写验证地理围栏的 API 接口
app.post('/api/verify-location', async (req, res) => {
  const { longitude, latitude, timestamp, deviceId, signature } = req.body;
  const now = Math.floor(Date.now() / 1000);

  // 校验参数完整性
  if (!longitude || !latitude || !timestamp || !deviceId || !signature) {
    return res.status(400).json({
      success: false,
      message: "缺少必要的位置安全校验参数！"
    });
  }

  // 1. 防重放攻击：校验上传时间戳，如果请求包发出超过 5 分钟，直接拒绝
  if (Math.abs(now - timestamp) > 300) {
    return res.status(403).json({
      success: false,
      message: "请求超时，疑似重放虚拟定位！"
    });
  }

  // 2. 校验哈希签名，防止用户抓包手动篡改经纬度数字
  const payload = `${parseFloat(longitude).toFixed(6)}|${parseFloat(latitude).toFixed(6)}|${timestamp}|${deviceId}`;
  const localSignature = crypto.createHmac('sha256', SECURE_KEY).update(payload).digest('hex');

  if (localSignature !== signature) {
    return res.status(401).json({
      success: false,
      message: "安全证书签名校验失败，经纬度已被恶意篡改！"
    });
  }

  // 3. 核心：连接 PostgreSQL，使用 PostGIS 空间函数进行碰撞计算
  const client = new Client(dbConfig);
  try {
    await client.connect();

    // 空间查询：ST_Contains 用来判定点（ST_Point）是否被包含在区域多边形（geom）内
    const queryText = `
      SELECT name, level 
      FROM hubei_regions 
      WHERE ST_Contains(geom, ST_SetSRID(ST_Point($1, $2), 4326))
      LIMIT 1;
    `;

    const dbResult = await client.query(queryText, [longitude, latitude]);

    if (dbResult.rows.length > 0) {
      // 成功判定在湖北省行政边界范围内
      const region = dbResult.rows[0];
      return res.json({
        success: true,
        regionName: region.name,
        regionLevel: region.level,
        message: `✅ 地理围栏安全校验通过！您当前位于：${region.name}`
      });
    } else {
      // 越界：超出了湖北省范围
      return res.status(400).json({
        success: false,
        message: "❌ 越界异常：您当前所在的位置不属于湖北非遗保护采集区范围内！"
      });
    }
  } catch (err) {
    console.error("数据库查询出错:", err.message);
    return res.status(500).json({
      success: false,
      message: "数据库异常: " + err.message
    });
  } finally {
    // 释放数据库连接
    await client.end();
  }
});

// 启动服务器监听
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 楚韵链迹本地后端安全服务器运行成功！`);
  console.log(`📍 监听本地端口: http://localhost:${PORT}`);
  console.log(`📡 地理围栏验证 API 已就绪: http://localhost:${PORT}/api/verify-location`);
  console.log(`=================================================`);
});