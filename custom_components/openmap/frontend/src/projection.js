import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";
import { get, transform, transformExtent } from "ol/proj.js";
import TileGrid from "ol/tilegrid/TileGrid.js";

// The server uses this same fixed native grid. No bbox-only "reprojection".
export const NATIVE_EXTENT = [490000, 5390000, 540000, 5440000];
export const NATIVE_RESOLUTIONS = Array.from({ length: 10 }, (_, z) => 128 / 2 ** z);
proj4.defs("EPSG:25832", "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs");
register(proj4);
get("EPSG:25832").setExtent(NATIVE_EXTENT);

export function nativeGrid() {
  return new TileGrid({ extent: NATIVE_EXTENT, origin: [490000, 5440000],
    resolutions: NATIVE_RESOLUTIONS, tileSize: 256 });
}

export const trafficExtent = () => transformExtent(NATIVE_EXTENT, "EPSG:25832", "EPSG:3857", 16);
export const toNative = (lonlat) => transform(lonlat, "EPSG:4326", "EPSG:25832");
