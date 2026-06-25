# Hubei offline map tiles

Place generated XYZ tiles here using this directory layout:

```text
static/tiles/hubei/{z}/{x}/{y}.png
```

The app is already configured in `static/map-config.js` to read this path.
Generate tiles in Web Mercator / XYZ / PNG format, with WGS84 longitude and
latitude data as the source. Recommended zoom range for demos: `6-14`.

Do not bulk-download tiles from `tile.openstreetmap.org`. Use a permitted data
source such as Geofabrik's Hubei OpenStreetMap extract, then render your own XYZ
tiles with QGIS, MapTiler, TileMill, or another local tile renderer.
