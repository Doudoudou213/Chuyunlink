# 真实地图导入方法

当前页面使用 Leaflet 加载真实地图瓦片，配置文件在 `static/map-config.js`。

## 已预设的湖北离线瓦片接口

项目已配置为读取：

```js
tileUrl: './static/tiles/hubei/{z}/{x}/{y}.png'
```

因此瓦片目录必须是 Leaflet / OpenStreetMap 标准 XYZ 结构：

```text
static/
  tiles/
    hubei/
      6/
        50/
          25.png
      7/
        ...
```

## 推荐下载源

下载湖北省全域 OpenStreetMap 原始数据：

```text
https://download.geofabrik.de/asia/china/hubei.html
```

推荐文件：

- `hubei-latest.osm.pbf`：适合用渲染工具生成离线瓦片。
- `hubei-latest-free.gpkg.zip`：适合在 QGIS 中直接加载、配样式、再导出 XYZ。

不要批量抓取 `https://tile.openstreetmap.org/{z}/{x}/{y}.png` 在线瓦片做离线包；OSM 官方瓦片服务不允许这种离线预下载。应使用 Geofabrik 的 OSM 数据源，再本地渲染自己的瓦片。

## 坐标要求

本项目的 GPS、地标和湖北边界数据都按 WGS84 经纬度使用：

- 后端入库边界：`SRID 4326`
- 浏览器定位：`longitude / latitude`
- Leaflet 标记：`[latitude, longitude]`
- 瓦片目录：XYZ / Web Mercator / EPSG:3857

所以生成瓦片时请选择 OSM/XYZ/Web Mercator，不要使用高德、腾讯、百度这类带 GCJ-02 或 BD-09 偏移的底图，否则会和真实 GPS、湖北边界校验不对齐。

## QGIS 生成方式

1. 下载 `hubei-latest-free.gpkg.zip` 并解压。
2. 在 QGIS 中加载道路、水系、建筑、兴趣点等图层，按需要设置样式。
3. 打开 Processing Toolbox，使用 `Generate XYZ tiles (Directory)`。
4. Extent 使用湖北图层范围；Zoom 建议 `6-14`。
5. Tile format 选 `PNG`，Tile width/height 使用 `256`。
6. `Use inverted tile Y axis (TMS conventions)` 保持关闭。
7. 输出目录选择 `static/tiles/hubei`。

导出完成后刷新页面，地图会从本地目录读取湖北离线瓦片。

## 完全离线

如果演示现场完全不能联网，还需要把 Leaflet 自身放到本地：

```text
static/
  vendor/
    leaflet/
      leaflet.css
      leaflet.js
      images/
        marker-icon.png
        marker-shadow.png
```

然后把 `index.html` 头部 Leaflet CDN 地址替换为：

```html
<link rel="stylesheet" href="./static/vendor/leaflet/leaflet.css">
<script src="./static/vendor/leaflet/leaflet.js"></script>
```
