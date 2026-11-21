// Downloads for any printer: a plain .3mf with each colour as its own part, or STL files, one
// per colour.
//
// The .3mf is core 3MF and nothing else: the badge is one object made of components, one mesh
// per part, each part named for its filament ("Filament 2: logo, Sunflower Yellow") and given
// that filament's colour through the 3MF colour materials (<basematerials displaycolor>).
// Copies are further build items of the same object. No print settings go in: slicers keep the
// parts of one object together, and the filament for each part is picked in the slicer.
// The STL files share one origin (the badge's centre, the plate at z = 0), so loaded together
// as one object the colours land in place.

/* global fflate */

const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (v) => +v.toFixed(5);
const CENTRE = [90, 90];          // the middle of a 180 mm bed, the smallest common one

const slug = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

function meshXml(mesh) {
  const index = new Map(), vs = [], ts = [];
  const v = mesh.v, t = mesh.t, remap = [];
  for (let k = 0; k < v.length; k += 3) {
    const key = `${num(v[k])},${num(v[k + 1])},${num(v[k + 2])}`;
    let n = index.get(key);
    if (n === undefined) { n = vs.length; index.set(key, n); vs.push(key); }
    remap.push(n);
  }
  for (let k = 0; k < t.length; k += 3) {
    const a = remap[t[k]], b = remap[t[k + 1]], c = remap[t[k + 2]];
    if (a !== b && b !== c && a !== c) ts.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return `   <mesh>\n    <vertices>\n`
    + vs.map((k) => { const [x, y, z] = k.split(","); return `     <vertex x="${x}" y="${y}" z="${z}"/>`; }).join("\n")
    + `\n    </vertices>\n    <triangles>\n${ts.join("\n")}\n    </triangles>\n   </mesh>\n`;
}

// -> Uint8Array: the .3mf.  parts: [{role, mesh, extruder}] of one badge; filaments: [{name,
// hex}] in slot order; copies laid out in a column (two once there are more than six).
export function genericProject(parts, filaments, title, copies, w, h) {
  const res = [`  <basematerials id="1">\n`
    + filaments.map((f, i) => `   <base name="Filament ${i + 1}: ${attr(f.name)}" displaycolor="${f.hex}FF"/>\n`).join("")
    + `  </basematerials>\n`];
  const comps = [];
  const roleName = { badge: "badge", logo: "logo", name: "name", edge: "edge line" };
  parts.forEach((p, i) => {
    const id = i + 2, f = filaments[p.extruder - 1];
    const what = p.role.split("-").map((r) => roleName[r] || r).join(" and ");
    const part = p.name === "Face" ? "badge face" : p.name === "Back" ? "badge back" : what;
    res.push(`  <object id="${id}" name="${attr(`Filament ${p.extruder}: ${part}, ${f.name}`)}" type="model" pid="1" pindex="${p.extruder - 1}">\n`
      + meshXml(p.mesh) + `  </object>\n`);
    comps.push(`    <component objectid="${id}"/>\n`);
  });
  const badgeId = parts.length + 2;
  res.push(`  <object id="${badgeId}" name="${attr(title)}" type="model">\n   <components>\n${comps.join("")}   </components>\n  </object>\n`);
  const cols = copies > 6 ? 2 : 1, rows = Math.ceil(copies / cols);
  const gapX = 6, gapY = 4;
  const bw = cols * w + (cols - 1) * gapX, bh = rows * h + (rows - 1) * gapY;
  const items = [];
  for (let i = 0; i < copies; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = CENTRE[0] - bw / 2 + c * (w + gapX) + w / 2, y = CENTRE[1] + bh / 2 - r * (h + gapY) - h / 2;
    items.push(`  <item objectid="${badgeId}" transform="1 0 0 0 1 0 0 0 1 ${num(x)} ${num(y)} 0"/>\n`);
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n`
    + ` <metadata name="Title">${attr(title)}</metadata>\n`
    + ` <metadata name="Application">ZapStand Badge Maker</metadata>\n`
    + ` <resources>\n${res.join("")} </resources>\n <build>\n${items.join("")} </build>\n</model>\n`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n`
      + ` <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n`
      + ` <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n`
      + ` <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n`,
    "3D/3dmodel.model": model,
  };
  const enc = new TextEncoder(), zip = {};
  for (const [k, v] of Object.entries(files)) zip[k] = enc.encode(v);
  return fflate.zipSync(zip, { level: 6 });
}

// A binary STL of one or more meshes.
function stl(meshes, name) {
  let count = 0;
  for (const m of meshes) count += m.t.length / 3;
  const buf = new ArrayBuffer(84 + 50 * count), dv = new DataView(buf);
  const head = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf, 0, head.length).set(head);
  dv.setUint32(80, count, true);
  let o = 84;
  for (const m of meshes) {
    const v = m.v, t = m.t;
    for (let k = 0; k < t.length; k += 3) {
      const a = 3 * t[k], b = 3 * t[k + 1], c = 3 * t[k + 2];
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const val of [nx, ny, nz, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]]) {
        dv.setFloat32(o, val, true); o += 4;
      }
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

// -> {bytes, ext}: one STL per filament ("1-badge-black.stl"), parts of one filament together,
// zipped when there is more than one.
export function stlFiles(parts, filaments, title) {
  const files = {};
  filaments.forEach((f, i) => {
    const mine = parts.filter((p) => p.extruder === i + 1);
    if (!mine.length) return;
    const what = [...new Set(mine.map((p) => p.role))].join("-");
    files[`${i + 1}-${slug(what)}-${slug(f.name)}.stl`] = stl(mine.map((p) => p.mesh), `${title} ${what} ${f.name}`);
  });
  const names = Object.keys(files);
  if (names.length === 1) return { bytes: files[names[0]], ext: "stl" };
  return { bytes: fflate.zipSync(files, { level: 6 }), ext: "zip" };
}
