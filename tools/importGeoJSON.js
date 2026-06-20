const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// 数据库连接配置
const dbConfig = {
  host: 'localhost',
  user: 'postgres',
  password: '123456', // ⚠️这里请改成你之前在安装时设置的密码！
  database: 'chuyun_db',
  port: 5432,
};

async function importData() {
  // 智能兼容：同时尝试寻找 .json 和 .geojson 后缀
  let filePath = path.join(__dirname, '../hubei_boundary.json');
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, '../hubei_boundary.geojson');
  }

  // 如果两个都没找到，才报错
  if (!fs.existsSync(filePath)) {
    console.error(`错误：未在项目根目录下找到 hubei_boundary.json 或 hubei_boundary.geojson 文件！`);
    return;
  }
  
  console.log(`已成功定位地图数据文件：${path.basename(filePath)}`);
  const geojsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log("成功连接本地数据库，正在开始导入湖北行政边界空间数据...");

    for (let feature of geojsonData.features) {
      const name = feature.properties.name;
      const level = feature.properties.level || 'city';
      const geometryStr = JSON.stringify(feature.geometry);

      const query = `
        INSERT INTO hubei_regions (name, level, geom)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326));
      `;

      await client.query(query, [name, level, geometryStr]);
      console.log(`✅ 成功导入：${name} (${level})`);
    }

    console.log("🎉 恭喜！湖北所有市级地理空间边界已导入完毕！");
  } catch (err) {
    console.error("❌ 导入过程中发生错误:", err.message);
  } finally {
    await client.end();
  }
}

importData();
