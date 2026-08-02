import L from "leaflet";

// leaflet.markercluster is a UMD that references the global `L`.
// Expose our bundled Leaflet on the global scope before markercluster runs.
if (typeof window !== "undefined" && !window.L) {
  window.L = L;
}

export default L;
