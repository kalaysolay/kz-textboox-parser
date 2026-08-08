#!/usr/bin/env node
/**
 * Renders a Damulab illustration scene-spec to SVG (optional PNG via @resvg/resvg-js).
 *
 * Usage (from repo root):
 *   node content/tools/render-illustration-svg.js --scene scene.json --out path/q01.svg
 *   node content/tools/render-illustration-svg.js --scene scene.json --out path/q01.svg --png
 *   node content/tools/render-illustration-svg.js --stdin --out path/q01.svg < scene.json
 *
 * Supported scene.kind:
 *   coordinate_ray | number_line_decimals | angle | set_venn | set_euler | bar_chart | polygon
 *   parallelepiped | net_parallelepiped
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STYLE = {
  bg: "#ffffff",
  stroke: "#1a1a1a",
  strokeMuted: "#555555",
  fillSoft: "rgba(100, 149, 237, 0.22)",
  fillSoftB: "rgba(244, 164, 96, 0.28)",
  fillOverlap: "rgba(120, 180, 120, 0.35)",
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 16,
  strokeWidth: 1.75,
};

function usage() {
  console.error(`Usage:
  node content/tools/render-illustration-svg.js --scene <file.json> --out <file.svg> [--png]
  node content/tools/render-illustration-svg.js --stdin --out <file.svg> [--png]

Scene JSON must include "kind" (or top-level scene.kind).`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { scene: null, out: null, png: false, stdin: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scene") args.scene = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--png") args.png = true;
    else if (a === "--stdin") args.stdin = true;
    else if (a === "--help" || a === "-h") usage();
    else {
      console.error("Unknown arg:", a);
      usage();
    }
  }
  if (!args.out || (!args.scene && !args.stdin)) usage();
  return args;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgWrap(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${STYLE.bg}"/>
${body}
</svg>
`;
}

function text(x, y, label, opts = {}) {
  const size = opts.size ?? STYLE.fontSize;
  const anchor = opts.anchor ?? "middle";
  const fill = opts.fill ?? STYLE.stroke;
  const weight = opts.weight ?? "normal";
  return `  <text x="${x}" y="${y}" fill="${fill}" font-family="${STYLE.fontFamily}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle">${esc(label)}</text>`;
}

function loadScene(args) {
  let raw;
  if (args.stdin) {
    raw = fs.readFileSync(0, "utf8");
  } else {
    raw = fs.readFileSync(path.resolve(args.scene), "utf8");
  }
  const data = JSON.parse(raw);
  const scene = data.scene && data.kind == null ? data.scene : data;
  if (!scene.kind) throw new Error('Scene must have "kind"');
  return scene;
}

/** coordinate_ray / number_line_decimals */
function renderRay(scene) {
  const width = scene.width ?? 720;
  const height = scene.height ?? 240;
  const padL = 48;
  const padR = 36;
  const y = height * 0.58;
  const unitCount = scene.unitCount ?? 8;
  const usable = width - padL - padR;
  const unitPx = usable / unitCount;
  const originX = padL;
  const originLabel = scene.originLabel ?? "O";
  const tickStart = scene.tickStart ?? 0;
  const labels = scene.labels ?? null;
  const points = scene.points ?? [];

  const parts = [];
  // ray
  parts.push(
    `  <line x1="${originX}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
  );
  // arrow
  parts.push(
    `  <polygon points="${width - 20},${y} ${width - 34},${y - 7} ${width - 34},${y + 7}" fill="${STYLE.stroke}"/>`
  );

  for (let i = 0; i <= unitCount; i++) {
    const x = originX + i * unitPx;
    const tickH = i === 0 ? 12 : 9;
    parts.push(
      `  <line x1="${x}" y1="${y - tickH}" x2="${x}" y2="${y + tickH}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
    const lab =
      labels && labels[String(i)] != null
        ? String(labels[String(i)])
        : labels && labels[i] != null
          ? String(labels[i])
          : String(tickStart + i);
    if (i === 0 && originLabel && lab === "0") {
      parts.push(text(x, y + 28, originLabel, { size: 15 }));
      parts.push(text(x, y + 48, "0", { size: 13, fill: STYLE.strokeMuted }));
    } else {
      parts.push(text(x, y + 28, lab, { size: 14 }));
    }
  }

  for (const p of points) {
    const value = Number(p.value);
    const x = originX + (value - tickStart) * unitPx;
    parts.push(`  <circle cx="${x}" cy="${y}" r="5" fill="${STYLE.stroke}"/>`);
    parts.push(text(x, y - 22, p.id ?? "", { size: 16, weight: "bold" }));
  }

  return { width, height, body: parts.join("\n") };
}

/** angle: vertex + rays (+ optional arcs / interior points)
 *
 * Simple mode: degrees, startDegrees, armALabel, armCLabel, vertexLabel,
 *   showArc, showDegree.
 * Multi-ray mode: rays: [{ label, deg }], optional arcs:
 *   [{ fromDeg, toDeg, label?, radius? }], optional points:
 *   [{ id, deg, t }] with t in (0,1] along rayLength.
 * Optional: rightAngleMarks: [{ fromDeg, toDeg, size? }]
 * Optional: triangleOverlay: { legA: {deg,t}, legB: {deg,t} } — set square legs
 * Optional: figures: [ {cx,cy,rayLength,...} ] — several angles on one canvas
 */
function resolveAngleRays(fig) {
  if (Array.isArray(fig.rays) && fig.rays.length >= 2) {
    return fig.rays.map((ray) => ({
      label: ray.label ?? "",
      deg: Number(ray.deg),
    }));
  }
  const deg = Number(fig.degrees ?? 60);
  const startDeg = Number(fig.startDegrees ?? 0);
  return [
    { label: fig.armALabel ?? "A", deg: startDeg },
    { label: fig.armCLabel ?? "C", deg: startDeg + deg },
  ];
}

