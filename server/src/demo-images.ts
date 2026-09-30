// Draws simple car pictures as PNGs for the demo data, so the demo needs no image files or network.
import { deflateSync } from "node:zlib";

type RGB = [number, number, number];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

class Canvas {
  px: Uint8Array;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.px = new Uint8Array(w * h * 3);
  }
  set(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) this.set(x, y, c);
  }
  /** Trapezoid with a horizontal top (tx0..tx1 at y0) and bottom (bx0..bx1 at y1). */
  trap(tx0: number, tx1: number, y0: number, bx0: number, bx1: number, y1: number, c: RGB) {
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      const t = (y - y0) / (y1 - y0);
      this.rect(tx0 + (bx0 - tx0) * t, y, tx1 + (bx1 - tx1) * t, y + 1, c);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c);
  }
  roundRect(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB) {
    this.rect(x0 + r, y0, x1 - r, y1, c);
    this.rect(x0, y0 + r, x1, y1 - r, c);
    for (const [cx, cy] of [[x0 + r, y0 + r], [x1 - r, y0 + r], [x0 + r, y1 - r], [x1 - r, y1 - r]]) this.circle(cx, cy, r, c);
  }
}

const shade = (c: RGB, f: number): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;

const BACKDROPS: [RGB, RGB, RGB][] = [
  [[196, 222, 245], [238, 244, 250], [150, 156, 162]],
  [[250, 214, 180], [252, 238, 222], [128, 120, 112]],
  [[214, 226, 214], [240, 245, 238], [120, 132, 118]],
];

/** A side or front view of a car in `colour`; `view` 0–2 picks the angle and backdrop. */
export function carPicture(colour: RGB, view: number, w = 800, h = 500): Buffer {
  const cv = new Canvas(w, h);
  const [top, bottom, ground] = BACKDROPS[view % BACKDROPS.length];
  const horizon = h * 0.72;
  for (let y = 0; y < h; y++) cv.rect(0, y, w, y + 1, y < horizon ? mix(top, bottom, y / horizon) : mix(ground, shade(ground, 0.8), (y - horizon) / (h - horizon)));
  const glass: RGB = [70, 96, 122];
  const tyre: RGB = [28, 28, 30];
  const hub: RGB = [176, 180, 186];
  if (view % 3 === 2) {
    // Front view.
    cv.roundRect(w * 0.24, h * 0.46, w * 0.76, h * 0.74, h * 0.04, colour);
    cv.trap(w * 0.34, w * 0.66, h * 0.3, w * 0.28, w * 0.72, h * 0.47, shade(colour, 0.9));
    cv.trap(w * 0.36, w * 0.64, h * 0.32, w * 0.31, w * 0.69, h * 0.45, glass);
    cv.rect(w * 0.4, h * 0.58, w * 0.6, h * 0.66, shade(colour, 0.35));
    cv.roundRect(w * 0.27, h * 0.52, w * 0.36, h * 0.57, h * 0.015, [250, 246, 220]);
    cv.roundRect(w * 0.64, h * 0.52, w * 0.73, h * 0.57, h * 0.015, [250, 246, 220]);
    cv.rect(w * 0.26, h * 0.74, w * 0.33, h * 0.8, tyre);
    cv.rect(w * 0.67, h * 0.74, w * 0.74, h * 0.8, tyre);
  } else {
    // Side view.
    cv.trap(w * 0.34, w * 0.6, h * 0.32, w * 0.25, w * 0.74, h * 0.5, shade(colour, 0.92));
    cv.trap(w * 0.36, w * 0.46, h * 0.35, w * 0.3, w * 0.46, h * 0.49, glass);
    cv.trap(w * 0.48, w * 0.58, h * 0.35, w * 0.48, w * 0.69, h * 0.49, glass);
    cv.roundRect(w * 0.12, h * 0.48, w * 0.88, h * 0.7, h * 0.05, colour);
    cv.rect(w * 0.14, h * 0.6, w * 0.86, h * 0.615, shade(colour, 0.75));
    cv.roundRect(w * 0.83, h * 0.52, w * 0.875, h * 0.56, h * 0.012, [250, 240, 200]);
    cv.roundRect(w * 0.125, h * 0.52, w * 0.15, h * 0.56, h * 0.01, [200, 40, 40]);
    for (const x of [0.28, 0.72]) {
      cv.circle(w * x, h * 0.7, h * 0.09, tyre);
      cv.circle(w * x, h * 0.7, h * 0.045, hub);
    }
  }
  return encodePng(w, h, cv.px);
}
