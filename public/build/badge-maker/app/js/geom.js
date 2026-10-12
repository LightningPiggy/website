// 2D shapes and the 3D parts made from them.
//
// A shape is a list of closed paths in Clipper's integer coordinates (SCALE units per mm, or per
// CSS pixel while a logo is being read), filled by the non-zero rule. Clipper (clipper-lib, the
// JavaScript port of Angus Johnson's Clipper 6) does the unions, differences and offsets; earcut
// triangulates the caps of each extruded part.

/* global ClipperLib, earcut */
const C = ClipperLib;
export const SCALE = 10000;                 // Clipper units per mm: 0.1 micron steps
const NZ = C.PolyFillType.pftNonZero;

function run(type, subject, clip, fill = NZ) {
  const c = new C.Clipper();
  c.StrictlySimple = true;
  if (subject.length) c.AddPaths(subject, C.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
  const out = [];
  c.Execute(type, out, fill, NZ);
  return out;
}

export const union = (paths, fill = NZ) => (paths.length ? run(C.ClipType.ctUnion, paths, null, fill) : []);
export const diff = (a, b) => (!a.length ? [] : !b.length ? a : run(C.ClipType.ctDifference, a, b));
export const intersect = (a, b) => (!a.length || !b.length ? [] : run(C.ClipType.ctIntersection, a, b));

// Grow (delta > 0) or shrink a shape, in Clipper units. Round corners, arcs to within `tol`.
export function offset(paths, delta, tol = 0.004 * SCALE) {
  if (!paths.length) return [];
  const o = new C.ClipperOffset(2, tol);
  o.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const out = [];
  o.Execute(out, delta);
  return out;
}

// A shape without its hairlines: slivers narrower than 2 * e (Clipper units) go, everything else
// keeps its exact outline (shrunk and grown back with mitred corners). Two logo parts that
// almost meet leave such slivers between them, too thin to triangulate into a closed mesh.
export function tidy(paths, e) {
  if (!paths.length) return [];
  const go = (p, d) => {
    const o = new C.ClipperOffset(4, 0.25);
    o.AddPaths(p, C.JoinType.jtMiter, C.EndType.etClosedPolygon);
    const out = [];
    o.Execute(out, d);
    return out;
  };
  return union(go(go(paths, -e), e));
}

// Open or closed lines widened into a shape: an SVG stroke (in the logo's pixels, so round
// joins to within 0.1 px).
export function stroke(lines, width, join = "miter", cap = "butt", miter = 4, tol = 0.1 * SCALE) {
  const jt = join === "round" ? C.JoinType.jtRound : join === "bevel" ? C.JoinType.jtSquare : C.JoinType.jtMiter;
  const o = new C.ClipperOffset(Math.max(miter, 1), tol);
  for (const l of lines) {
    if (l.path.length < 2) continue;
    const et = l.closed ? C.EndType.etClosedLine
      : cap === "round" ? C.EndType.etOpenRound : cap === "square" ? C.EndType.etOpenSquare : C.EndType.etOpenButt;
    o.AddPath(l.path, jt, et);
  }
  const out = [];
  o.Execute(out, width / 2);
  return union(out);
}

// Area in Clipper units squared: outlines count positive, holes negative.
export function area(paths) {
  let a = 0;
  for (const p of paths) a += C.Clipper.Area(p);
  return Math.abs(a);
}

export function bounds(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) {
    if (q.X < x0) x0 = q.X; if (q.X > x1) x1 = q.X;
    if (q.Y < y0) y0 = q.Y; if (q.Y > y1) y1 = q.Y;
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Every point through f(x, y) -> [x, y]. A transform that mirrors leaves the paths' winding
// reversed, which the non-zero fill and union() don't mind.
export function map(paths, f) {
  return paths.map((p) => p.map((q) => {
    const [x, y] = f(q.X, q.Y);
    return { X: Math.round(x), Y: Math.round(y) };
  }));
}

// A rounded rectangle centred on the origin, in mm -> Clipper units.
export function roundedRect(w, h, r, segs = 16) {
  const pts = [];
  const cx = w / 2 - r, cy = h / 2 - r;
  const corners = [[cx, cy, 0], [-cx, cy, 90], [-cx, -cy, 180], [cx, -cy, 270]];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = (a0 + (90 * i) / segs) * Math.PI / 180;
      pts.push({ X: Math.round((x + r * Math.cos(a)) * SCALE), Y: Math.round((y + r * Math.sin(a)) * SCALE) });
    }
  }
  return [pts];
}

// Outline + holes for each separate piece of a shape.
export function pieces(paths) {
  if (!paths.length) return [];
  const c = new C.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, NZ, NZ);
  return C.JS.PolyTreeToExPolygons(tree);
}

const exArea = (e) => Math.abs(C.Clipper.Area(e.outer)) - e.holes.reduce((s, h) => s + Math.abs(C.Clipper.Area(h)), 0);

// The parts of a shape narrower than `width` (Clipper units): what is left after shrinking it by
// half the width and growing it back. A piece that vanishes whole (a hairline, a tiny dot) counts
// however small; of the rest only strips bigger than `minArea` do, since every sharp point
// leaves a sliver (a 25-degree tip about 0.2 mm2 at 0.45 mm) that just prints a little rounder.
export function thinParts(paths, width, minArea, speck = 0.01 * SCALE * SCALE) {
  if (!paths.length) return [];
  const opened = offset(offset(paths, -width / 2), width / 2 + width * 0.08);
  const out = [];
  for (const e of pieces(paths)) {
    if (exArea(e) < speck) continue;
    const piece = [e.outer, ...e.holes];
    if (!intersect(piece, opened).length) { out.push(...piece); continue; }
    for (const r of pieces(diff(piece, opened))) if (exArea(r) > minArea) out.push(r.outer, ...r.holes);
  }
  return out;
}

