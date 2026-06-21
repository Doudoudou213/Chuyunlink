// ChuLink map source configuration.
// Online mode uses public OpenStreetMap tiles.
// Offline mode: download tiles into static/tiles/{z}/{x}/{y}.png, then set tileUrl below to './static/tiles/{z}/{x}/{y}.png'.
window.CHULINK_MAP_CONFIG = {
  tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  minZoom: 6,
  maxZoom: 18,
  initialCenter: [31.2, 112.3],
  initialZoom: 7
};
