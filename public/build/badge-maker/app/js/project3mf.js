// The Bambu Studio project (.3mf): the printer's template with the badges in it.
//
// A port of the Sign maker's build_3mf (tools/sign.py, tools/parts.py and the keyfob script):
// one object per badge, each colour a part with its own filament, numbered the way Bambu Studio
// numbers them (bbs_3mf.cpp): object k's parts are meshes n..n+P-1 in 3D/Objects/object_k.model,
// the object wrapping them is n+P in 3D/3dmodel.model, and model_settings.config gives each part
// its filament. The printer file (printers/<id>.json, from tools/make-printers.py) holds the
// template's files and its print settings for four filaments; the ones a badge doesn't use go.

/* global fflate */
import { luminance, near } from "./colour.js";

const IDENTITY12 = "1 0 0 0 1 0 0 0 1 0 0 0";
const IDENTITY16 = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";
const EDGE = 5;               // badges and tower this far inside what the nozzles reach
const TOWER_GAP = 10;         // between the badges and the prime tower
export const FLUSH = { dark: "280", light: "900" };   // mm3 into a darker / lighter colour

const hex8 = (n) => n.toString(16).padStart(8, "0");
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (v) => +v.toFixed(5);

// Purge between filaments: the Sign maker's label card measured 900 mm3 into white after black
// (less leaves the first white layer grey) and 280 the other way; whichever colour is lighter
// gets the 900. Two near-identical colours (matte and glossy white) get the small purge both ways.
export function flushVolume(from, to) {
  if (near(from, to)) return FLUSH.dark;
  return luminance(to) > luminance(from) ? FLUSH.light : FLUSH.dark;
}

