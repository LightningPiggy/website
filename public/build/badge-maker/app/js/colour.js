// Colour helpers: CSS colours to hex, closeness (CIE Lab), lightness.

const ctx = document.createElement("canvas").getContext("2d");

// Any CSS colour -> {hex: "#RRGGBB", a: 0..1}, or null.
export function parseColour(s) {
  if (!s || s === "none" || s === "transparent") return null;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s.trim());
  if (m) {
    let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: toHex(+m[1], +m[2], +m[3]), a };
  }
  ctx.fillStyle = "#000";
  ctx.fillStyle = s;                       // the canvas normalises what it understands
  const n = ctx.fillStyle;
  if (n.startsWith("#")) return { hex: n.toUpperCase(), a: 1 };
  return n.startsWith("rgb") && n !== s ? parseColour(n) : null;
}

export function toHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return ("#" + h(r) + h(g) + h(b)).toUpperCase();
}

export function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function lab(hex) {
  const lin = rgb(hex).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = lin;
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// CIE76 distance: about 2.3 is the smallest difference people notice.
export function distance(a, b) {
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// The same filament to the eye: the flush rule treats these as one colour.
export function near(a, b) {
  const p = rgb(a), q = rgb(b);
  return p.every((v, i) => Math.abs(v - q[i]) < 0.12 * 255);
}

export function mix(hexes) {
  const s = [0, 0, 0];
  for (const h of hexes) rgb(h).forEach((v, i) => (s[i] += v));
  return toHex(...s.map((v) => v / hexes.length));
}
