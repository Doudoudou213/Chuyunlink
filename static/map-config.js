// ChuLink map source configuration.
// The current default uses online Gaode tiles for better access in mainland China.
window.CHULINK_MAP_CONFIG = {
  tileUrl: 'https://webrd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
  attribution: '&copy; 高德地图',
  sourceLabel: '真实地图：高德在线瓦片',
  coordinateSystem: 'gcj02',
  minZoom: 6,
  maxZoom: 18,
  maxNativeZoom: 18,
  initialCenter: [31.2, 112.3],
  initialZoom: 7,
  bounds: [
    [29.0, 108.3],
    [33.4, 116.3]
  ]
};
