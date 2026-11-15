import Map from "ol/Map.js";
import View from "ol/View.js";
import TileLayer from "ol/layer/Tile.js";
import ImageTile from "ol/source/ImageTile.js";
import { fromLonLat } from "ol/proj.js";
import { nativeGrid, trafficExtent, toNative } from "../../custom_components/openmap/frontend/src/projection.js";

const map = new Map({ target: document.getElementById("map"), controls: [],
  pixelRatio: Math.min(devicePixelRatio, 2), maxTilesLoading: 8,
  view: new View({ center: fromLonLat([9.192, 48.892]), zoom: 14 }),
  layers: [new TileLayer({ extent: trafficExtent(), cacheSize: 32,
    source: new ImageTile({ projection: "EPSG:25832", tileGrid: nativeGrid(),
      url: "/api/openmap/traffic/bus/{z}/{x}/{y}.png", wrapX: false, transition: 0 }) })] });
window.probe = { map, native: toNative([9.192, 48.892]) };