const signedArea = (ring) => C.Clipper.Area(ring);

// earcut drops points that line up with their neighbours as it clips (the inner corners of an
// H's legs on the baseline, once the gap between the legs is filled), so a triangle edge can run
// past points that other triangles end at: the area is right but the mesh isn't closed there.
// Flat triangles go, and every inside edge with a point of the outline on it is split there.
function mend(tris, xy, rings) {
  const n = xy.length / 2;
  const cross = (a, b, c) => (xy[2 * b] - xy[2 * a]) * (xy[2 * c + 1] - xy[2 * a + 1])
    - (xy[2 * b + 1] - xy[2 * a + 1]) * (xy[2 * c] - xy[2 * a]);
  const key = (a, b) => (a < b ? a * n + b : b * n + a);
  const edges = new Set();
  let s = 0;
  for (const m of rings) {
    for (let i = 0; i < m; i++) edges.add(key(s + i, s + ((i + 1) % m)));
    s += m;
  }
  let T = [];
  for (let i = 0; i < tris.length; i += 3) {
    if (Math.abs(cross(tris[i], tris[i + 1], tris[i + 2])) > 1e-12) T.push([tris[i], tris[i + 1], tris[i + 2]]);
  }
  for (let round = 0; round < 16; round++) {
    const count = new Map();
    for (const t of T) for (let e = 0; e < 3; e++) { const k = key(t[e], t[(e + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
    let changed = false;
    const out = [];
    for (const t of T) {
      let split = null;
      for (let e = 0; e < 3 && !split; e++) {
        const a = t[e], b = t[(e + 1) % 3], c = t[(e + 2) % 3];
        const k = key(a, b);
        if (count.get(k) !== 1 || edges.has(k)) continue;
        const dx = xy[2 * b] - xy[2 * a], dy = xy[2 * b + 1] - xy[2 * a + 1], len2 = dx * dx + dy * dy;
        const mids = [];
        for (let v = 0; v < n; v++) {
          if (v === a || v === b) continue;
          const u = ((xy[2 * v] - xy[2 * a]) * dx + (xy[2 * v + 1] - xy[2 * a + 1]) * dy) / len2;
          if (u <= 1e-9 || u >= 1 - 1e-9) continue;
          if (Math.abs(cross(a, b, v)) > 1e-9 * Math.sqrt(len2)) continue;
          mids.push([u, v]);
        }
        if (!mids.length) continue;
        mids.sort((p, q) => p[0] - q[0]);
        split = [];
        let prev = a;
        for (const [, m] of mids) { split.push([prev, m, c]); prev = m; }
        split.push([prev, b, c]);
      }
      if (split) { out.push(...split); changed = true; } else out.push(t);
    }
    T = out;
    if (!changed) break;
  }
  return T.flat();
}

// A shape (Clipper units) extruded from z0 to z1 mm -> triangles as one indexed mesh:
// {v: [x, y, z, ...] in mm, t: [a, b, c, ...]}, outward faces counter-clockwise.
export function extrude(paths, z0, z1, mesh = { v: [], t: [] }) {
  for (const piece of pieces(paths)) {
    const rings = [piece.outer, ...piece.holes].map((r, i) => {
      const ring = r.map((q) => [q.X / SCALE, q.Y / SCALE]);
      const ccw = signedArea(r) > 0;
      // outline counter-clockwise, holes clockwise (seen from above)
      return (i === 0) === ccw ? ring : ring.reverse();
    }).filter((r) => r.length >= 3);
    if (!rings.length) continue;
    const flat = [], holes = [];
    for (const r of rings) {
      if (flat.length) holes.push(flat.length / 2);
      for (const [x, y] of r) flat.push(x, y);
    }
    const n = flat.length / 2;
    const base = mesh.v.length / 3;
    for (let i = 0; i < n; i++) mesh.v.push(flat[2 * i], flat[2 * i + 1], z0);
    for (let i = 0; i < n; i++) mesh.v.push(flat[2 * i], flat[2 * i + 1], z1);
    const tris = mend(earcut(flat, holes, 2), flat, rings.map((r) => r.length));
    for (let i = 0; i < tris.length; i += 3) {
      let [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
      // earcut keeps no particular winding: face the top up, the bottom down
      const cross = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1])
        - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
      if (cross < 0) [b, c] = [c, b];
      mesh.t.push(base + n + a, base + n + b, base + n + c);   // top
      mesh.t.push(base + a, base + c, base + b);               // bottom
    }
    let start = 0;
    for (const r of rings) {
      const m = r.length;
      for (let i = 0; i < m; i++) {
        const a = base + start + i, b = base + start + ((i + 1) % m);
        mesh.t.push(a, b, b + n, a, b + n, a + n);
      }
      start += m;
    }
  }
  return mesh;
}

// Volume in mm3 of a closed mesh (signed tetrahedra from the origin).
export function meshVolume(mesh) {
  const v = mesh.v, t = mesh.t;
  let s = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2];
    s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
      - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c])
      + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return s / 6;
}