// z moved by dz: Bambu Studio wants each object's parts centred on its origin (the item's
// transform then lifts it by half its height), as its own projects store them.
function meshXml(mesh, dz = 0) {
  const v = mesh.v, t = mesh.t;
  // shared corners once (rounded to 0.01 micron), faces with three different corners only
  const index = new Map(), order = [], remap = new Int32Array(v.length / 3);
  for (let i = 0; i < v.length; i += 3) {
    const key = `${num(v[i])},${num(v[i + 1])},${num(v[i + 2] + dz)}`;
    let k = index.get(key);
    if (k === undefined) { k = order.length; index.set(key, k); order.push(key); }
    remap[i / 3] = k;
  }
  const vs = order.map((k) => { const [x, y, z] = k.split(","); return `     <vertex x="${x}" y="${y}" z="${z}"/>`; });
  const fs = [];
  for (let i = 0; i < t.length; i += 3) {
    const a = remap[t[i]], b = remap[t[i + 1]], c = remap[t[i + 2]];
    if (a !== b && b !== c && a !== c) fs.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return { xml: `<mesh>\n    <vertices>\n${vs.join("\n")}\n    </vertices>\n    <triangles>\n${fs.join("\n")}\n    </triangles>\n   </mesh>`, faces: fs.length };
}

function objectFiles(k, firstId, parts, objXml, partPat, name, sourceFile, dz) {
  const wid = firstId + parts.length;
  const path = `3D/Objects/object_${k}.model`;
  let head = partPat.slice(0, partPat.indexOf("    <part "));
  const partTpl = /    <part [\s\S]*?<\/part>\n/.exec(partPat)[0];
  const meshes = [], comps = [], blocks = [], faces = [];
  parts.forEach((p, i) => {
    const pid = firstId + i;
    const { xml, faces: n } = meshXml(p.mesh, dz);
    faces.push(n);
    meshes.push(`  <object id="${pid}" p:UUID="${hex8((k << 16) + i)}-81cb-4c03-9d28-80fed5dfa1dc" type="model">\n   ${xml}\n  </object>\n`);
    comps.push(`    <component p:path="/${path}" objectid="${pid}" p:UUID="${hex8((k << 16) + i)}-b206-40ff-9872-83e8017abed1" transform="${IDENTITY12}"/>\n`);
    let b = partTpl;
    b = b.replace(/<part id="\d+"/, `<part id="${pid}"`);
    b = b.replace(/uuid="[^"]+"/, `uuid="${crypto.randomUUID()}"`);
    b = b.replace(/(<metadata key="name" value=")[^"]*(")/g, (_, a, c) => a + attr(p.name) + c);
    b = b.replace(/(<metadata key="source_file" value=")[^"]*(")/g, (_, a, c) => a + attr(sourceFile) + c);
    b = b.replace(/(<metadata key="source_volume_id" value=")[^"]*(")/g, (_, a, c) => a + i + c);
    b = b.replace(/(<metadata key="matrix" value=")[^"]*(")/g, (_, a, c) => a + IDENTITY16 + c);
    b = b.replace(/(<metadata key="source_offset_[xyz]" value=")[^"]*(")/g, (_, a, c) => a + "0" + c);
    b = b.replace(/ *<metadata key="extruder" value="\d+"\/>\n/g, "");
    b = b.replace("      <mesh_stat", `      <metadata key="extruder" value="${p.extruder}"/>\n      <mesh_stat`);
    b = b.replace(/face_count="\d+"/, `face_count="${n}"`);
    blocks.push(b);
  });
  const model = objXml.replace(/<resources>[\s\S]*<\/resources>/, () => "<resources>\n" + meshes.join("") + " </resources>");
  const resource = `  <object id="${wid}" p:UUID="${hex8(k)}-61cb-4c03-9d28-80fed5dfa1dc" type="model">\n   <components>\n`
    + comps.join("") + "   </components>\n  </object>\n";
  head = head.replace(/<object id="\d+">/, `<object id="${wid}">`);
  head = head.replace(/(<metadata key="name" value=")[^"]*(")/, (_, a, c) => a + attr(name) + c);
  head = head.replace(/<metadata face_count="\d+"\/>/, `<metadata face_count="${faces.reduce((s, f) => s + f, 0)}"/>`);
  return { model, resource, settings: head + blocks.join("") + "  </object>\n", id: wid, next: wid + 1 };
}

// Where the badges go: a column (two once it gets tall) centred where every nozzle reaches, the
// prime tower's square beside it on the right, or behind it if the bed is too narrow.
export function bedPlan(printer, count, w, h, tower) {
  const cols = count > 6 ? 2 : 1, rows = Math.ceil(count / cols);
  const gapX = 6, gapY = 4;
  const bw = cols * w + (cols - 1) * gapX, bh = rows * h + (rows - 1) * gapY;
  const [bedW, bedH] = printer.bed;
  const x0 = printer.usable_x[0] + EDGE, x1 = printer.usable_x[1] - EDGE, y0 = EDGE, y1 = bedH - EDGE;
  const sq = Math.max(40, (+printer.settings.prime_tower_width || 35) + 10);
  let left, front, towerAt = null;
  if (!tower) {
    left = (x0 + x1 - bw) / 2; front = (y0 + y1 - bh) / 2;
  } else if (bw + TOWER_GAP + sq <= x1 - x0) {
    left = (x0 + x1 - (bw + TOWER_GAP + sq)) / 2; front = (y0 + y1 - bh) / 2;
    towerAt = [left + bw + TOWER_GAP, (y0 + y1) / 2 - sq / 2 + 5];
  } else {
    left = (x0 + x1 - bw) / 2; front = (y0 + y1 - (bh + TOWER_GAP + sq)) / 2;
    towerAt = [(x0 + x1) / 2 - sq / 2 + 5, front + bh + TOWER_GAP];
  }
  if (bh > y1 - y0 || bw > x1 - x0) throw new Error(`${count} badges don't fit on the ${printer.label}'s bed. Print fewer at a time.`);
  const spots = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    spots.push([left + c * (w + gapX) + w / 2, front + bh - r * (h + gapY) - h / 2]);
  }
  return { spots, tower: towerAt, bed: [bedW, bedH] };
}

// -> Uint8Array: the .3mf
//   badges: [{name, parts: [{name, mesh, extruder}], top, w, h}]
//   opt: {colours: [hex per filament], plate, style}
export function buildProject(printer, badges, opt) {
  const files = { ...printer.files };
  const objPath = Object.keys(files).find((k) => k.startsWith("3D/Objects/"));
  const objXml = files[objPath];
  delete files[objPath];
  let mm = files["3D/3dmodel.model"], ms = files["Metadata/model_settings.config"];
  let rels = files["3D/_rels/3dmodel.model.rels"];
  const d = JSON.parse(JSON.stringify(printer.settings));
  const n = opt.colours.length;

  const itemUuid = /<item [^>]*p:UUID="([^"]+)"/.exec(mm)[1];
  const itemTail = itemUuid.slice(itemUuid.indexOf("-"));
  const partPat = /  <object id="\d+">[\s\S]*?<\/object>\n/.exec(ms)[0];
  const instM = /    <model_instance>[\s\S]*?<\/model_instance>\n/.exec(ms);
  const instPat = instM ? instM[0] : null;

  const plan = bedPlan(printer, badges.length, badges[0].w, badges[0].h, n > 1);
  let resources = "", items = "", relLines = "", objs = "", insts = "", next = 1;
  badges.forEach((b, i) => {
    const k = i + 1;
    const o = objectFiles(k, next, b.parts, objXml, partPat, b.name, `${b.name.replace(/[^A-Za-z0-9]+/g, "_")}.stl`, -b.top / 2);
    next = o.next;
    files[`3D/Objects/object_${k}.model`] = o.model;
    resources += o.resource;
    const [x, y] = plan.spots[i];
    items += `  <item objectid="${o.id}" p:UUID="${hex8(o.id)}${itemTail}" transform="1 0 0 0 1 0 0 0 1 ${num(x)} ${num(y)} ${num(b.top / 2)}" printable="1"/>\n`;
    relLines += ` <Relationship Target="/3D/Objects/object_${k}.model" Id="rel-${k}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n`;
    objs += o.settings;
    if (instPat) {
      insts += instPat.replace(/(key="object_id" value=")\d+(")/, (_, a, c) => a + o.id + c)
        .replace(/(key="identify_id" value=")\d+(")/, (_, a, c) => a + (200 + k) + c);
    }
  });
  mm = mm.replace(/<resources>[\s\S]*<\/resources>/, () => "<resources>\n" + resources + " </resources>");
  mm = mm.replace(/<build[^>]*>[\s\S]*<\/build>/, (m) => m.slice(0, m.indexOf(">") + 1) + "\n" + items + " </build>");
  mm = mm.replace(/ *<metadata name="Thumbnail_[^"]*">[^<]*<\/metadata>\n/g, "");
  files["3D/3dmodel.model"] = mm;
  rels = rels.replace(/ <Relationship [\s\S]*?\/>\n/g, "");
  files["3D/_rels/3dmodel.model.rels"] = rels.replace("</Relationships>", relLines + "</Relationships>");
  ms = ms.replace(/  <object id="\d+">[\s\S]*<\/object>\n/, () => objs);
  if (instPat) ms = ms.replace(instPat, () => insts);
  ms = ms.replace(/  <plate>\s*<metadata key="plater_id" value="(?!1")\d+"\/>[\s\S]*?<\/plate>\n/g, "");
  ms = ms.replace(/  <assemble>[\s\S]*?<\/assemble>\n/g, "");
  ms = ms.replace(/ *<metadata key="(?:thumbnail_file|thumbnail_no_light_file|top_file|pick_file)" value="[^"]*"\/>\n/g, "");
  files["Metadata/model_settings.config"] = ms;
  if (files["Metadata/filament_sequence.json"]) {
    const fs = JSON.parse(files["Metadata/filament_sequence.json"]);
    for (const key of Object.keys(fs)) if (/^plate_(?!1$)\d+$/.test(key)) delete fs[key];
    files["Metadata/filament_sequence.json"] = JSON.stringify(fs);
  }
  if (files["_rels/.rels"]) {
    files["_rels/.rels"] = files["_rels/.rels"].replace(/ *<Relationship Target="\/Metadata\/[^"]*\.png"[^>]*\/>\n/g, "");
  }
  delete files["Metadata/custom_gcode_per_layer.xml"];

  // print settings: the filaments a badge uses, its colours, purges and plate
  for (const [key, stride] of Object.entries(printer.per_filament)) {
    const v = d[key];
    if (!Array.isArray(v)) continue;
    if (v.length === 4 * stride) d[key] = v.slice(0, n * stride);
    else if (v.length === stride) d[key] = Array.from({ length: n }, () => v).flat();
  }
  if (Array.isArray(d.flush_volumes_vector) && printer.flush_vector) {
    const per = printer.flush_vector / 4;
    d.flush_volumes_vector = d.flush_volumes_vector.slice(0, n * per);
  }
  const matrix = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) matrix.push(a === b ? "0" : flushVolume(opt.colours[a], opt.colours[b]));
  // one n x n block per nozzle group, as many as the printer's own four-filament project holds
  const blocks = Math.max(1, Math.round((printer.settings.flush_volumes_matrix || []).length / 16));
  d.flush_volumes_matrix = Array.from({ length: blocks }, () => matrix).flat();
  d.filament_colour = opt.colours.slice();
  d.filament_type = Array(n).fill("PLA");
  d.enable_prime_tower = n > 1 ? "1" : "0";
  for (const [key, i] of [["wipe_tower_x", 0], ["wipe_tower_y", 1]]) {
    const lst = (Array.isArray(d[key]) ? d[key] : [d[key] || "0"]).slice(0, 1);
    if (plan.tower) lst[0] = String(num(plan.tower[i]));
    d[key] = lst;
  }
  d.layer_height = "0.2";
  d.initial_layer_print_height = "0.2";
  d.curr_bed_type = opt.plate;
  d.enable_support = "0";
  d.wall_generator = "arachne";               // thin strokes as single lines instead of gaps
  if (Array.isArray(d.outer_wall_speed)) d.outer_wall_speed = d.outer_wall_speed.map((v) => String(Math.min(+v || 60, 60)));
  // face down, the face is the first layer: shrinking it for elephant's foot would open gaps
  // between the colours
  if (opt.style === "flush") d.elefant_foot_compensation = "0";
  files["Metadata/project_settings.config"] = JSON.stringify(d, null, 4);

  const enc = new TextEncoder();
  const zip = {};
  const order = Object.keys(files).sort((a, b) => {
    const r = (x) => (x === "[Content_Types].xml" ? 0 : x.startsWith("_rels") ? 1 : 2);
    return r(a) - r(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
  for (const k of order) zip[k] = enc.encode(files[k]);
  return { bytes: fflate.zipSync(zip, { level: 6 }), plan, flush: matrix };
}
