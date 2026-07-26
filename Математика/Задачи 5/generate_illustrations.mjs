/**
 * Generates child-friendly coordinate-ray PNG illustrations (no deps).
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "иллюстрации");
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

class Canvas {
  constructor(w, h, bg = [248, 250, 252, 255]) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      this.data[i * 4] = bg[0];
      this.data[i * 4 + 1] = bg[1];
      this.data[i * 4 + 2] = bg[2];
      this.data[i * 4 + 3] = bg[3];
    }
  }
  set(x, y, r, g, b, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const aa = a / 255;
    const inv = 1 - aa;
    this.data[i] = Math.round(r * aa + this.data[i] * inv);
    this.data[i + 1] = Math.round(g * aa + this.data[i + 1] * inv);
    this.data[i + 2] = Math.round(b * aa + this.data[i + 2] * inv);
    this.data[i + 3] = 255;
  }
  fillRect(x0, y0, w, h, color) {
    const [r, g, b, a = 255] = color;
    for (let y = Math.floor(y0); y < y0 + h; y++)
      for (let x = Math.floor(x0); x < x0 + w; x++) this.set(x, y, r, g, b, a);
  }
  fillCircle(cx, cy, rad, color) {
    const [r, g, b, a = 255] = color;
    const r2 = rad * rad;
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++)
        if (x * x + y * y <= r2) this.set(cx + x, cy + y, r, g, b, a);
  }
  line(x0, y0, x1, y1, color, thickness = 2) {
    const dx = x1 - x0,
      dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.fillCircle(x0 + dx * t, y0 + dy * t, thickness / 2, color);
    }
  }
  glyph(ch) {
    const G = {
      "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
      "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
      "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
      "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
      "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
      "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
      "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
      "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
      "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
      "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
      A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
      B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
      C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
      D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
      M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
      O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
      m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
      s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
      "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
      "=": ["00000", "11111", "00000", "00000", "11111", "00000", "00000"],
      ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
      " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
      "(": ["00100", "01000", "01000", "01000", "01000", "01000", "00100"],
      ")": ["00100", "00010", "00010", "00010", "00010", "00010", "00100"],
      "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
      e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
      d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
      u: ["00000", "00000", "10001", "10001", "10001", "10001", "01111"],
      n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
      i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
      t: ["01000", "01000", "11110", "01000", "01000", "01001", "00110"],
      c: ["00000", "00000", "01110", "10000", "10000", "10000", "01110"],
      "м": ["00000", "00000", "10001", "11011", "10101", "10001", "10001"],
    };
    return G[ch] || G[" "];
  }
  text(str, x, y, color, scale = 2) {
    let cx = x;
    for (const ch of str) {
      const rows = this.glyph(ch);
      for (let ry = 0; ry < 7; ry++)
        for (let rx = 0; rx < 5; rx++)
          if (rows[ry][rx] === "1")
            this.fillRect(cx + rx * scale, y + ry * scale, scale, scale, color);
      cx += 6 * scale;
    }
  }
  drawHouse(cx, baseY) {
    this.fillRect(cx - 18, baseY - 28, 36, 28, [66, 133, 244]);
    for (let i = 0; i < 24; i++) {
      const half = 24 - i;
      this.line(cx - half, baseY - 28 - i, cx + half, baseY - 28 - i, [198, 40, 40], 1);
    }
    this.fillRect(cx - 5, baseY - 16, 10, 16, [121, 85, 72]);
    this.fillRect(cx - 14, baseY - 22, 8, 8, [255, 235, 59]);
  }
  drawSchool(cx, baseY) {
    this.fillRect(cx - 22, baseY - 32, 44, 32, [76, 175, 80]);
    this.fillRect(cx - 6, baseY - 14, 12, 14, [121, 85, 72]);
    this.fillRect(cx - 16, baseY - 26, 8, 8, [255, 255, 255]);
    this.fillRect(cx + 8, baseY - 26, 8, 8, [255, 255, 255]);
    this.line(cx, baseY - 32, cx, baseY - 52, [97, 97, 97], 2);
    this.fillRect(cx + 1, baseY - 52, 14, 9, [244, 67, 54]);
  }
  drawChild(cx, baseY, shirt = [33, 150, 243]) {
    this.fillCircle(cx, baseY - 34, 7, [255, 204, 188]);
    this.fillRect(cx - 8, baseY - 26, 16, 18, shirt);
    this.fillRect(cx - 8, baseY - 8, 6, 10, [63, 81, 181]);
    this.fillRect(cx + 2, baseY - 8, 6, 10, [63, 81, 181]);
  }
  drawDog(cx, baseY) {
    this.fillRect(cx - 14, baseY - 18, 28, 14, [141, 110, 99]);
    this.fillCircle(cx + 12, baseY - 20, 8, [141, 110, 99]);
    this.fillRect(cx - 12, baseY - 4, 5, 8, [93, 64, 55]);
    this.fillRect(cx + 6, baseY - 4, 5, 8, [93, 64, 55]);
    this.fillCircle(cx + 16, baseY - 22, 2, [0, 0, 0]);
  }
  drawTree(cx, baseY) {
    this.fillRect(cx - 4, baseY - 20, 8, 20, [121, 85, 72]);
    this.fillCircle(cx, baseY - 32, 14, [67, 160, 71]);
  }
  drawRay({ originX, y, maxUnits, unitPx, labels = {}, points = {}, highlightUnit = null }) {
    const endX = originX + maxUnits * unitPx + 40;
    this.line(originX, y, endX, y, [33, 33, 33], 3);
    this.line(endX, y, endX - 14, y - 8, [33, 33, 33], 3);
    this.line(endX, y, endX - 14, y + 8, [33, 33, 33], 3);
    for (let u = 0; u <= maxUnits; u++) {
      const x = originX + u * unitPx;
      this.line(x, y - 10, x, y + 10, [66, 66, 66], 2);
      const lab = labels[u] !== undefined ? String(labels[u]) : String(u);
      const tw = lab.length * 12;
      this.text(lab, x - tw / 2, y + 18, [33, 33, 33], 2);
    }
    this.text("O", originX - 8, y - 36, [198, 40, 40], 2);
    this.fillCircle(originX, y, 5, [198, 40, 40]);
    if (highlightUnit) {
      const [a, b] = highlightUnit;
      const x1 = originX + a * unitPx;
      const x2 = originX + b * unitPx;
      this.line(x1, y - 52, x2, y - 52, [25, 118, 210], 2);
      this.line(x1, y - 56, x1, y - 48, [25, 118, 210], 2);
      this.line(x2, y - 56, x2, y - 48, [25, 118, 210], 2);
      this.text("1", (x1 + x2) / 2 - 6, y - 74, [25, 118, 210], 2);
    }
    for (const [name, u] of Object.entries(points)) {
      const x = originX + u * unitPx;
      this.fillCircle(x, y, 6, [156, 39, 176]);
      this.text(name, x - 6, y - 38, [156, 39, 176], 2);
    }
  }
  save(file) {
    fs.writeFileSync(file, encodePNG(this.w, this.h, this.data));
    console.log("wrote", file);
  }
}

// Task 1
{
  const c = new Canvas(900, 320, [232, 245, 233, 255]);
  c.drawTree(780, 160);
  c.drawRay({
    originX: 80,
    y: 180,
    maxUnits: 8,
    unitPx: 90,
    highlightUnit: [0, 1],
    points: { A: 2, B: 5, C: 7 },
  });
  c.save(path.join(OUT, "zadacha_01.png"));
}

// Task 2
{
  const c = new Canvas(900, 340, [227, 242, 253, 255]);
  c.drawRay({
    originX: 70,
    y: 180,
    maxUnits: 9,
    unitPx: 80,
    points: { A: 3, B: 8 },
  });
  const ox = 70,
    y = 180,
    up = 80;
  const xA = ox + 3 * up,
    xB = ox + 8 * up;
  c.line(xA, y + 58, xB, y + 58, [244, 67, 54], 2);
  c.line(xA, y + 52, xA, y + 64, [244, 67, 54], 2);
  c.line(xB, y + 52, xB, y + 64, [244, 67, 54], 2);
  c.text("AB", (xA + xB) / 2 - 14, y + 72, [244, 67, 54], 2);
  c.text("1 unit = 1 cm", 680, 30, [21, 101, 192], 2);
  c.save(path.join(OUT, "zadacha_02.png"));
}

// Task 3 — house to school, unit = 20 m
{
  const c = new Canvas(980, 380, [255, 243, 224, 255]);
  const ox = 90,
    y = 220,
    up = 100,
    maxU = 7;
  c.drawRay({
    originX: ox,
    y,
    maxUnits: maxU,
    unitPx: up,
    labels: { 0: "0", 1: "20", 2: "40", 3: "60", 4: "80", 5: "100", 6: "120", 7: "140" },
    points: {},
  });
  c.fillCircle(ox + 5 * up, y, 6, [156, 39, 176]);
  c.drawHouse(ox, y - 12);
  c.drawSchool(ox + 5 * up, y - 12);
  // label A above the school so it is not covered
  c.text("A", ox + 5 * up - 6, y - 78, [156, 39, 176], 2);
  c.text("1 unit = 20 m", 720, 30, [230, 81, 0], 2);
  c.save(path.join(OUT, "zadacha_03.png"));
}

// Task 4
{
  const c = new Canvas(960, 340, [243, 229, 245, 255]);
  c.drawRay({
    originX: 70,
    y: 180,
    maxUnits: 10,
    unitPx: 80,
    highlightUnit: [0, 1],
    points: { A: 2, B: 5, C: 9 },
  });
  c.save(path.join(OUT, "zadacha_04.png"));
}

// Task 5 — boy M and dog D
{
  const c = new Canvas(1000, 400, [224, 247, 250, 255]);
  const ox = 80,
    y = 250,
    up = 70,
    maxU = 11;
  const labels = {};
  for (let i = 0; i <= maxU; i++) labels[i] = String(i * 10);
  c.drawRay({
    originX: ox,
    y,
    maxUnits: maxU,
    unitPx: up,
    labels,
    points: {},
  });
  c.drawChild(ox + 2 * up, y - 12, [33, 150, 243]);
  c.drawDog(ox + 8 * up, y - 8);
  c.text("M", ox + 2 * up - 6, y - 72, [33, 150, 243], 2);
  c.text("D", ox + 8 * up - 6, y - 72, [141, 110, 99], 2);
  c.line(ox + 2 * up + 18, y - 95, ox + 2 * up + 58, y - 95, [33, 150, 243], 2);
  c.line(ox + 2 * up + 58, y - 95, ox + 2 * up + 50, y - 101, [33, 150, 243], 2);
  c.line(ox + 2 * up + 58, y - 95, ox + 2 * up + 50, y - 89, [33, 150, 243], 2);
  c.text("4 m/s", ox + 2 * up + 16, y - 120, [33, 150, 243], 2);
  c.line(ox + 8 * up - 18, y - 95, ox + 8 * up - 58, y - 95, [141, 110, 99], 2);
  c.line(ox + 8 * up - 58, y - 95, ox + 8 * up - 50, y - 101, [141, 110, 99], 2);
  c.line(ox + 8 * up - 58, y - 95, ox + 8 * up - 50, y - 89, [141, 110, 99], 2);
  c.text("6 m/s", ox + 8 * up - 70, y - 120, [141, 110, 99], 2);
  c.text("1 unit = 10 m", 760, 30, [0, 105, 92], 2);
  c.save(path.join(OUT, "zadacha_05.png"));
}

console.log("Done:", OUT);
