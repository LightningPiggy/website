// Reading a logo: an SVG file -> one flat shape per colour.
//
// The browser does the hard parts of SVG: it applies the file's CSS (<style> classes, style=""
// and presentation attributes) and works out every element's transform. The SVG goes into a
// hidden shadow root (so its CSS can't touch the page), resized so the drawing fills 1000 px,
// and each shape's outline is read in those pixels: paths, rectangles, circles, ellipses,
// polygons and lines, their fills and their strokes. Curves are flattened to within 0.15 px,
// a few thousandths of a millimetre on the badge.
//
// Shapes are painted in order, later ones over earlier ones, so each colour keeps only what is
// still visible on top: a white eye drawn over a red head leaves a hole in the red. Colours
// that look the same (CIE76 under 4) count as one.

/* global ClipperLib */
import { SCALE, union, diff, stroke, area, bounds } from "./geom.js";
import { parseColour, distance, mix } from "./colour.js";

const SVGNS = "http://www.w3.org/2000/svg";
const VIEW = 1000;
const TOL = 0.15;
const SKIP = new Set(["defs", "clipPath", "mask", "symbol", "marker", "pattern", "linearGradient",
  "radialGradient", "filter", "metadata", "title", "desc", "style", "script", "font", "glyph", "foreignObject"]);
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);

// ---------------------------------------------------------------- path data

// SVG path data -> [{pts: [[x, y], ...], closed}], every point through the matrix m (a DOMMatrix:
// x' = a x + c y + e, y' = b x + d y + f), curves flattened to within `tol` after it.
export function flattenPath(d, m, tol = TOL) {
  const T = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lastCmd = "";
  let i = 0;
  const n = d.length;
  const ws = (c) => c === " " || c === "," || c === "\n" || c === "\r" || c === "\t" || c === "\f";
  const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  const skip = () => { while (i < n && ws(d[i])) i++; };
  const num = () => {
    skip();
    NUM.lastIndex = i;
    const r = NUM.exec(d);
    if (!r) return null;
    i = NUM.lastIndex;
    return parseFloat(r[0]);
  };
  const flag = () => {
    skip();
    const c = d[i];
    if (c === "0" || c === "1") { i++; return c === "1"; }
    return null;
  };
  const begin = () => { if (!cur) { cur = { pts: [T(x, y)], closed: false }; subs.push(cur); } };
  const lineTo = (px, py) => { begin(); cur.pts.push(T(px, py)); x = px; y = py; };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    begin();
    const p0 = T(x, y), p1 = T(x1, y1), p2 = T(x2, y2), p3 = T(x3, y3);
    const M = Math.max(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
      Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]));
    const k = Math.min(256, Math.max(1, Math.ceil(Math.sqrt(0.75 * M / tol))));
    for (let j = 1; j <= k; j++) {
      const t = j / k, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      cur.pts.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
    }
    x = x3; y = y3;
  };
  const quad = (x1, y1, x2, y2) => {
    begin();
    const p0 = T(x, y), p1 = T(x1, y1), p2 = T(x2, y2);
    const M = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
    const k = Math.min(256, Math.max(1, Math.ceil(Math.sqrt(M / (4 * tol)))));
    for (let j = 1; j <= k; j++) {
      const t = j / k, u = 1 - t;
      cur.pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    x = x2; y = y2;
  };
  // the endpoint arc of the SVG spec (appendix B.2.4), as its centre and angles
  const arc = (rx, ry, rot, large, sweep, x2, y2) => {
    if (x === x2 && y === y2) return;
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) { lineTo(x2, y2); return; }
    begin();
    const phi = rot * Math.PI / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    const dx = (x - x2) / 2, dy = (y - y2) / 2;
    const x1p = cs * dx + sn * dy, y1p = -sn * dx + cs * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num2 / den));
    if (large === sweep) co = -co;
    const cxp = co * (rx * y1p) / ry, cyp = co * -(ry * x1p) / rx;
    const cx = cs * cxp - sn * cyp + (x + x2) / 2, cy = sn * cxp + cs * cyp + (y + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const r = Math.max(rx, ry) * scale;
    const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 2;
    const k = Math.min(512, Math.max(2, Math.ceil(Math.abs(dt) / step)));
    for (let j = 1; j <= k; j++) {
      const t = t1 + (dt * j) / k;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      cur.pts.push(j === k ? T(x2, y2) : T(cs * ex - sn * ey + cx, sn * ex + cs * ey + cy));
    }
    x = x2; y = y2;
  };

  let cmd = null;
  while (true) {
    skip();
    if (i >= n) break;
    const ch = d[i];
    if (/[A-Za-z]/.test(ch)) {
      cmd = ch; i++;
      if (cmd === "Z" || cmd === "z") {
        if (cur) { cur.closed = true; cur = null; }
        x = sx; y = sy; lastCmd = "Z";
        continue;
      }
    } else if (cmd === null || cmd === "Z" || cmd === "z") {
      break;                                   // stray numbers: stop here, as browsers do
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    let ok = true;
    if (C === "M") {
      const a = num(), b = num();
      if (a === null || b === null) break;
      x = ox + a; y = oy + b; sx = x; sy = y;
      cur = { pts: [T(x, y)], closed: false }; subs.push(cur);
      cmd = rel ? "l" : "L";                   // more pairs after a moveto are linetos
    } else if (C === "L") {
      const a = num(), b = num();
      if (a === null || b === null) break;
      lineTo(ox + a, oy + b);
    } else if (C === "H") {
      const a = num(); if (a === null) break;
      lineTo(ox + a, y);
    } else if (C === "V") {
      const a = num(); if (a === null) break;
      lineTo(x, oy + a);
    } else if (C === "C") {
      const v = [num(), num(), num(), num(), num(), num()];
      if (v.includes(null)) break;
      lcx = ox + v[2]; lcy = oy + v[3];
      cubic(ox + v[0], oy + v[1], lcx, lcy, ox + v[4], oy + v[5]);
    } else if (C === "S") {
      const v = [num(), num(), num(), num()];
      if (v.includes(null)) break;
      const r1 = /[CS]/.test(lastCmd) ? [2 * x - lcx, 2 * y - lcy] : [x, y];
      lcx = ox + v[0]; lcy = oy + v[1];
      cubic(r1[0], r1[1], lcx, lcy, ox + v[2], oy + v[3]);
    } else if (C === "Q") {
      const v = [num(), num(), num(), num()];
      if (v.includes(null)) break;
      lcx = ox + v[0]; lcy = oy + v[1];
      quad(lcx, lcy, ox + v[2], oy + v[3]);
    } else if (C === "T") {
      const v = [num(), num()];
      if (v.includes(null)) break;
      const r1 = /[QT]/.test(lastCmd) ? [2 * x - lcx, 2 * y - lcy] : [x, y];
      lcx = r1[0]; lcy = r1[1];
      quad(lcx, lcy, ox + v[0], oy + v[1]);
    } else if (C === "A") {
      const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(), a = num(), b = num();
      if ([rx, ry, rot, large, sweep, a, b].includes(null)) break;
      arc(rx, ry, rot, large, sweep, ox + a, oy + b);
    } else {
      ok = false;
    }
    if (!ok) break;
    lastCmd = C;
  }
  return subs.filter((s) => s.pts.length >= 2);
}