function appendAngleFigure(parts, fig) {
  const cx = fig.cx;
  const cy = fig.cy;
  const r = fig.rayLength;
  const toRad = (d) => (-d * Math.PI) / 180;
  const vertex = fig.vertexLabel ?? "B";
  const rays = resolveAngleRays(fig);

  if (fig.triangleOverlay) {
    const a = fig.triangleOverlay.legA;
    const b = fig.triangleOverlay.legB;
    const ax = cx + r * Number(a.t) * Math.cos(toRad(Number(a.deg)));
    const ay = cy + r * Number(a.t) * Math.sin(toRad(Number(a.deg)));
    const bx = cx + r * Number(b.t) * Math.cos(toRad(Number(b.deg)));
    const by = cy + r * Number(b.t) * Math.sin(toRad(Number(b.deg)));
    parts.push(
      `  <polygon points="${cx},${cy} ${ax},${ay} ${bx},${by}" fill="${STYLE.fillSoft}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
  }

  for (const ray of rays) {
    const x = cx + r * Math.cos(toRad(ray.deg));
    const y = cy + r * Math.sin(toRad(ray.deg));
    parts.push(
      `  <line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
  }
  parts.push(`  <circle cx="${cx}" cy="${cy}" r="3.5" fill="${STYLE.stroke}"/>`);

  const drawArc = (fromDeg, toDeg, arcR, label) => {
    const sweep = ((toDeg - fromDeg) % 360 + 360) % 360;
    if (sweep === 0) return;
    const ax1 = cx + arcR * Math.cos(toRad(fromDeg));
    const ay1 = cy + arcR * Math.sin(toRad(fromDeg));
    const ax2 = cx + arcR * Math.cos(toRad(toDeg));
    const ay2 = cy + arcR * Math.sin(toRad(toDeg));
    const large = sweep > 180 ? 1 : 0;
    parts.push(
      `  <path d="M ${ax1} ${ay1} A ${arcR} ${arcR} 0 ${large} 0 ${ax2} ${ay2}" fill="none" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
    if (label) {
      const mid = fromDeg + sweep / 2;
      const lx = cx + (arcR + 18) * Math.cos(toRad(mid));
      const ly = cy + (arcR + 18) * Math.sin(toRad(mid));
      parts.push(text(lx, ly, label, { size: 14 }));
    }
  };

  for (const mark of fig.rightAngleMarks ?? []) {
    const fromDeg = Number(mark.fromDeg);
    const toDeg = Number(mark.toDeg);
    const size = Number(mark.size ?? 14);
    const ux = Math.cos(toRad(fromDeg));
    const uy = Math.sin(toRad(fromDeg));
    const vx = Math.cos(toRad(toDeg));
    const vy = Math.sin(toRad(toDeg));
    const p1x = cx + size * ux;
    const p1y = cy + size * uy;
    const p2x = cx + size * ux + size * vx;
    const p2y = cy + size * uy + size * vy;
    const p3x = cx + size * vx;
    const p3y = cy + size * vy;
    parts.push(
      `  <polyline points="${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}" fill="none" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
  }

  if (Array.isArray(fig.arcs) && fig.arcs.length) {
    let i = 0;
    for (const arc of fig.arcs) {
      const fromDeg = Number(arc.fromDeg);
      const toDeg = Number(arc.toDeg);
      const arcR =
        arc.radius != null
          ? Number(arc.radius)
          : Math.min(56, r * 0.28) + i * 14;
      drawArc(fromDeg, toDeg, arcR, arc.label ?? null);
      i++;
    }
  } else if (fig.showArc !== false && rays.length === 2) {
    const fromDeg = rays[0].deg;
    const toDeg = rays[1].deg;
    const sweep = ((toDeg - fromDeg) % 360 + 360) % 360;
    const arcR = Math.min(56, r * 0.28);
    const label =
      fig.showDegree === true ? `${Math.round(sweep)}°` : null;
    drawArc(fromDeg, toDeg, arcR, label);
  }

  const labelR = r + 14;
  for (const ray of rays) {
    if (!ray.label) continue;
    parts.push(
      text(
        cx + labelR * Math.cos(toRad(ray.deg)),
        cy + labelR * Math.sin(toRad(ray.deg)),
        ray.label,
        { size: 16, weight: "bold" }
      )
    );
  }

  if (vertex) {
    const vOff = fig.vertexOffset ?? { x: -14, y: 4 };
    parts.push(
      text(cx + vOff.x, cy + vOff.y, vertex, {
        size: 16,
        weight: "bold",
        anchor: fig.vertexAnchor ?? "end",
      })
    );
  }

  for (const p of fig.points ?? []) {
    const t = Number(p.t ?? 0.5);
    const deg = Number(p.deg);
    const px = cx + r * t * Math.cos(toRad(deg));
    const py = cy + r * t * Math.sin(toRad(deg));
    parts.push(`  <circle cx="${px}" cy="${py}" r="4" fill="${STYLE.stroke}"/>`);
    const lx = px + (p.labelDx ?? 0);
    const ly = py + (p.labelDy ?? -14);
    parts.push(text(lx, ly, p.id ?? "", { size: 15, weight: "bold" }));
  }

  if (fig.caption) {
    parts.push(
      text(fig.captionX ?? cx, fig.captionY ?? cy + r * 0.15, fig.caption, {
        size: 15,
        weight: "bold",
      })
    );
  }
}

function renderAngle(scene) {
  const width = scene.width ?? 420;
  const height = scene.height ?? 360;
  const parts = [];

  const figures = Array.isArray(scene.figures) && scene.figures.length
    ? scene.figures
    : [
        {
          cx: scene.cx ?? width * 0.42,
          cy: scene.cy ?? height * 0.62,
          rayLength: scene.rayLength ?? Math.min(width, height) * 0.55,
          vertexLabel: scene.vertexLabel ?? "B",
          vertexOffset: scene.vertexOffset,
          vertexAnchor: scene.vertexAnchor,
          rays: scene.rays,
          degrees: scene.degrees,
          startDegrees: scene.startDegrees,
          armALabel: scene.armALabel,
          armCLabel: scene.armCLabel,
          arcs: scene.arcs,
          showArc: scene.showArc,
          showDegree: scene.showDegree,
          points: scene.points,
          rightAngleMarks: scene.rightAngleMarks,
          triangleOverlay: scene.triangleOverlay,
          caption: scene.caption,
          captionX: scene.captionX,
          captionY: scene.captionY,
        },
      ];

  for (const fig of figures) {
    appendAngleFigure(parts, {
      ...fig,
      cx: fig.cx ?? width * 0.42,
      cy: fig.cy ?? height * 0.62,
      rayLength: fig.rayLength ?? Math.min(width, height) * 0.55,
    });
  }

  return { width, height, body: parts.join("\n") };
}

/** set_venn: two overlapping circles */
function renderVenn(scene) {
  const width = scene.width ?? 520;
  const height = scene.height ?? 360;
  const r = scene.radius ?? 110;
  const y = height * 0.52;
  const x1 = width * 0.38;
  const x2 = width * 0.62;
  const labelA = scene.setALabel ?? "A";
  const labelB = scene.setBLabel ?? "B";
  const elements = scene.elements ?? [];
  const shadeRegion = scene.shadeRegion ?? null; // "AB" | "A" | "B" | "union" | null
  const fillA = scene.fillA ?? STYLE.fillSoft;
  const fillB = scene.fillB ?? STYLE.fillSoftB;

  const parts = [];
  parts.push(`  <defs>
    <clipPath id="vennClipA"><circle cx="${x1}" cy="${y}" r="${r}"/></clipPath>
    <clipPath id="vennClipB"><circle cx="${x2}" cy="${y}" r="${r}"/></clipPath>
    <pattern id="vennHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="${STYLE.stroke}" stroke-width="1.25" opacity="0.55"/>
    </pattern>
  </defs>`);

  const baseFillA = shadeRegion ? "none" : fillA;
  const baseFillB = shadeRegion ? "none" : fillB;
  parts.push(
    `  <circle cx="${x1}" cy="${y}" r="${r}" fill="${baseFillA}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
  );
  parts.push(
    `  <circle cx="${x2}" cy="${y}" r="${r}" fill="${baseFillB}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
  );

  if (shadeRegion === "AB") {
    parts.push(
      `  <circle cx="${x2}" cy="${y}" r="${r}" fill="${STYLE.fillOverlap}" stroke="none" clip-path="url(#vennClipA)"/>`
    );
    parts.push(
      `  <circle cx="${x2}" cy="${y}" r="${r}" fill="url(#vennHatch)" stroke="none" clip-path="url(#vennClipA)"/>`
    );
  } else if (shadeRegion === "A") {
    parts.push(`  <defs>
    <mask id="vennMaskAonly">
      <rect width="100%" height="100%" fill="black"/>
      <circle cx="${x1}" cy="${y}" r="${r}" fill="white"/>
      <circle cx="${x2}" cy="${y}" r="${r}" fill="black"/>
    </mask>
  </defs>`);
    parts.push(
      `  <rect width="${width}" height="${height}" fill="${STYLE.fillOverlap}" mask="url(#vennMaskAonly)"/>`
    );
    parts.push(
      `  <rect width="${width}" height="${height}" fill="url(#vennHatch)" mask="url(#vennMaskAonly)"/>`
    );
  } else if (shadeRegion === "B") {
    parts.push(`  <defs>
    <mask id="vennMaskBonly">
      <rect width="100%" height="100%" fill="black"/>
      <circle cx="${x2}" cy="${y}" r="${r}" fill="white"/>
      <circle cx="${x1}" cy="${y}" r="${r}" fill="black"/>
    </mask>
  </defs>`);
    parts.push(
      `  <rect width="${width}" height="${height}" fill="${STYLE.fillOverlap}" mask="url(#vennMaskBonly)"/>`
    );
    parts.push(
      `  <rect width="${width}" height="${height}" fill="url(#vennHatch)" mask="url(#vennMaskBonly)"/>`
    );
  } else if (shadeRegion === "union") {
    parts.push(
      `  <circle cx="${x1}" cy="${y}" r="${r}" fill="${STYLE.fillOverlap}" stroke="none"/>`
    );
    parts.push(
      `  <circle cx="${x2}" cy="${y}" r="${r}" fill="${STYLE.fillOverlap}" stroke="none"/>`
    );
    parts.push(
      `  <circle cx="${x1}" cy="${y}" r="${r}" fill="url(#vennHatch)" stroke="none"/>`
    );
    parts.push(
      `  <circle cx="${x2}" cy="${y}" r="${r}" fill="url(#vennHatch)" stroke="none"/>`
    );
    parts.push(
      `  <circle cx="${x1}" cy="${y}" r="${r}" fill="none" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
    parts.push(
      `  <circle cx="${x2}" cy="${y}" r="${r}" fill="none" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
  }

  parts.push(text(x1 - r * 0.55, y - r - 12, labelA, { size: 18, weight: "bold" }));
  parts.push(text(x2 + r * 0.55, y - r - 12, labelB, { size: 18, weight: "bold" }));

  // Auto-stack multiple elements that share a region when x/y omitted
  const regionBuckets = { A: [], B: [], AB: [], outside: [] };
  for (const el of elements) {
    const region = el.region ?? "A";
    const key = regionBuckets[region] ? region : "outside";
    regionBuckets[key].push(el);
  }
  const regionAnchor = {
    A: { x: x1 - r * 0.45, y },
    B: { x: x2 + r * 0.45, y },
    AB: { x: (x1 + x2) / 2, y },
    outside: { x: width * 0.12, y: height * 0.18 },
  };
  for (const [region, list] of Object.entries(regionBuckets)) {
    const anchor = regionAnchor[region];
    const n = list.length;
    list.forEach((el, i) => {
      let x = anchor.x;
      let yy = anchor.y;
      if (n > 1 && el.x == null && el.y == null) {
        const spread = Math.min(22, (r * 0.55) / Math.max(n - 1, 1));
        yy = anchor.y - ((n - 1) * spread) / 2 + i * spread;
      }
      if (el.x != null) x = el.x;
      if (el.y != null) yy = el.y;
      parts.push(text(x, yy, el.label ?? "", { size: el.size ?? 15 }));
    });
  }

  return { width, height, body: parts.join("\n") };
}

function shapePath(s) {
  const shape = s.shape ?? "circle";
  const cx = s.cx;
  const cy = s.cy;
  const r = s.r;
  if (shape === "triangle") {
    const x1 = cx;
    const y1 = cy - r;
    const x2 = cx - r * 0.92;
    const y2 = cy + r * 0.78;
    const x3 = cx + r * 0.92;
    const y3 = cy + r * 0.78;
    return `polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}"`;
  }
  if (shape === "square" || shape === "rect") {
    const half = r * 0.85;
    return `rect x="${cx - half}" y="${cy - half}" width="${half * 2}" height="${half * 2}"`;
  }
  return `circle cx="${cx}" cy="${cy}" r="${r}"`;
}

/** set_euler: one or more non-overlapping / nested / optionally shaped sets */
function renderEuler(scene) {
  const width = scene.width ?? 520;
  const height = scene.height ?? 360;
  const sets = scene.sets ?? [
    { id: "A", cx: 200, cy: 180, r: 100 },
    { id: "B", cx: 360, cy: 180, r: 70 },
  ];
  const elements = scene.elements ?? [];
  const parts = [];
  const fills = [STYLE.fillSoft, STYLE.fillSoftB, STYLE.fillOverlap];
  sets.forEach((s, i) => {
    const tag = shapePath(s);
    parts.push(
      `  <${tag} fill="${fills[i % fills.length]}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
    const labelY = s.labelY ?? s.cy - s.r - 14;
    const labelX = s.labelX ?? s.cx;
    parts.push(text(labelX, labelY, s.id ?? s.label ?? "", { size: 17, weight: "bold" }));
  });
  for (const el of elements) {
    parts.push(text(el.x, el.y, el.label ?? "", { size: el.size ?? 15 }));
  }
  return { width, height, body: parts.join("\n") };
}

/** bar_chart */
function renderBarChart(scene) {
  const width = scene.width ?? 560;
  const height = scene.height ?? 360;
  const bars = scene.bars ?? [];
  const maxV = Math.max(1, ...bars.map((b) => Number(b.value) || 0), scene.yMax ?? 0);
  const padL = 48;
  const padB = 48;
  const padT = 28;
  const padR = 24;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const n = Math.max(bars.length, 1);
  const gap = 16;
  const barW = Math.min(64, (chartW - gap * (n + 1)) / n);

  const parts = [];
  parts.push(
    `  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
  );
  parts.push(
    `  <line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
  );

  bars.forEach((b, i) => {
    const v = Number(b.value) || 0;
    const h = (v / maxV) * chartH;
    const x = padL + gap + i * (barW + gap);
    const y = padT + chartH - h;
    parts.push(
      `  <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${STYLE.fillSoft}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"/>`
    );
    parts.push(text(x + barW / 2, padT + chartH + 18, b.label ?? "", { size: 14 }));
    if (scene.showValues) {
      parts.push(text(x + barW / 2, y - 12, String(v), { size: 13 }));
    }
  });

  return { width, height, body: parts.join("\n") };
}

/** Resolve polygon vertices for one figure (regular or explicit). */
function polygonPoints(fig, fallbackCx, fallbackCy, fallbackR) {
  const cx = fig.cx ?? fallbackCx;
  const cy = fig.cy ?? fallbackCy;
  const r = fig.radius ?? fallbackR;
  const n = fig.sides ?? (fig.vertices ? fig.vertices.length : 3);
  const labels = fig.vertexLabels ?? "ABCDEFGH".slice(0, n).split("");
  const rotation = ((fig.rotationDeg ?? -90) * Math.PI) / 180;

  let pts;
  if (fig.vertices && fig.vertices.length) {
    pts = fig.vertices.map((v) => ({ x: Number(v.x), y: Number(v.y), id: v.id ?? "" }));
  } else {
    pts = [];
    for (let i = 0; i < n; i++) {
      const a = rotation + (i * 2 * Math.PI) / n;
      pts.push({
        x: cx + r * Math.cos(a),
        y: cy + r * Math.sin(a),
        id: labels[i] ?? "",
      });
    }
  }
  return { pts, cx, cy, r };
}

function resolveSegmentEndpoints(seg, byId) {
  if (Array.isArray(seg) && seg.length >= 2) {
    return [byId.get(String(seg[0])), byId.get(String(seg[1]))];
  }
  if (seg && typeof seg === "object") {
    const a = byId.get(String(seg.from ?? seg.a ?? ""));
    const b = byId.get(String(seg.to ?? seg.b ?? ""));
    return [a, b];
  }
  return [null, null];
}

/**
 * Append one polygon figure.
 * Optional: segments (diagonals/chords by vertex id), caption, fill, showVertices.
 */
function appendPolygonFigure(parts, fig, defaults) {
  const { pts, cx, cy } = polygonPoints(
    fig,
    defaults.cx,
    defaults.cy,
    defaults.r
  );
  const fill =
    fig.fill === false || fig.fill === "none"
      ? "none"
      : fig.fillSoft ?? STYLE.fillSoft;
  const strokeW = fig.strokeWidth ?? STYLE.strokeWidth;
  const pointsAttr = pts.map((p) => `${p.x},${p.y}`).join(" ");
  parts.push(
    `  <polygon points="${pointsAttr}" fill="${fill}" stroke="${STYLE.stroke}" stroke-width="${strokeW}"/>`
  );

  const byId = new Map();
  for (const p of pts) {
    if (p.id) byId.set(String(p.id), p);
  }

  const segments = fig.segments ?? [];
  for (const seg of segments) {
    const [a, b] = resolveSegmentEndpoints(seg, byId);
    if (!a || !b) continue;
    const dashed = seg.dashed ? ` stroke-dasharray="6 4"` : "";
    parts.push(
      `  <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${STYLE.stroke}" stroke-width="${strokeW}"${dashed}/>`
    );
  }

  const showVertices = fig.showVertices !== false;
  const labelOffset = fig.labelOffset ?? 18;
  if (showVertices) {
    for (const p of pts) {
      parts.push(
        `  <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${STYLE.stroke}"/>`
      );
      if (!p.id) continue;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const ox = fig.labelOffsets?.[p.id]?.x;
      const oy = fig.labelOffsets?.[p.id]?.y;
      const lx = ox != null ? p.x + ox : p.x + (dx / len) * labelOffset;
      const ly = oy != null ? p.y + oy : p.y + (dy / len) * labelOffset;
      parts.push(text(lx, ly, p.id, { size: 16, weight: "bold" }));
    }
  }

  if (fig.caption) {
    parts.push(
      text(fig.captionX ?? cx, fig.captionY ?? cy - (fig.radius ?? defaults.r) - 28, fig.caption, {
        size: 18,
        weight: "bold",
      })
    );
  }
}

/**
 * polygon — one regular/custom polygon, or several via figures[].
 * Optional top-level segments apply to the union of vertex ids.
 */
function renderPolygon(scene) {
  const width = scene.width ?? 420;
  const height = scene.height ?? 360;
  const defaults = {
    cx: scene.cx ?? width / 2,
    cy: scene.cy ?? height / 2 + 10,
    r: scene.radius ?? Math.min(width, height) * 0.32,
  };
  const parts = [];

  const figures =
    Array.isArray(scene.figures) && scene.figures.length
      ? scene.figures
      : [
          {
            sides: scene.sides,
            vertices: scene.vertices,
            vertexLabels: scene.vertexLabels,
            rotationDeg: scene.rotationDeg,
            cx: scene.cx,
            cy: scene.cy,
            radius: scene.radius,
            fill: scene.fill,
            fillSoft: scene.fillSoft,
            segments: scene.segments,
            showVertices: scene.showVertices,
            labelOffset: scene.labelOffset,
            labelOffsets: scene.labelOffsets,
            caption: scene.caption,
            captionX: scene.captionX,
            captionY: scene.captionY,
            strokeWidth: scene.strokeWidth,
          },
        ];

  const allById = new Map();
  for (const fig of figures) {
    const { pts } = polygonPoints(
      {
        ...fig,
        cx: fig.cx ?? defaults.cx,
        cy: fig.cy ?? defaults.cy,
        radius: fig.radius ?? defaults.r,
      },
      defaults.cx,
      defaults.cy,
      defaults.r
    );
    for (const p of pts) {
      if (p.id) allById.set(String(p.id), p);
    }
    appendPolygonFigure(parts, fig, defaults);
  }

  // Global segments (e.g. diagonals spanning one figure already drawn, or shared ids)
  if (Array.isArray(scene.globalSegments)) {
    for (const seg of scene.globalSegments) {
      const [a, b] = resolveSegmentEndpoints(seg, allById);
      if (!a || !b) continue;
      const dashed = seg.dashed ? ` stroke-dasharray="6 4"` : "";
      parts.push(
        `  <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${STYLE.stroke}" stroke-width="${STYLE.strokeWidth}"${dashed}/>`
      );
    }
  }

  return { width, height, body: parts.join("\n") };
}

/**
 * parallelepiped — isometric rectangular box (solid).
 *
 * size: { a, b, c } pixel lengths (length / depth / height)
 * origin: front-bottom-left corner
 * depthAngleDeg: angle of depth axis (default 30)
 * Vertices: A B C D = front (BL BR TR TL), E F G H = back
 * edgeLabels: [{ from, to, text, dx?, dy? }]
 * highlightEdges: [{ from, to }] thicker stroke
 * highlightFaces: ["front"|"top"|"side"] soft fill
 * marks: [
 *   { type:"faceLabel", face, text },
 *   { type:"edgeLabel", from, to, text, dx?, dy? },
 *   { type:"point", at:{from,to,t}, text, dx?, dy? },
 *   { type:"segment", from, to, text?, dashed?, dx?, dy? }
 * ]
 * showHidden: dashed hidden edges (default true)
 */
function parallelepipedPoints(scene) {
  const a = Number(scene.size?.a ?? scene.a ?? 180);
  const b = Number(scene.size?.b ?? scene.b ?? 90);
  const c = Number(scene.size?.c ?? scene.c ?? 110);
  const ox = Number(scene.origin?.x ?? 100);
  const oy = Number(scene.origin?.y ?? 260);
  const ang = ((scene.depthAngleDeg ?? 30) * Math.PI) / 180;
  const dx = b * Math.cos(ang);
  const dy = -b * Math.sin(ang);
  const A = { x: ox, y: oy };
  const B = { x: ox + a, y: oy };
  const C = { x: ox + a, y: oy - c };
  const D = { x: ox, y: oy - c };
  const E = { x: ox + dx, y: oy + dy };
  const F = { x: ox + a + dx, y: oy + dy };
  const G = { x: ox + a + dx, y: oy - c + dy };
  const H = { x: ox + dx, y: oy - c + dy };
  return { A, B, C, D, E, F, G, H, a, b, c };
}

function mid2(p, q, t = 0.5) {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

function faceCentroid(pts, face) {
  const map = {
    front: ["A", "B", "C", "D"],
    top: ["D", "C", "G", "H"],
    side: ["B", "F", "G", "C"],
    left: ["A", "D", "H", "E"],
    back: ["E", "F", "G", "H"],
    bottom: ["A", "B", "F", "E"],
  };
  const ids = map[face] ?? map.front;
  const arr = ids.map((id) => pts[id]);
  return {
    x: arr.reduce((s, p) => s + p.x, 0) / arr.length,
    y: arr.reduce((s, p) => s + p.y, 0) / arr.length,
  };
}

function renderParallelepiped(scene) {
  const width = scene.width ?? 480;
  const height = scene.height ?? 360;
  const pts = parallelepipedPoints(scene);
  const parts = [];
  const sw = STYLE.strokeWidth;

  const facePolys = {
    front: [pts.A, pts.B, pts.C, pts.D],
    top: [pts.D, pts.C, pts.G, pts.H],
    side: [pts.B, pts.F, pts.G, pts.C],
  };
  for (const face of scene.highlightFaces ?? []) {
    const poly = facePolys[face];
    if (!poly) continue;
    const points = poly.map((p) => `${p.x},${p.y}`).join(" ");
    parts.push(
      `  <polygon points="${points}" fill="${STYLE.fillSoft}" stroke="none"/>`
    );
  }

  const hidden = [
    ["A", "E"],
    ["E", "F"],
    ["E", "H"],
  ];
  if (scene.showHidden !== false) {
    for (const [u, v] of hidden) {
      const p = pts[u];
      const q = pts[v];
      parts.push(
        `  <line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${STYLE.strokeMuted}" stroke-width="${sw}" stroke-dasharray="5 4"/>`
      );
    }
  }

  const visible = [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
    ["D", "A"],
    ["B", "F"],
    ["F", "G"],
    ["G", "C"],
    ["D", "H"],
    ["H", "G"],
  ];
  for (const [u, v] of visible) {
    const p = pts[u];
    const q = pts[v];
    parts.push(
      `  <line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${STYLE.stroke}" stroke-width="${sw}"/>`
    );
  }

  const edgeKey = (u, v) => [u, v].sort().join("-");
  const hi = new Set(
    (scene.highlightEdges ?? []).map((e) => edgeKey(e.from, e.to))
  );
  for (const [u, v] of [...visible, ...hidden]) {
    if (!hi.has(edgeKey(u, v))) continue;
    const p = pts[u];
    const q = pts[v];
    parts.push(
      `  <line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${STYLE.stroke}" stroke-width="${sw * 2.4}"/>`
    );
  }

  for (const lab of scene.edgeLabels ?? []) {
    const p = pts[lab.from];
    const q = pts[lab.to];
    if (!p || !q) continue;
    const m = mid2(p, q, lab.t ?? 0.5);
    parts.push(
      text(m.x + (lab.dx ?? 0), m.y + (lab.dy ?? 0), lab.text ?? "", {
        size: lab.size ?? 15,
        weight: "bold",
      })
    );
  }

  if (scene.vertexLabels) {
    const labels =
      scene.vertexLabels === true
        ? { A: "A", B: "B", C: "C", D: "D", E: "E", F: "F", G: "G", H: "H" }
        : scene.vertexLabels;
    for (const [id, lab] of Object.entries(labels)) {
      const p = pts[id];
      if (!p || !lab) continue;
      const off = scene.vertexOffsets?.[id] ?? { x: 0, y: 0 };
      parts.push(
        text(p.x + off.x, p.y + off.y, lab, { size: 14, weight: "bold" })
      );
    }
  }

  for (const mark of scene.marks ?? []) {
    if (mark.type === "faceLabel") {
      const c = faceCentroid(pts, mark.face);
      parts.push(
        text(c.x + (mark.dx ?? 0), c.y + (mark.dy ?? 0), mark.text ?? "", {
          size: 16,
          weight: "bold",
        })
      );
    } else if (mark.type === "edgeLabel") {
      const p = pts[mark.from];
      const q = pts[mark.to];
      if (!p || !q) continue;
      const m = mid2(p, q, mark.t ?? 0.5);
      parts.push(
        text(m.x + (mark.dx ?? 0), m.y + (mark.dy ?? 0), mark.text ?? "", {
          size: 15,
          weight: "bold",
        })
      );
    } else if (mark.type === "point") {
      const p = pts[mark.at.from];
      const q = pts[mark.at.to];
      if (!p || !q) continue;
      const m = mid2(p, q, mark.at.t ?? 0.5);
      parts.push(`  <circle cx="${m.x}" cy="${m.y}" r="4" fill="${STYLE.stroke}"/>`);
      if (mark.text) {
        parts.push(
          text(m.x + (mark.dx ?? 10), m.y + (mark.dy ?? -10), mark.text, {
            size: 15,
            weight: "bold",
          })
        );
      }
    } else if (mark.type === "segment") {
      const p = pts[mark.from];
      const q = pts[mark.to];
      if (!p || !q) continue;
      const dashed = mark.dashed ? ` stroke-dasharray="6 4"` : "";
      parts.push(
        `  <line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${STYLE.stroke}" stroke-width="${sw * 1.5}"${dashed}/>`
      );
      if (mark.text) {
        const m = mid2(p, q, 0.5);
        parts.push(
          text(m.x + (mark.dx ?? 8), m.y + (mark.dy ?? -8), mark.text, {
            size: 15,
            weight: "bold",
          })
        );
      }
    } else if (mark.type === "annotation") {
      parts.push(
        text(mark.x, mark.y, mark.text ?? "", {
          size: mark.size ?? 14,
          anchor: mark.anchor ?? "start",
        })
      );
    }
  }

  if (scene.caption) {
    parts.push(
      text(scene.captionX ?? width / 2, scene.captionY ?? 24, scene.caption, {
        size: 16,
        weight: "bold",
      })
    );
  }

  return { width, height, body: parts.join("\n") };
}

/** Draw a small monochrome face mark inside a cell. */
function drawFaceSymbol(parts, cx, cy, symbol, size = 14) {
  const s = size;
  const stroke = STYLE.stroke;
  const sw = STYLE.strokeWidth;
  switch (symbol) {
    case "sun": {
      parts.push(
        `  <circle cx="${cx}" cy="${cy}" r="${s * 0.35}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r0 = s * 0.45;
        const r1 = s * 0.7;
        parts.push(
          `  <line x1="${cx + r0 * Math.cos(a)}" y1="${cy + r0 * Math.sin(a)}" x2="${cx + r1 * Math.cos(a)}" y2="${cy + r1 * Math.sin(a)}" stroke="${stroke}" stroke-width="${sw}"/>`
        );
      }
      break;
    }
    case "heart": {
      const k = s * 0.35;
      parts.push(
        `  <path d="M ${cx} ${cy + k * 0.9} C ${cx - k * 1.6} ${cy - k * 0.1}, ${cx - k * 0.9} ${cy - k * 1.3}, ${cx} ${cy - k * 0.45} C ${cx + k * 0.9} ${cy - k * 1.3}, ${cx + k * 1.6} ${cy - k * 0.1}, ${cx} ${cy + k * 0.9} Z" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      break;
    }
    case "rhombus": {
      const k = s * 0.55;
      parts.push(
        `  <polygon points="${cx},${cy - k} ${cx + k * 0.7},${cy} ${cx},${cy + k} ${cx - k * 0.7},${cy}" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      break;
    }
    case "leaf": {
      parts.push(
        `  <ellipse cx="${cx}" cy="${cy}" rx="${s * 0.28}" ry="${s * 0.5}" transform="rotate(-25 ${cx} ${cy})" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      parts.push(
        `  <line x1="${cx}" y1="${cy + s * 0.45}" x2="${cx}" y2="${cy - s * 0.45}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      break;
    }
    case "cloud": {
      parts.push(
        `  <ellipse cx="${cx - s * 0.2}" cy="${cy}" rx="${s * 0.28}" ry="${s * 0.22}" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      parts.push(
        `  <ellipse cx="${cx + s * 0.15}" cy="${cy}" rx="${s * 0.32}" ry="${s * 0.24}" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      parts.push(
        `  <ellipse cx="${cx}" cy="${cy - s * 0.15}" rx="${s * 0.22}" ry="${s * 0.18}" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      break;
    }
    case "flower": {
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const px = cx + s * 0.28 * Math.cos(a);
        const py = cy + s * 0.28 * Math.sin(a);
        parts.push(
          `  <circle cx="${px}" cy="${py}" r="${s * 0.16}" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
        );
      }
      parts.push(
        `  <circle cx="${cx}" cy="${cy}" r="${s * 0.12}" fill="${stroke}"/>`
      );
      break;
    }
    case "drop": {
      const k = s * 0.4;
      parts.push(
        `  <path d="M ${cx} ${cy - k} Q ${cx + k} ${cy}, ${cx} ${cy + k} Q ${cx - k} ${cy}, ${cx} ${cy - k} Z" fill="${STYLE.fillSoft}" stroke="${stroke}" stroke-width="${sw}"/>`
      );
      break;
    }
    case "lightning": {
      const k = s * 0.45;
      parts.push(
        `  <polyline points="${cx + k * 0.2},${cy - k} ${cx - k * 0.15},${cy - k * 0.05} ${cx + k * 0.1},${cy - k * 0.05} ${cx - k * 0.25},${cy + k}" fill="none" stroke="${stroke}" stroke-width="${sw * 1.4}"/>`
      );
      break;
    }
    default:
      if (symbol) {
        parts.push(text(cx, cy, symbol, { size: Math.max(12, s * 0.9), weight: "bold" }));
      }
  }
}

/**
 * net_parallelepiped — one or more nets of rectangles/squares (optionally on a grid).
 *
 * figures: [{
 *   ox, oy, cell,               // origin + cell size (square side)
 *   cells: [[i,j], ...] | [{i,j, w?, h?}],  // cell coords; w/h in cells for rectangles
 *   faceMarks: [{ i, j, symbol }],
 *   vertexLabels: [{ i, j, corner:"NW"|"NE"|"SW"|"SE", text, dx?, dy? }],
 *   caption, captionX?, captionY?,
 *   fillSoft?: boolean
 * }]
 * grid: { cols, rows, cell, ox, oy } optional background grid
 * unitLabels: [{ x1,y1,x2,y2, text }] pixel space dimension braces (optional)
 */
function renderNetParallelepiped(scene) {
  const width = scene.width ?? 720;
  const height = scene.height ?? 480;
  const parts = [];
  const sw = STYLE.strokeWidth;

  if (scene.grid) {
    const g = scene.grid;
    const cell = Number(g.cell ?? 20);
    const ox = Number(g.ox ?? 40);
    const oy = Number(g.oy ?? 40);
    const cols = Number(g.cols ?? 12);
    const rows = Number(g.rows ?? 10);
    for (let i = 0; i <= cols; i++) {
      const x = ox + i * cell;
      parts.push(
        `  <line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + rows * cell}" stroke="#cccccc" stroke-width="1"/>`
      );
    }
    for (let j = 0; j <= rows; j++) {
      const y = oy + j * cell;
      parts.push(
        `  <line x1="${ox}" y1="${y}" x2="${ox + cols * cell}" y2="${y}" stroke="#cccccc" stroke-width="1"/>`
      );
    }
  }

  const figures = Array.isArray(scene.figures) ? scene.figures : [scene];

  for (const fig of figures) {
    if (!fig || (!fig.cells && !fig.rects)) continue;
    const cell = Number(fig.cell ?? scene.cell ?? 36);
    const ox = Number(fig.ox ?? 40);
    const oy = Number(fig.oy ?? 40);
    const soft = fig.fillSoft !== false;

    const rects = [];
    if (Array.isArray(fig.rects)) {
      for (const r of fig.rects) {
        rects.push({
          i: Number(r.i),
          j: Number(r.j),
          w: Number(r.w ?? 1),
          h: Number(r.h ?? 1),
        });
      }
    }
    for (const c of fig.cells ?? []) {
      if (Array.isArray(c)) {
        rects.push({ i: Number(c[0]), j: Number(c[1]), w: 1, h: 1 });
      } else {
        rects.push({
          i: Number(c.i),
          j: Number(c.j),
          w: Number(c.w ?? 1),
          h: Number(c.h ?? 1),
        });
      }
    }

    for (const r of rects) {
      const x = ox + r.i * cell;
      const y = oy + r.j * cell;
      const w = r.w * cell;
      const h = r.h * cell;
      parts.push(
        `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${soft ? STYLE.fillSoft : "none"}" stroke="${STYLE.stroke}" stroke-width="${sw}"/>`
      );
    }

    for (const fm of fig.faceMarks ?? []) {
      const x = ox + (Number(fm.i) + 0.5) * cell;
      const y = oy + (Number(fm.j) + 0.5) * cell;
      drawFaceSymbol(parts, x, y, fm.symbol, cell * 0.45);
    }

    const cornerOffset = {
      NW: { x: 0, y: 0 },
      NE: { x: 1, y: 0 },
      SW: { x: 0, y: 1 },
      SE: { x: 1, y: 1 },
    };
    for (const vl of fig.vertexLabels ?? []) {
      const co = cornerOffset[vl.corner ?? "NW"] ?? cornerOffset.NW;
      const x = ox + (Number(vl.i) + co.x) * cell + (vl.dx ?? (co.x === 0 ? -10 : 10));
      const y = oy + (Number(vl.j) + co.y) * cell + (vl.dy ?? (co.y === 0 ? -8 : 12));
      parts.push(text(x, y, vl.text ?? "", { size: 14, weight: "bold" }));
    }

    if (fig.caption != null) {
      parts.push(
        text(
          fig.captionX ?? ox + cell,
          fig.captionY ?? oy - 16,
          String(fig.caption),
          { size: 16, weight: "bold", anchor: fig.captionAnchor ?? "middle" }
        )
      );
    }
  }

  for (const ul of scene.unitLabels ?? []) {
    parts.push(
      text(ul.x, ul.y, ul.text ?? "", {
        size: ul.size ?? 14,
        weight: "bold",
        anchor: ul.anchor ?? "middle",
      })
    );
  }

  if (scene.caption) {
    parts.push(
      text(scene.captionX ?? width / 2, scene.captionY ?? 22, scene.caption, {
        size: 16,
        weight: "bold",
      })
    );
  }

  return { width, height, body: parts.join("\n") };
}

const RENDERERS = {
  coordinate_ray: renderRay,
  number_line_decimals: renderRay,
  angle: renderAngle,
  set_venn: renderVenn,
  set_euler: renderEuler,
  bar_chart: renderBarChart,
  polygon: renderPolygon,
  parallelepiped: renderParallelepiped,
  net_parallelepiped: renderNetParallelepiped,
};

async function maybeWritePng(svgPath, svgText) {
  let Resvg;
  try {
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch {
    console.error(
      "PNG requested but @resvg/resvg-js is not installed. Run: npm install --prefix content/tools"
    );
    process.exit(1);
  }
  const resvg = new Resvg(svgText, {
    fitTo: { mode: "width", value: 720 },
  });
  const pngData = resvg.render();
  const pngPath = svgPath.replace(/\.svg$/i, ".png");
  fs.writeFileSync(pngPath, pngData.asPng());
  console.log("wrote", pngPath);
  return pngPath;
}

async function main() {
  const args = parseArgs(process.argv);
  const scene = loadScene(args);
  const renderer = RENDERERS[scene.kind];
  if (!renderer) {
    console.error(
      `Unsupported scene.kind "${scene.kind}". Supported: ${Object.keys(RENDERERS).join(", ")}`
    );
    process.exit(1);
  }
  const { width, height, body } = renderer(scene);
  const svgText = svgWrap(width, height, body);
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svgText, "utf8");
  console.log("wrote", outPath);

  if (args.png) {
    await maybeWritePng(outPath, svgText);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
