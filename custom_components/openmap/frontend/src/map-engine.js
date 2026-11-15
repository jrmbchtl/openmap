import Map from "ol/Map.js";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import { circular } from "ol/geom/Polygon.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import XYZ from "ol/source/XYZ.js";
import ImageTile from "ol/source/ImageTile.js";
import VectorSource from "ol/source/Vector.js";
import Cluster from "ol/source/Cluster.js";
import { Style, Circle, Fill, Stroke, Text } from "ol/style.js";
import { fromLonLat } from "ol/proj.js";
import { createEmpty, extend, isEmpty } from "ol/extent.js";
import { unByKey } from "ol/Observable.js";
import { nativeGrid, trafficExtent } from "./projection.js";
import { markerText } from "./entities.js";
import { TileLoader } from "./tile-loader.js";

export class MapEngine {
  constructor({ target, config, dark, accent, fetchWithAuth, cartoKey, onSelect, onStatus }) {
    this.config = config;
    this.accent = /^#[\da-f]{6}$/i.test(accent || "") ? accent : "#1976d2";
    this.fetch = fetchWithAuth;
    this.loader = new TileLoader(fetchWithAuth);
    this.onStatus = onStatus;
    this.status = {};
    this.keys = [];
    this.traffic = new globalThis.Map();
    this.features = new globalThis.Map();
    this.points = new VectorSource({ wrapX: false });
    this.rings = new VectorSource({ wrapX: false });
    this.cluster = new Cluster({ distance: 48, minDistance: 16, source: this.points, wrapX: false });
    this.clusterStyles = new globalThis.Map();
    this.base = new TileLayer({ cacheSize: 64, source: new XYZ({
      url: config.basemap === "carto" && cartoKey ? `https://a.basemaps.cartocdn.com/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}.png?api_key=${encodeURIComponent(cartoKey)}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      crossOrigin: "anonymous", referrerPolicy: "no-referrer", maxZoom: 19, transition: 0, wrapX: false,
    }) });
    this._watch(this.base.getSource(), "basemap");
    const layers = [this.base];
    for (const overlay of config.overlay_layers) {
      const layer = new TileLayer({ extent: trafficExtent(), visible: false, opacity: overlay.opacity, cacheSize: 32 });
      this.traffic.set(overlay.preset, { layer, loader: null });
      layers.push(layer);
    }
    layers.push(new VectorLayer({ source: this.rings }), new VectorLayer({
      source: config.cluster ? this.cluster : this.points,
      style: feature => {
        const children = feature.get("features");
        if (!children) return feature.get("markerStyle");
        if (children.length === 1) return children[0].get("markerStyle");
        const count = children.length;
        if (!this.clusterStyles.has(count)) this.clusterStyles.set(count, this._marker(String(count), this.accent));
        return this.clusterStyles.get(count);
      },
    }));
    this.map = new Map({ target, layers, controls: [], pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2), maxTilesLoading: 8,
      view: new View({ center: fromLonLat(config.center ? [config.center[1], config.center[0]] : [9.192, 48.892]), zoom: config.default_zoom, minZoom: 0, maxZoom: 20, enableRotation: false }) });
    this.keys.push(this.map.on("singleclick", event => {
      this.map.forEachFeatureAtPixel(event.pixel, feature => {
        const children = feature.get("features") || [feature];
        if (children.length > 1) this.fit(children.map(f => f.getId()));
        onSelect(children.map(f => f.getId()));
        return true;
      }, { hitTolerance: 10, layerFilter: layer => layer.getSource() !== this.rings });
    }));
  }

  _watch(source, id) {
    const state = this.status[id] = { loading: 0, error: false };
    const update = () => { if (!this.disposed) this.onStatus({ ...this.status }); };
    const keys = [source.on("tileloadstart", () => { state.loading++; update(); }),
      source.on("tileloadend", event => { state.loading = Math.max(0, state.loading - 1); state.fetchedAt = event.tile.getData?.()?.openmapFetchedAt || state.fetchedAt; update(); }),
      source.on("tileloaderror", () => { state.loading = Math.max(0, state.loading - 1); state.error = true; update(); })];
    if (id === "basemap") this.keys.push(...keys);
    return keys;
  }

  setTraffic(preset, visible) {
    const entry = this.traffic.get(preset);
    if (!entry || entry.layer.getVisible() === visible) return;
    if (visible) {
      entry.controller = new AbortController();
      const source = new ImageTile({ projection: "EPSG:25832", tileGrid: nativeGrid(), wrapX: false, transition: 0,
        loader: (z, x, y, options) => this.loader.load(`/api/openmap/traffic/${preset}/${z}/${x}/${y}.png`, AbortSignal.any([options.signal, entry.controller.signal])) });
      entry.keys = this._watch(source, preset);
      entry.layer.setSource(source);
    } else {
      unByKey(entry.keys || []);
      entry.controller?.abort();
      entry.layer.getSource()?.dispose();
      entry.layer.setSource(null);
      delete this.status[preset];
    }
    entry.layer.setVisible(visible);
  }

  _marker(text, fill) {
    return new Style({ image: new Circle({ radius: this.config.marker.size / 2, fill: new Fill({ color: fill }), stroke: new Stroke({ color: "#ffffff", width: 2 }) }),
      text: new Text({ text, font: "600 12px Roboto, sans-serif", fill: new Fill({ color: "#ffffff" }), stroke: new Stroke({ color: "#000000", width: 2 }) }), zIndex: 10 });
  }

  update(records) {
    const seen = new Set();
    const added = [];
    for (const record of records) {
      if (!record.mapped) continue;
      seen.add(record.id);
      let feature = this.features.get(record.id);
      if (!feature) {
        feature = new Feature(new Point(fromLonLat([record.lon, record.lat])));
        feature.setId(record.id);
        this.features.set(record.id, feature);
        added.push(feature);
      }
      const previous = feature.get("record");
      if (previous?.lat !== record.lat || previous?.lon !== record.lon) feature.getGeometry().setCoordinates(fromLonLat([record.lon, record.lat]));
      if (previous?.name !== record.name || previous?.state?.state !== record.state?.state || previous?.color !== record.color) {
        feature.set("markerStyle", this._marker(this.config.marker.label_mode === "icon" ? "" : markerText(record, this.config.marker.label_mode), record.color || this.accent));
      }
      if (previous?.lat !== record.lat || previous?.lon !== record.lon || previous?.radius !== record.radius || previous?.accuracy !== record.accuracy) {
        const oldRing = this.rings.getFeatureById(record.id);
        if (oldRing) this.rings.removeFeature(oldRing);
        const radius = record.zone ? record.radius : record.accuracy;
        if (radius > 0) {
          const ring = new Feature(circular([record.lon, record.lat], radius, 64).transform("EPSG:4326", "EPSG:3857"));
          ring.setId(record.id);
          ring.setStyle(new Style({ fill: new Fill({ color: `${record.color || this.accent}20` }), stroke: new Stroke({ color: record.color || this.accent, width: 1.5, lineDash: record.zone ? undefined : [4, 4] }) }));
          this.rings.addFeature(ring);
        }
      }
      feature.set("record", record, true);
    }
    for (const [id, feature] of this.features) if (!seen.has(id)) {
      this.points.removeFeature(feature);
      const ring = this.rings.getFeatureById(id);
      if (ring) this.rings.removeFeature(ring);
      this.features.delete(id);
    }
    if (added.length) this.points.addFeatures(added);
    if (!this.initialFit && records.some(r => r.mapped)) {
      this.initialFit = true;
      if (!this.config.center) this.fit();
    }
  }

  fit(ids, padding = [64, 64, 64, 64]) {
    const extent = createEmpty();
    for (const [id, feature] of this.features) if (!ids || ids.includes(id)) extend(extent, feature.getGeometry().getExtent());
    if (!isEmpty(extent)) this.map.getView().fit(extent, { padding, maxZoom: this.config.default_zoom, duration: 0 });
  }
  focus(id, padding) { this.fit([id], padding); }
  focusTraffic(padding = [48, 48, 48, 48]) { this.map.getView().fit(trafficExtent(), { padding, maxZoom: 12, duration: 0 }); }
  zoom(delta) { const view = this.map.getView(); view.setZoom(view.getZoom() + delta); }
  resize() { this.map.updateSize(); }
  retry() {
    for (const state of Object.values(this.status)) state.error = false;
    this.base.getSource().refresh();
    for (const [preset, entry] of this.traffic) if (entry.layer.getVisible()) { this.setTraffic(preset, false); this.setTraffic(preset, true); }
    this.onStatus({ ...this.status });
  }
  dispose() {
    this.disposed = true;
    unByKey(this.keys);
    this.loader.close();
    for (const entry of this.traffic.values()) { unByKey(entry.keys || []); entry.controller?.abort(); entry.layer.getSource()?.dispose(); entry.layer.dispose(); }
    this.map.dispose();
    this.cluster.setSource(null);
    this.cluster.dispose();
    this.points.clear(); this.rings.clear();
    this.points.dispose(); this.rings.dispose();
    this.base.getSource().dispose(); this.base.dispose();
    this.features.clear(); this.clusterStyles.clear();
    this.fetch = null;
  }
}
