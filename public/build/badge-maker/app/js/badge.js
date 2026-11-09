// The badge: its outline, where the logo and name go, and the coloured parts.
//
// The size is the ZapStand's badge slot's: 50.2 x 12.2 mm with 2 mm corners, as the Bull
// Bitcoin and shop21.dk badges are. The logo and name sit 1 mm inside the long edges and 3 mm
// inside the short ones (the Bull Bitcoin badge's margins), 1.6 mm apart, as one centred row.
//
// Two ways to print it:
//   flush  -- face down: the badge's face is the first 1.2 mm on the print plate, each colour a
//             part of its own set into it, then the rest of the badge on top. The face comes
//             out flat, with the plate's texture; 1.2 mm of a colour hides what is behind it.
//   raised -- face up: a plain badge with the logo and name standing 1.2 mm proud of it.
// Both use 0.2 mm layers, so every colour starts and ends on a layer boundary.

import { SCALE, union, diff, intersect, offset, tidy, area, bounds, map, roundedRect, thinParts, extrude, meshVolume } from "./geom.js";
import { textShape } from "./text.js";

export const BADGE = {
  w: 50.2, h: 12.2, r: 2.0,         // the outline, mm
  marginX: 3.0, marginY: 1.0,       // content kept this far in from the edges
  gap: 1.6,                         // between logo and name
  gapAbove: 0.8,                    // between a logo above the name and the name
  inlay: 1.2,                       // depth of the flush colours (6 layers)
  relief: 1.2,                      // height of the raised colours (6 layers)
  border: { inset: 0.8, width: 0.6, clear: 0.8 },   // the optional line round the edge
  thin: 0.4,                        // narrower than the 0.4 mm nozzle may print rough or not at all
  thicknesses: [3.6, 4.6, 5.6],
};

const S = SCALE;