// ---------------------------------------------------------------- the elements

const fmt = (v) => +v.toFixed(6);

// A basic shape's outline as path data, so one flattener serves every shape.
function shapeData(el) {
  const a = (name) => {
    const v = el[name] && el[name].baseVal;
    return v && "value" in v ? v.value : parseFloat(el.getAttribute(name)) || 0;
  };
  switch (el.localName) {
    case "path": return el.getAttribute("d") || "";
    case "rect": {
      const x = a("x"), y = a("y"), w = a("width"), h = a("height");
      if (w <= 0 || h <= 0) return "";
      let rx = el.hasAttribute("rx") ? a("rx") : null, ry = el.hasAttribute("ry") ? a("ry") : null;
      if (rx === null) rx = ry ?? 0;
      if (ry === null) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}`
        + `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`
        + `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case "circle": case "ellipse": {
      const cx = a("cx"), cy = a("cy");
      const rx = el.localName === "circle" ? a("r") : a("rx"), ry = el.localName === "circle" ? a("r") : a("ry");
      if (rx <= 0 || ry <= 0) return "";
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case "polygon": case "polyline": {
      const pts = Array.from(el.points || []).map((p) => `${fmt(p.x)} ${fmt(p.y)}`);
      if (pts.length < 2) return "";
      return "M" + pts.join("L") + (el.localName === "polygon" ? "Z" : "");
    }
    case "line":
      return `M${a("x1")} ${a("y1")}L${a("x2")} ${a("y2")}`;
  }
  return "";
}

// <use> copies the element it points at: written out as a group holding a copy, so every shape
// is an ordinary element with a transform the browser reports.
function expandUses(root) {
  for (let round = 0; round < 8; round++) {
    const uses = root.querySelectorAll("use");
    if (!uses.length) return;
    for (const u of uses) {
      const href = u.getAttribute("href") || u.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
      const target = href.startsWith("#") ? root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`) : null;
      if (!target || target.contains(u) || u.contains(target)) { u.remove(); continue; }
      const g = document.createElementNS(SVGNS, "g");
      for (const at of Array.from(u.attributes)) {
        if (!/^(x|y|width|height|href|xlink:href|transform|id)$/.test(at.name)) g.setAttribute(at.name, at.value);
      }
      const x = parseFloat(u.getAttribute("x")) || 0, y = parseFloat(u.getAttribute("y")) || 0;
      g.setAttribute("transform", `${u.getAttribute("transform") || ""} translate(${x} ${y})`);
      let copy;
      if (target.localName === "symbol" || target.localName === "svg") {
        copy = document.createElementNS(SVGNS, "g");
        for (const at of Array.from(target.attributes)) {
          if (!/^(id|viewBox|x|y|width|height|preserveAspectRatio)$/.test(at.name)) copy.setAttribute(at.name, at.value);
        }
        for (const c of Array.from(target.childNodes)) copy.appendChild(c.cloneNode(true));
      } else {
        copy = target.cloneNode(true);
        copy.removeAttribute("id");
      }
      g.appendChild(copy);
      u.replaceWith(g);
    }
  }
}

// Scripts, event handlers, outside links and embedded documents go before the file is shown.
function sanitize(svg, notes) {
  for (const el of Array.from(svg.querySelectorAll("script, foreignObject, iframe, object, embed, audio, video"))) el.remove();
  const images = svg.querySelectorAll("image");
  if (images.length) notes.add("picture");
  for (const el of Array.from(images)) el.remove();
  for (const el of [svg, ...svg.querySelectorAll("*")]) {
    for (const at of Array.from(el.attributes)) {
      if (/^on/i.test(at.name)) el.removeAttribute(at.name);
      else if (/href$/i.test(at.name) && !at.value.trim().startsWith("#")) el.removeAttribute(at.name);
    }
  }
  for (const st of svg.querySelectorAll("style")) {
    st.textContent = st.textContent.replace(/@import[^;]*;?/g, "").replace(/url\(\s*['"]?(?!#)[^)]*\)/g, "none");
  }
}

// A paint (computed fill or stroke) -> {hex, a} or null. A gradient becomes the mix of its stops.
function paint(value, svg, notes) {
  if (!value || value === "none") return null;
  const g = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(value);
  if (g) {
    let el = svg.querySelector(`[id="${CSS.escape(g[1])}"]`);
    let stops = [];
    for (let hop = 0; el && hop < 8; hop++) {
      stops = Array.from(el.querySelectorAll("stop"));
      if (stops.length) break;
      const href = el.getAttribute("href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
      el = href.startsWith("#") ? svg.querySelector(`[id="${CSS.escape(href.slice(1))}"]`) : null;
    }
    const cols = stops.map((s) => {
      const cs = getComputedStyle(s);
      const c = parseColour(cs.stopColor);
      return c && c.a * (parseFloat(cs.stopOpacity) || 0) > 0.05 ? c.hex : null;
    }).filter(Boolean);
    const fallback = value.replace(g[0], "").trim();
    if (!cols.length) return fallback ? parseColour(fallback) : null;
    notes.add("gradient");
    return { hex: mix(cols), a: 1 };
  }
  return parseColour(value);
}

// ---------------------------------------------------------------- the logo

// SVG text -> {regions: [{hex, paths, area, background}], bounds, notes: Set, elements}
// `paths` are Clipper paths in the logo's own pixels (y down), times SCALE.
export function readLogo(text) {
  const notes = new Set();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const src = doc.documentElement;
  if (!src || src.localName !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("This file isn't an SVG drawing the browser can read. Export the logo as SVG and try again.");
  }
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${VIEW}px;height:${VIEW}px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden;contain:strict`;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const svg = document.importNode(src, true);
  sanitize(svg, notes);
  expandUses(svg);
  shadow.appendChild(svg);
  try {
    svg.setAttribute("width", VIEW);
    svg.setAttribute("height", VIEW);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.cssText += ";position:absolute;left:0;top:0;overflow:visible";
    const bb = svg.getBBox();
    if (!(bb.width > 0 || bb.height > 0)) throw new Error("The SVG has nothing in it to print.");
    const pad = Math.max(bb.width, bb.height) * 0.02;
    svg.setAttribute("viewBox", `${bb.x - pad} ${bb.y - pad} ${Math.max(bb.width, 1e-6) + 2 * pad} ${Math.max(bb.height, 1e-6) + 2 * pad}`);
    const box = svg.getBoundingClientRect();
    const origin = new DOMMatrix().translate(-box.left, -box.top);   // pixels from the drawing's corner

    const items = [];
    let textCount = 0, translucent = false, elements = 0;
    const visit = (el, opacity) => {
      if (SKIP.has(el.localName)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none") return;
      const op = opacity * (parseFloat(cs.opacity) || (cs.opacity === "0" ? 0 : 1));
      if (el.localName === "text") { textCount++; return; }
      if (SHAPES.has(el.localName)) {
        if (cs.visibility === "hidden" || cs.visibility === "collapse" || op < 0.05) return;
        elements++;
        const ctm = el.getScreenCTM();
        if (!ctm) return;
        const m = origin.multiply(ctm);
        const subs = flattenPath(shapeData(el), m);
        if (!subs.length) return;
        const ring = (s) => s.pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
        const fill = el.localName === "line" ? null : paint(cs.fill, svg, notes);
        if (fill) {
          const fo = op * fill.a * (parseFloat(cs.fillOpacity) || (cs.fillOpacity === "0" ? 0 : 1));
          if (fo >= 0.05) {
            if (fo < 0.95) translucent = true;
            const rule = cs.fillRule === "evenodd" ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
            const shape = union(subs.map(ring).filter((r) => r.length >= 3), rule);
            if (shape.length) items.push({ hex: fill.hex, paths: shape });
          }
        }
        const st = paint(cs.stroke, svg, notes);
        const sw = parseFloat(cs.strokeWidth) || 0;
        if (st && sw > 0) {
          const so = op * st.a * (parseFloat(cs.strokeOpacity) || (cs.strokeOpacity === "0" ? 0 : 1));
          if (so >= 0.05) {
            if (so < 0.95) translucent = true;
            const w = sw * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * SCALE;
            const lines = subs.map((s) => ({ path: ring(s), closed: s.closed }));
            const shape = stroke(lines, w, cs.strokeLinejoin, cs.strokeLinecap, parseFloat(cs.strokeMiterlimit) || 4);
            if (shape.length) items.push({ hex: st.hex, paths: shape });
          }
        }
        return;
      }
      for (const c of el.children) visit(c, op);
    };
    for (const c of svg.children) visit(c, 1);
    if (textCount) notes.add("text");
    if (translucent) notes.add("translucent");
    if (!items.length) {
      throw new Error(textCount ? "The logo's only content is text, which this page can't read. Convert the text to outlines (paths) and upload it again."
        : "The SVG has no filled shapes or lines to print.");
    }

    // later shapes cover earlier ones
    const tiny = 0.25 * SCALE * SCALE;
    let covered = [];
    const visible = [];
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      const v = covered.length ? diff(it.paths, covered) : it.paths;
      if (area(v) > tiny) visible.push({ hex: it.hex, paths: v, order: k });
      covered = union(covered.concat(it.paths));
    }
    visible.reverse();

    // A first shape that fills the drawing's whole box is most likely a background: it gets a
    // region of its own (left out to start with), so shapes of its colour on top of it can
    // still be printed.
    const all = bounds(covered);
    const fb = bounds(items[0].paths);
    const bg = items.length > 1 && all && fb && fb.w >= 0.97 * all.w && fb.h >= 0.97 * all.h
      && area(items[0].paths) >= 0.85 * all.w * all.h;

    // one region per colour, colours that look the same counted once
    const groups = [];
    for (const v of visible) {
      const isBg = bg && v.order === 0;
      let g = isBg ? null : groups.find((q) => !q.background && distance(q.hex, v.hex) < 4);
      if (!g) { g = { hex: v.hex, parts: [], first: v.order, background: isBg }; groups.push(g); }
      g.parts.push(v.paths);
    }
    const regions = groups.map((g) => {
      const paths = union(g.parts.flat());
      return { hex: g.hex, paths, area: area(paths) / (SCALE * SCALE), first: g.first, background: g.background };
    }).filter((r) => r.paths.length);
    regions.sort((a, b) => a.first - b.first);

    // A ready-made badge marks the badge's own outline (<rect id="badge-frame">, unpainted), so
    // its artwork can go back exactly where it was designed.
    let frame = null;
    const fr = svg.querySelector('[id="badge-frame"]');
    if (fr && fr.getScreenCTM()) {
      const m = origin.multiply(fr.getScreenCTM());
      const x = fr.x.baseVal.value, y = fr.y.baseVal.value, w = fr.width.baseVal.value, h = fr.height.baseVal.value;
      const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
      const xs = pts.map((q) => q[0] * SCALE), ys = pts.map((q) => q[1] * SCALE);
      frame = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    return { regions, bounds: all, notes, elements, frame };
  } finally {
    host.remove();
  }
}
