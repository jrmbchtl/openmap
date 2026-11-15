import { test } from "node:test";
import assert from "node:assert/strict";
import { TileLoader } from "../../custom_components/openmap/frontend/src/tile-loader.js";

const path = "/api/openmap/traffic/bus/5/23/23.png";

test("traffic streaming bound cancels a body without trusting Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(600000)); controller.enqueue(new Uint8Array(600000)); },
    cancel() { cancelled = true; },
  });
  const loader = new TileLoader(async () => new Response(body, { headers: { "Content-Type":"image/png" } }));
  await assert.rejects(loader.load(path), /too large/);
  assert.equal(cancelled, true);
  loader.close();
});

test("traffic loader rejects failed responses and non-image bodies before decoding", async () => {
  for (const response of [new Response("error", {status:503}), new Response("html", {headers:{"Content-Type":"text/html"}})]) {
    const loader = new TileLoader(async () => response);
    await assert.rejects(loader.load(path), /failed|Invalid traffic image type/);
    loader.close();
  }
});

test("decoded images revoke blob URLs on success, bad dimensions, and decode failure", async t => {
  const original = globalThis.Image;
  t.after(() => { if (original === undefined) delete globalThis.Image; else globalThis.Image = original; });
  let revoked = 0;
  t.mock.method(URL, "createObjectURL", () => "blob:fixture-only");
  t.mock.method(URL, "revokeObjectURL", () => { revoked++; });
  for (const [width, failure] of [[256,false], [2,false], [256,true]]) {
    globalThis.Image = class {
      width = width; height = width;
      set src(value) { if (value) queueMicrotask(() => failure ? this.onerror?.() : this.onload?.()); }
    };
    const loader = new TileLoader(async () => new Response(new Uint8Array([1]), {headers:{"Content-Type":"image/png","X-OpenMap-Fetched-At":"1794651600"}}));
    if (width === 256 && !failure) assert.equal((await loader.load(path)).openmapFetchedAt, 1794651600);
    else await assert.rejects(loader.load(path), /dimensions|decoded/);
    loader.close();
  }
  assert.equal(revoked, 3);
});