// The design -> {outline, colours: [{fil, paths, roles}], face, items, thin, place, notes}. Shapes in
// Clipper units, mm * SCALE, centred on the badge, y up, seen from the front. Filaments are
// keys ("PLA Basic/Black"): two filaments of one colour, matte and glossy, stay two.
//   d.logo:   {data (readLogo), use: [filament or null per region], height (mm)} or null
//   d.name:   {text, font (opentype), cap (mm), colour (filament)} or null
//   d.badge, d.style ("flush" | "raised"), d.side ("left" | "right"), d.border (filament or null)
export function compose(d) {
  const notes = [];
  const outline = roundedRect(BADGE.w, BADGE.h, BADGE.r);
  const b = BADGE.border;
  const ringOut = b.inset, ringIn = b.inset + b.width;
  const edgeY = d.border ? Math.max(BADGE.marginY, ringIn + b.clear) : BADGE.marginY;
  const edgeX = d.border ? Math.max(BADGE.marginX, ringIn + b.clear) : BADGE.marginX;
  const cw = BADGE.w - 2 * edgeX, ch = BADGE.h - 2 * edgeY;

  const stacked = d.side === "above" && d.logo && d.name;
  // a ready-made badge's artwork, placed as it was designed (unless a name is added to it)
  const asDrawn = !!(d.logo && d.logo.data.frame && !d.name);
  const name0 = d.name ? Math.min(d.name.cap, ch) : 0;

  // logo: the regions in use, scaled to fit
  let logo = null;
  if (d.logo) {
    const used = d.logo.data.regions.map((r, i) => ({ ...r, fil: d.logo.use[i] })).filter((r) => r.fil);
    const lb = bounds(used.flatMap((r) => r.paths));
    if (lb && lb.w > 0 && lb.h > 0) {
      const aspect = lb.w / lb.h;
      let h = Math.min(d.logo.height, ch), w = h * aspect;
      const maxW = d.name && !stacked ? cw * 0.6 : cw;
      if (w > maxW) { w = maxW; h = w / aspect; }
      // above the name: logo and capitals share the height, both shrunk alike when they don't fit
      if (stacked && h + BADGE.gapAbove + name0 > ch) {
        const k = (ch - BADGE.gapAbove) / (h + name0);
        h *= k; w *= k;
      }
      logo = { used, lb, w, h };
    }
  }

  // name: at the asked capital height, smaller if it doesn't fit
  let name = null;
  if (d.name) {
    const availW = stacked ? cw : cw - (logo ? logo.w + BADGE.gap : 0);
    const availH = stacked && logo ? ch - logo.h - BADGE.gapAbove : ch;
    let cap = name0;
    let t = textShape(d.name.font, d.name.text, cap);
    let nb = bounds(t.paths);
    if (nb) {
      const k = Math.min(1, availW * S / nb.w, availH * S / nb.h);
      if (k < 0.999) {
        cap *= k * 0.999;
        t = textShape(d.name.font, d.name.text, cap);
        nb = bounds(t.paths);
      }
      name = { paths: t.paths, nb, cap, missing: t.missing };
      if (t.missing.length) notes.push({ level: "warn", text: `The font has no ${[...new Set(t.missing)].join(" ")}: those letters are left out. Try another font.` });
      if (cap < d.name.cap - 0.05) {
        const wide = logo && !stacked && logo.w > cw * 0.45;
        notes.push({ level: cap < 2.5 ? "warn" : "info", text: `The name is ${cap.toFixed(1)} mm tall to fit (capital letters). `
          + (cap < 2.5 ? "Letters under 2.5 mm get hard to read. " : "")
          + (wide ? "With a wide logo, putting the logo above the name gives both more room." : cap < 2.5 ? "A shorter name or a smaller logo makes them bigger." : "") });
      }
    }
  }

  const items = [];
  const place = { logo: null, name: null };
  const putLogo = (x0, top) => {
    const { lb, w, h } = logo;
    for (const r of logo.used) {
      items.push({ fil: r.fil, role: "logo", paths: map(r.paths, (px, py) => [
        (x0 + ((px - lb.x0) / lb.w) * w) * S, (top - ((py - lb.y0) / lb.h) * h) * S]) });
    }
    place.logo = { x: x0, y: top - h, w, h };
  };
  const putName = (x0, base) => {
    const { nb, cap } = name;
    const dx = x0 - nb.x0 / S;
    items.push({ fil: d.name.colour, role: "name", paths: map(name.paths, (px, py) => [px + dx * S, py + base * S]) });
    place.name = { x: x0, y: nb.y0 / S + base, w: nb.w / S, h: nb.h / S, cap };
  };
  if (asDrawn && logo) {
    const f = d.logo.data.frame;
    for (const r of logo.used) {
      items.push({ fil: r.fil, role: "logo", paths: map(r.paths, (px, py) => [
        ((px - f.x0) / (f.x1 - f.x0) - 0.5) * BADGE.w * S, (0.5 - (py - f.y0) / (f.y1 - f.y0)) * BADGE.h * S]) });
    }
    place.logo = { x: -BADGE.w / 2, y: -BADGE.h / 2, w: BADGE.w, h: BADGE.h };
  } else if (stacked && logo && name) {
    // logo above, the name's ink below it, the pair centred both ways
    const nh = name.nb.h / S, total = logo.h + BADGE.gapAbove + nh, top = total / 2;
    putLogo(-logo.w / 2, top);
    putName(-name.nb.w / S / 2, top - logo.h - BADGE.gapAbove - name.nb.y1 / S);
  } else {
    // one centred row: logo, gap, name (or the other way round)
    const lw = logo ? logo.w : 0, nw = name ? name.nb.w / S : 0;
    let x = -(lw + nw + (logo && name ? BADGE.gap : 0)) / 2;
    for (const what of d.side === "right" ? ["name", "logo"] : ["logo", "name"]) {
      if (what === "logo" && logo) { putLogo(x, logo.h / 2); x += logo.w + BADGE.gap; }
      if (what === "name" && name) {
        // capitals centred on the badge, kept inside the content box
        const { nb, cap } = name;
        let base = -cap / 2;
        const inkTop = nb.y1 / S + base, inkBot = nb.y0 / S + base;
        if (inkBot < -ch / 2) base += -ch / 2 - inkBot;
        if (inkTop > ch / 2) base -= inkTop - ch / 2;
        putName(x, base);
        x += nw + BADGE.gap;
      }
    }
  }
  if (d.border) {
    items.push({ fil: d.border, role: "border",
      paths: diff(offset(outline, -ringOut * S), offset(outline, -ringIn * S)) });
  }

  // later items cover earlier ones (the name over the logo), then one shape per colour
  // kept off the very edge, except artwork placed as designed (a raised border may run to it)
  const inside = asDrawn ? outline : offset(outline, -0.3 * S);
  let covered = [];
  const visible = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const p = intersect(covered.length ? diff(it.paths, covered) : it.paths, inside);
    if (p.length) visible.unshift({ ...it, paths: p });
    covered = union(covered.concat(it.paths));
  }
  const colours = [];
  for (const v of visible) {
    if (d.style === "flush" && v.fil === d.badge) continue;       // flush in the badge's own colour: just the face
    let c = colours.find((q) => q.fil === v.fil);
    if (!c) { c = { fil: v.fil, paths: [], roles: new Set() }; colours.push(c); }
    c.paths.push(...v.paths);
    c.roles.add(v.role);
  }
  // hairline slivers (under 0.02 mm, where two parts of a logo almost meet) left out
  for (const c of colours) c.paths = tidy(union(c.paths), 0.01 * S);
  const face = d.style === "flush" ? tidy(diff(outline, union(colours.flatMap((c) => c.paths))), 0.01 * S) : outline;

  // details too thin to print, in any colour (and, set flush, the face between them)
  const minArea = 0.3 * S * S;
  let thin = colours.flatMap((c) => thinParts(c.paths, BADGE.thin * S, minArea));
  if (d.style === "flush") thin = thin.concat(thinParts(face, BADGE.thin * S, minArea));
  thin = union(thin);
  if (thin.length) {
    const mm2 = area(thin) / (S * S);
    notes.push({ level: "warn", text: `Some details are narrower than the ${BADGE.thin} mm nozzle (marked in red) and may print `
      + `rough or not at all${mm2 > 2 ? "" : ", but it's only a little"}. A bigger logo or a simpler version of it helps.` });
  }
  return { outline, colours, face, items: visible, thin, place, notes, content: { w: cw, h: ch } };
}

