# 真实地图导入方法

当前页面使用 Leaflet 加载真实地图瓦片，配置文件在 `static/map-config.js`。

## 在线地图

默认配置使用 OpenStreetMap 在线瓦片：

```js
tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
```

这种方式不需要提前下载地图，但演示设备需要联网。

## 离线地图

如果需要提前导入一份地图，请把瓦片按 Leaflet 标准目录放入：

```text
static/
  tiles/
    6/
      50/
        25.png
    7/
      ...
```

目录规则是：

```text
static/tiles/{z}/{x}/{y}.png
```

然后把 `static/map-config.js` 改成：

```js
window.CHULINK_MAP_CONFIG = {
  tileUrl: './static/tiles/{z}/{x}/{y}.png',
  attribution: '本地离线瓦片',
  minZoom: 6,
  maxZoom: 18,
  initialCenter: [31.2, 112.3],
  initialZoom: 7
};
```

建议只下载湖北区域和演示需要的缩放级别，例如 `6-14`，否则全国高精度瓦片会非常大。

## 完全离线

如果演示现场完全不能联网，还需要把 Leaflet 本身也放到本地：

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

然后把 `index.html` 头部的 Leaflet CDN 地址替换为：

```html
<link rel="stylesheet" href="./static/vendor/leaflet/leaflet.css">
<script src="./static/vendor/leaflet/leaflet.js"></script>
```
