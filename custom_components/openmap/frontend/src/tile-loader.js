// Only fixed, same-origin traffic paths are accepted. No tokens enter URLs.
export class TileLoader {
  constructor(fetchWithAuth, limit = 4, queueLimit = 24) {
    this.fetch = fetchWithAuth;
    this.limit = limit;
    this.queueLimit = queueLimit;
    this.active = 0;
    this.queue = [];
    this.controller = new AbortController();
  }

  load(path, signal) {
    if (!/^\/api\/openmap\/traffic\/[a-z]+\/\d+\/\d+\/\d+\.png$/.test(path)) return Promise.reject(new Error("Invalid traffic path"));
    const combined = AbortSignal.any([signal, this.controller.signal].filter(Boolean));
    if (combined.aborted) return Promise.reject(combined.reason);
    if (this.queue.length >= this.queueLimit) return Promise.reject(new Error("Traffic queue is full"));
    return new Promise((resolve, reject) => {
      const job = { path, signal: combined, resolve, reject };
      job.abort = () => {
        const index = this.queue.indexOf(job);
        if (index >= 0) { this.queue.splice(index, 1); reject(combined.reason); }
      };
      combined.addEventListener("abort", job.abort, { once: true });
      this.queue.push(job);
      this._drain();
    });
  }

  _drain() {
    while (this.active < this.limit && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      this._fetchImage(job).then(job.resolve, job.reject).finally(() => {
        job.signal.removeEventListener("abort", job.abort);
        this.active--;
        this._drain();
      });
    }
  }

  async _fetchImage({ path, signal }) {
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(18000)]);
    const response = await this.fetch(path, { signal: boundedSignal, cache: "no-cache" });
    if (!response.ok) throw new Error(`Traffic request failed (${response.status})`);
    if (!["image/png", "image/gif"].includes(response.headers.get("Content-Type")?.split(";")[0])) throw new Error("Invalid traffic image type");
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error("Traffic image is too large");
        parts.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    boundedSignal.throwIfAborted();
    const fetchedAt = Number(response.headers.get("X-OpenMap-Fetched-At")) || null;
    const url = URL.createObjectURL(new Blob(parts, { type: response.headers.get("Content-Type") }));
    // HTMLImageElement avoids an ImageBitmap lifetime hidden inside OL's cache.
    // Revoking the blob URL releases the encoded bytes after decoding.
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        const cleanup = () => { image.onload = image.onerror = null; boundedSignal.removeEventListener("abort", abort); };
        const abort = () => { cleanup(); image.src = ""; reject(boundedSignal.reason); };
        image.onload = () => {
          cleanup();
          if (!((image.width === 256 && image.height === 256) || (image.width === 1 && image.height === 1))) reject(new Error("Invalid traffic image dimensions"));
          else { image.openmapFetchedAt = fetchedAt; resolve(image); }
        };
        image.onerror = () => { cleanup(); reject(new Error("Traffic image could not be decoded")); };
        boundedSignal.addEventListener("abort", abort, { once: true });
        if (boundedSignal.aborted) abort();
        else image.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }

  close() { this.controller.abort(); }
}
