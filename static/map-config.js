// ChuLink map source configuration.
// Offline Hubei tiles use the Leaflet/OSM XYZ layout:
// static/tiles/hubei/{z}/{x}/{y}.png
window.CHULINK_MAP_CONFIG = {
  tileUrl: './static/tiles/hubei/{z}/{x}/{y}.png',
  attribution: 'Offline Hubei map tiles | &copy; OpenStreetMap contributors',
  sourceLabel: '真实地图：湖北离线瓦片',
  minZoom: 6,
  maxZoom: 14,
  maxNativeZoom: 14,
  initialCenter: [31.2, 112.3],
  initialZoom: 7,
  bounds: [
    [29.0, 108.3],
    [33.4, 116.3]
  ]
};
