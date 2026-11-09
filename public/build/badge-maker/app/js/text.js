// Names in a font: the letters' outlines as a shape, sized by their capital height.
//
// Fonts are Fontsource's WOFF files of open-licensed fonts (which opentype.js reads), served with
// the page from vendor/fonts and fetched the first time they're picked.

/* global opentype */
import { SCALE, union } from "./geom.js";

const DIR = "vendor/fonts";
export const FONTS = [
  { id: "bebas", label: "Bebas Neue", note: "tall capitals", url: `${DIR}/bebas-neue-latin-400-normal.woff` },
  { id: "oswald", label: "Oswald Bold", note: "condensed", url: `${DIR}/oswald-latin-700-normal.woff` },
  { id: "montserrat", label: "Montserrat Extra Bold", note: "wide", url: `${DIR}/montserrat-latin-800-normal.woff` },
  { id: "inter", label: "Inter Bold", note: "plain", url: `${DIR}/inter-latin-700-normal.woff` },
  { id: "fredoka", label: "Fredoka Semi Bold", note: "rounded", url: `${DIR}/fredoka-latin-600-normal.woff` },
];

const cache = new Map();

export function loadFont(id) {
  const f = FONTS.find((q) => q.id === id) || FONTS[0];
  if (!cache.has(f.id)) {
    cache.set(f.id, fetch(f.url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => opentype.parse(buf))
      .catch((e) => { cache.delete(f.id); throw new Error(`Couldn't load the font ${f.label} (${e.message}). Try again.`); }));
  }
  return cache.get(f.id);
}

function capHeight(font) {
  const os2 = font.tables.os2;
  if (os2 && os2.sCapHeight > 0) return os2.sCapHeight;
  const h = font.charToGlyph("H").getBoundingBox();
  return h.y2 - h.y1 || font.unitsPerEm * 0.7;
}

// The name's outline with its capitals `cap` mm tall, baseline on y = 0, starting at x = 0, y up.
// -> {paths (Clipper units), width (mm, advance), missing: [characters the font hasn't got]}
export function textShape(font, text, cap, tracking = 0, tol = 0.004) {
  const size = (cap * font.unitsPerEm) / capHeight(font);      // font size in mm
  const k = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const missing = [];
  const rings = [];
  let x = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    if (g.index === 0 && text[i] && text[i].trim()) missing.push(text[i]);
    const path = g.getPath(x, 0, size);
    let cur = null, px = 0, py = 0;
    const P = (a, b) => ({ X: Math.round(a * SCALE), Y: Math.round(-b * SCALE) });
    for (const c of path.commands) {
      if (c.type === "M") { cur = [P(c.x, c.y)]; rings.push(cur); px = c.x; py = c.y; }
      else if (c.type === "L") { cur.push(P(c.x, c.y)); px = c.x; py = c.y; }
      else if (c.type === "Q") {
        const M = Math.hypot(px - 2 * c.x1 + c.x, py - 2 * c.y1 + c.y);
        const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(M / (4 * tol)))));
        for (let j = 1; j <= n; j++) {
          const t = j / n, u = 1 - t;
          cur.push(P(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y));
        }
        px = c.x; py = c.y;
      } else if (c.type === "C") {
        const M = Math.max(Math.hypot(px - 2 * c.x1 + c.x2, py - 2 * c.y1 + c.y2),
          Math.hypot(c.x1 - 2 * c.x2 + c.x, c.y1 - 2 * c.y2 + c.y));
        const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(0.75 * M / tol))));
        for (let j = 1; j <= n; j++) {
          const t = j / n, u = 1 - t;
          const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, e = t * t * t;
          cur.push(P(a * px + b * c.x1 + cc * c.x2 + e * c.x, a * py + b * c.y1 + cc * c.y2 + e * c.y));
        }
        px = c.x; py = c.y;
      }
    }
    x += g.advanceWidth * k + tracking;
    if (i + 1 < glyphs.length) x += font.getKerningValue(g, glyphs[i + 1]) * k;
  }
  return { paths: union(rings.filter((r) => r.length >= 3)), width: x - tracking, missing };
}