// The filaments in slot order: the badge first, then the colours as they appear.
export function filaments(design, comp) {
  const list = [design.badge];
  for (const c of comp.colours) if (!list.includes(c.fil)) list.push(c.fil);
  return list;
}

// The badge's parts as meshes, bottom first, in the badge's frame (centred, z from 0).
// -> {parts: [{name, mesh, extruder}], top}
export function parts(design, comp, slots, label = (f) => f) {
  const T = design.thickness;
  const ex = (fil) => slots.indexOf(fil) + 1;
  const out = [];
  if (design.style === "flush") {
    // face down: mirror left-right so the face reads right way round from the front
    const flip = (p) => map(p, (x, y) => [-x, y]);
    out.push({ name: "Face", role: "badge", mesh: extrude(flip(comp.face), 0, BADGE.inlay), extruder: ex(design.badge) });
    out.push({ name: "Back", role: "badge", mesh: extrude(flip(comp.outline), BADGE.inlay, T), extruder: ex(design.badge) });
    for (const c of comp.colours) {
      out.push({ name: partName(c, label), role: partRole(c), mesh: extrude(flip(c.paths), 0, BADGE.inlay), extruder: ex(c.fil) });
    }
    return { parts: out, top: T };
  }
  out.push({ name: "Badge", role: "badge", mesh: extrude(comp.outline, 0, T), extruder: ex(design.badge) });
  for (const c of comp.colours) {
    out.push({ name: partName(c, label), role: partRole(c), mesh: extrude(c.paths, T, T + BADGE.relief), extruder: ex(c.fil) });
  }
  return { parts: out, top: T + BADGE.relief };
}

const partRole = (c) => [...c.roles].map((r) => (r === "border" ? "edge" : r)).join("-");

function partName(c, label) {
  const roles = [...c.roles];
  const what = roles.length === 1 ? { logo: "Logo", name: "Name", border: "Border" }[roles[0]] : roles.map((r) => r[0].toUpperCase() + r.slice(1)).join(" + ");
  return `${what} (${label(c.fil)})`;
}

// The volumes must add up: the colours of a flush face fill the face exactly, so the face
// plus the colours is the whole outline's 1.2 mm.
export function checkParts(design, built) {
  const total = built.parts.reduce((s, p) => s + meshVolume(p.mesh), 0);
  const plate = area(roundedRect(BADGE.w, BADGE.h, BADGE.r)) / (S * S);
  const expect = design.style === "flush" ? plate * design.thickness : null;
  for (const p of built.parts) {
    if (!(meshVolume(p.mesh) > 0)) throw new Error(`The ${p.name} part came out empty or inside out.`);
  }
  if (expect && Math.abs(total - expect) > expect * 0.002) {
    throw new Error(`The parts don't add up (${total.toFixed(1)} of ${expect.toFixed(1)} mm3).`);
  }
  return total;
}
