import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
const root = process.cwd();
function crc(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body));
  return Buffer.concat([size, body, checksum]);
}
// Synthetic raster evidence: a native-UTM cross at the Ludwigsburg reference.
// No live household data or geoportal requests are used by browser fixtures.
function tile(z, x, y, base = false) {
  const stride = 256 * 4 + 1;
  const data = Buffer.alloc(stride * 256);
  const span = 256 * 128 / 2 ** z;
  const px = (514073.7 - (490000 + x * span)) / span * 256;
  const py = (5440000 - y * span - 5415467.8) / span * 256;
  for (let row = 0; row < 256; row++) for (let col = 0; col < 256; col++) {
    const i = row * stride + 1 + col * 4;
    const cross = Math.abs(col - px) < 2 || Math.abs(row - py) < 2;
    data[i] = base ? 227 : 220; data[i + 1] = base ? 233 : 30;
    data[i + 2] = base ? 229 : 90; data[i + 3] = base || cross ? 255 : 0;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(data)), chunk("IEND", Buffer.alloc(0))]);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const match = url.pathname.match(/^\/api\/openmap\/traffic\/\w+\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (match) { res.setHeader("Content-Type", "image/png"); res.setHeader("X-OpenMap-Fetched-At", "1794651600"); res.end(tile(...match.slice(1).map(Number))); return; }
  if (url.pathname.startsWith("/basemap/")) { res.setHeader("Content-Type", "image/png"); res.end(tile(0, 0, 0, true)); return; }
  try {
    const fixture = { "/probe.js":"/tmp/opencode/openmap-probe.js", "/fixture-icons.js":"/tmp/opencode/openmap-icons.js" }[url.pathname];
    const filename = fixture || path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!fixture && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const types = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" };
    res.setHeader("Content-Type", types[path.extname(filename)] || "application/octet-stream");
    res.end(await fs.readFile(filename));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(8765, "127.0.0.1");
