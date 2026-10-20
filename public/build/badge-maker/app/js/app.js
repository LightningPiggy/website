// The page: controls -> design -> preview, and the download.

import { FILAMENTS } from "./palette.js";
import { SCALE, extrude, roundedRect } from "./geom.js";
import { readLogo } from "./svg.js";
import { FONTS, loadFont } from "./text.js";
import { BADGE, compose, filaments, parts, checkParts } from "./badge.js";
import { buildProject } from "./project3mf.js";
import { genericProject, stlFiles } from "./generic.js";
import { distance, luminance } from "./colour.js";

const $ = (s) => document.querySelector(s);
const STORE = "zapstand-badge-v1";

// ---------------------------------------------------------------- filaments

const FIL = new Map(FILAMENTS.map(([line, name, hex, code]) => [`${line}/${name}`, { key: `${line}/${name}`, line, name, hex, code }]));

function fil(key) {
  if (FIL.has(key)) return FIL.get(key);
  const m = /^custom\/(#[0-9A-F]{6})$/i.exec(key || "");
  if (m) return { key, line: "Other", name: m[1].toUpperCase(), hex: m[1].toUpperCase() };
  return FIL.get("PLA Basic/Black");
}
const hexOf = (key) => fil(key).hex;
const label = (key) => { const f = fil(key); return f.line === "Other" ? `PLA ${f.name}` : `${f.name}, ${f.line}`; };

// the closest Bambu filament to a logo colour (PLA Basic wins a tie)
function nearest(hex) {
  let best = null, bd = Infinity;
  for (const f of FIL.values()) {
    const dd = distance(hex, f.hex) + (f.line === "PLA Basic" ? 0 : 0.5);
    if (dd < bd) { bd = dd; best = f; }
  }
  return best.key;
}

// ---------------------------------------------------------------- state

const EXAMPLE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 100"><path fill="#FEC600" d="M38 0 6 56h24l-8 44 36-62H34z"/></svg>`;

const DEFAULTS = {
  name: "SATOSHI", font: "bebas", cap: 5.4, nameColour: "PLA Basic/Jade White",
  logo: { svg: EXAMPLE_LOGO, fileName: "Example: lightning bolt", use: null, height: 10.2, example: true },
  side: "left", badge: "PLA Basic/Black", style: "raised", thickness: 3.6,   // raised, as the ready-made badges are
  borderOn: false, border: "PLA Basic/Gray",
  preset: "satoshi",                       // the example is the gallery's SATOSHI badge, marked there
  printer: "a1", plate: "Textured PEI Plate", copies: 1,
  stand: "classic", standColours: {},     // per stand: a filament for its main colour, or its own
};

let state = load();
let logoData = null;           // readLogo() of state.logo.svg
let current = null;            // {design, comp}
let printers = [];
const OTHER = "other";           // any printer: a plain .3mf or STL files

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "null");
    if (s && typeof s === "object") {
      // the first stand was "zapstand" before the stands were named after their animals
      if (s.stand === "zapstand") s.stand = "classic";
      if (s.standColours && "zapstand" in s.standColours) { s.standColours.classic = s.standColours.zapstand; delete s.standColours.zapstand; }
      return { ...DEFAULTS, ...s };
    }
  } catch (e) { /* storage blocked: start fresh */ }
  return structuredClone(DEFAULTS);
}
function save() {
  try {
    const s = { ...state };
    if (s.logo && s.logo.svg.length > 400000) s.logo = null;    // too big to keep between visits
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch (e) { /* not kept: fine */ }
}

// ---------------------------------------------------------------- logo

// colours: the filament for each of the logo's colours, where known (a ready-made badge's)
function setLogo(svgText, fileName, example = false, colours = null) {
  const data = readLogo(svgText);                  // throws with a message people can act on
  logoData = data;
  const use = data.regions.map((r) => (r.background ? null : (colours && colours[r.hex]) || nearest(r.hex)));
  state.logo = { svg: svgText, fileName, use, height: state.logo ? state.logo.height : 10.2, example };
}

function restoreLogo() {
  if (!state.logo) return;
  try {
    const keep = state.logo.use;
    logoData = readLogo(state.logo.svg);
    if (!Array.isArray(keep) || keep.length !== logoData.regions.length) {
      state.logo.use = logoData.regions.map((r) => (r.background ? null : nearest(r.hex)));
    }
  } catch (e) {
    state.logo = null; logoData = null;
  }
}

async function readFile(file) {
  if (!file) return;
  if (!/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") {
    toast(`${file.name} isn't an SVG file. Export the logo as SVG (a vector file) and try again.`);
    return;
  }
  try {
    setLogo(await file.text(), file.name);
    state.preset = null;
    if (!state.name) state.side = "left";
    syncControls(); changed();
  } catch (e) {
    toast(e.message);
  }
}

// ---------------------------------------------------------------- ready-made badges

let designs = [];

function readymadeUI() {
  $("#readymade").hidden = !designs.length;
  $("#readymade-list").replaceChildren(...designs.map((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.preset === d.id));
    b.innerHTML = `<span class="mini-badge"><img alt="" loading="lazy"></span><span class="t"></span>`;
    b.querySelector(".mini-badge").style.background = d.badgeHex;
    b.querySelector(".mini-badge").classList.toggle("fit", !!d.fit);      // fitted inside the margins, as the page lays it out
    b.querySelector("img").src = d.svg;
    b.querySelector(".t").textContent = d.title;
    b.setAttribute("aria-label", `${d.title} badge`);
    b.addEventListener("click", () => loadDesign(d));
    return b;
  }));
}

// The page's own example (the bolt and SATOSHI): its logo and name back as they start, the name a
// name people can change; the printer and stand stay as they are.
const DESIGN_KEYS = ["name", "font", "cap", "nameColour", "logo", "side", "badge", "style", "thickness", "borderOn", "border"];

async function loadDesign(d) {
  if (d.example) {
    const fresh = structuredClone(DEFAULTS);
    for (const k of DESIGN_KEYS) state[k] = fresh[k];
    Object.assign(state, { preset: d.id, badge: d.badge, style: d.style, thickness: d.thickness });
    restoreLogo(); syncControls(); readymadeUI(); changed();
    return;
  }
  try {
    const r = await fetch(d.svg);
    if (!r.ok) throw new Error(`Couldn't load the ${d.title} badge (${r.status}).`);
    setLogo(await r.text(), `${d.title} (ready-made)`, false, d.colours);
    Object.assign(state, { preset: d.id, name: "", badge: d.badge, style: d.style, thickness: d.thickness, borderOn: false, side: "left" });
    state.logo.height = 10.2;
    syncControls(); readymadeUI(); changed();
  } catch (e) {
    toast(e.message || String(e));
  }
}

// ---------------------------------------------------------------- the design

async function design() {
  const text = (state.name || "").replace(/\s+/g, " ").trim();
  const font = text ? await loadFont(state.font) : null;
  return {
    badge: state.badge, style: state.style, thickness: +state.thickness, side: state.side,
    border: state.borderOn ? state.border : null,
    name: text ? { text, font, cap: +state.cap, colour: state.nameColour } : null,
    logo: state.logo && logoData ? { data: logoData, use: state.logo.use, height: +state.logo.height } : null,
  };
}

let seq = 0, timer = 0;
function changed() {
  save();
  clearTimeout(timer);
  timer = setTimeout(render, 60);
}

async function render() {
  const my = ++seq;
  $("#busy").hidden = false;
  try {
    const d = await design();
    if (my !== seq) return;
    if (!d.name && !d.logo) {
      current = { design: d, comp: null };
      draw(null, d); slotsUI(d, null); xsectionUI(d, null);
      standUpdate();
      notesUI([{ level: "warn", text: "Add a name or upload a logo: there's nothing on the badge yet." }]);
      $("#download").disabled = true;
      return;
    }
    const comp = compose(d);
    current = { design: d, comp };
    draw(comp, d);
    standUpdate();
    const slots = slotsUI(d, comp);
    xsectionUI(d, comp);
    notesUI(collectNotes(d, comp, slots));
    $("#download").disabled = false;
  } catch (e) {
    console.error(e);
    notesUI([{ level: "warn", text: e.message || String(e) }]);
  } finally {
    if (my === seq) $("#busy").hidden = true;
  }
}

function collectNotes(d, comp, slots) {
  const out = [];
  const n = logoData ? logoData.notes : new Set();
  if (d.logo) {
    if (n.has("picture")) out.push({ level: "warn", text: "The SVG has a picture (PNG or JPG) inside it, which can't be printed, so it's left out. Use a vector version of the logo." });
    if (n.has("text")) out.push({ level: "warn", text: "The SVG has text that isn't converted to outlines, so it's left out. Convert the text to paths (Inkscape: Path › Object to Path; Illustrator: Type › Create Outlines) and upload it again." });
    if (n.has("gradient")) out.push({ level: "info", text: "A colour gradient in the logo is printed as one colour, the mix of its ends." });
    if (n.has("translucent")) out.push({ level: "info", text: "See-through parts of the logo are printed solid." });
    const bg = logoData.regions.findIndex((r) => r.background);
    if (bg >= 0 && !state.logo.use[bg]) out.push({ level: "info", text: "The logo's first shape fills its whole box, so it looks like a background and is left out. Pick a filament for it to print it." });
    // (not for a ready-made badge: there it is the design, letters showing the face through another colour)
    if (d.style === "flush" && state.logo.use.some((u) => u === d.badge) && !logoData.frame) {
      out.push({ level: "info", text: "Parts of the logo in the badge's own colour blend into the face. Pick another filament for them to show." });
    }
  }
  out.push(...comp.notes);
  if (slots.length > 4 && state.printer !== OTHER) {
    out.push({ level: "warn", text: `This badge needs ${slots.length} filaments, and most multi-colour printers hold 4. Give some colours the same filament, or check your printer holds ${slots.length}.` });
  }
  return out;
}

// ---------------------------------------------------------------- preview

let hatch = null;
function hatchPattern(ctx) {
  if (hatch) return ctx.createPattern(hatch, "repeat");
  hatch = document.createElement("canvas");
  hatch.width = hatch.height = 8;
  const h = hatch.getContext("2d");
  h.fillStyle = "rgba(255, 40, 40, 0.18)"; h.fillRect(0, 0, 8, 8);
  h.strokeStyle = "rgba(255, 40, 40, 0.7)"; h.lineWidth = 1.2;
  h.beginPath(); h.moveTo(-2, 10); h.lineTo(10, -2); h.moveTo(6, 10); h.lineTo(10, 6); h.moveTo(-2, 2); h.lineTo(2, -2); h.stroke();
  return ctx.createPattern(hatch, "repeat");
}

function draw(comp, d) {
  const cv = $("#preview");
  const m = 1.6;                                       // mm of plate round the badge
  const cssW = Math.max(240, cv.clientWidth || cv.parentElement.clientWidth);
  const k = cssW / (BADGE.w + 2 * m);
  const cssH = (BADGE.h + 2 * m) * k;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  cv.style.height = `${cssH}px`;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const P = (paths) => {
    const p = new Path2D();
    for (const ring of paths) {
      ring.forEach((q, i) => {
        const x = (q.X / SCALE + BADGE.w / 2 + m) * k, y = (BADGE.h / 2 - q.Y / SCALE + m) * k;
        if (i) p.lineTo(x, y); else p.moveTo(x, y);
      });
      p.closePath();
    }
    return p;
  };
  const outline = P(comp ? comp.outline : roundedOutline());
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)"; ctx.shadowBlur = 0.9 * k; ctx.shadowOffsetY = 0.3 * k;
  ctx.fillStyle = hexOf(d.badge); ctx.fill(outline);
  ctx.restore();
  const shade = ctx.createLinearGradient(0, m * k, 0, (m + BADGE.h) * k);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.10)"); shade.addColorStop(1, "rgba(0, 0, 0, 0.12)");
  ctx.fillStyle = shade; ctx.fill(outline);
  if (comp) {
    for (const c of comp.colours) {
      const p = P(c.paths);
      if (d.style === "raised") {
        ctx.save();
        ctx.translate(0.1 * k, 0.18 * k);
        ctx.fillStyle = luminance(hexOf(c.fil)) > 0.5 ? "rgba(0, 0, 0, 0.45)" : "rgba(0, 0, 0, 0.6)";
        ctx.fill(p);
        ctx.restore();
      }
      ctx.fillStyle = hexOf(c.fil); ctx.fill(p);
    }
    if (comp.thin.length) {
      const t = P(comp.thin);
      ctx.fillStyle = hatchPattern(ctx); ctx.fill(t);
      ctx.strokeStyle = "rgba(255, 40, 40, 0.9)"; ctx.lineWidth = 1; ctx.stroke(t);
    }
  }
  ctx.strokeStyle = luminance(hexOf(d.badge)) < 0.2 ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.25)";
  ctx.lineWidth = 1; ctx.stroke(outline);
}

function roundedOutline() {
  // just the badge, before anything is composed
  const pts = [];
  const { w, h, r } = BADGE;
  for (const [cx, cy, a0] of [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]]) {
    for (let i = 0; i <= 12; i++) {
      const a = (a0 + 7.5 * i) * Math.PI / 180;
      pts.push({ X: (cx + r * Math.cos(a)) * SCALE, Y: (cy + r * Math.sin(a)) * SCALE });
    }
  }
  return [pts];
}

// ---------------------------------------------------------------- on the stand

let standView = null, stands = [];
const standEntry = () => stands.find((s) => s.id === state.stand) || stands[0];
const standKey = () => (state.standColours || {})[standEntry()?.id] || null;

// The 3D view starts once the badge picture is up: three.js and the stand load in the meantime.
function startStand() {
  if (!stands.length) { $("#standview").hidden = true; return; }
  $("#stand-status").textContent = "Loading the stand…";
  import("./stand3d.js")
    .then((m) => m.createStandView($("#stand-canvas")))
    .then((view) => { standView = view; standUpdate(); return showStand(); })
    .catch((e) => {
      console.error(e);
      $("#stand-status").textContent = "The 3D view couldn't start here (it needs WebGL and an internet connection). The badge picture above still shows the design.";
    });
}

async function showStand() {
  const entry = standEntry();
  standPickUI();
  if (!standView || !entry) return;
  $("#stand-status").textContent = `Loading the ${entry.title}…`;
  try {
    await standView.setStand(entry);
    if (standEntry() === entry) { $("#stand-status").textContent = ""; standUpdate(); }
  } catch (e) {
    console.error(e);
    $("#stand-status").textContent = e.message || String(e);
  }
}

// Each stand as its picture and name under a heading, the one shown marked; arrows on the 3D view
// step through them too, and its label says which of how many it is.
function standPickUI() {
  const box = $("#stand-list"), many = stands.length > 1;
  $("#stand-pick").hidden = !many;
  $("#stand-prev").hidden = $("#stand-next").hidden = !many;
  $("#stand-pick-hint").textContent = `${stands.length} stands, and your badge fits them all. Pick one to see your badge on it below, and to download it.`;
  const now = standEntry();
  box.replaceChildren(...stands.map((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(s.id === now.id));
    b.setAttribute("aria-label", `ZapStand ${s.title}`);
    b.innerHTML = `<img alt="" loading="lazy"><span></span>`;
    b.querySelector("img").src = s.picture;
    b.querySelector("span").textContent = s.title;
    b.addEventListener("click", () => pickStand(s.id));
    return b;
  }));
  const i = stands.indexOf(now);
  $("#stand-name").textContent = `On the ZapStand ${now.title}` + (many ? ` · ${i + 1} of ${stands.length}` : "");
  standFilesUI();
}

function pickStand(id) {
  if (id === standEntry().id) return;
  state.stand = id; save(); standColourUI(); showStand();
}

function stepStand(d) {
  const i = stands.indexOf(standEntry());
  pickStand(stands[(i + d + stands.length) % stands.length].id);
}

// The chosen stand's own print files: its pieces as a plain .3mf, with a README on printing them --
// or, where a page offers them (on lightningpiggy.com, the Cases page), a link to that page.
function standFilesUI() {
  const s = standEntry(), box = $("#stand-files");
  box.hidden = !s;
  if (!s) return;
  const dl = s.download, page = s.page, a = $("#stand-download"), info = $("#stand-files-info");
  $("#stand-files-title").textContent = `ZapStand ${s.title}`;
  a.removeAttribute("download"); a.removeAttribute("target");
  if (dl) {
    const mb = dl.size / 1e6;
    info.textContent = `${dl.pieces} pieces to print, ${mb < 1 ? "under 1" : mb.toFixed(0)} MB, with a README on settings and colours.`;
    a.href = encodeURI(dl.file);                      // "P1 ZapStand_Piggy.zip": the space as %20
    a.download = dl.file.split("/").pop();
    a.textContent = "Download the stand";
    a.hidden = false;
  } else if (page) {
    info.textContent = page.note || "Its print files are on another page.";
    a.href = page.url;
    a.target = "_top";                                // out of the frame the page may be shown in
    a.textContent = page.label || "Get the stand files";
    a.hidden = false;
  } else {
    info.textContent = "Its print files aren’t up yet.";
    a.hidden = true;
  }
  if (s.credit && (dl || page)) {                     // the designer's credit, as the licence asks: by
    const link = (href, text) => {                    // reference to the page that credits them
      const l = document.createElement("a");
      l.href = href; l.target = "_blank"; l.rel = "noopener"; l.textContent = text;
      return l;
    };
    info.append(" By ", link(s.credit.source, "its designer"), ", ", link(s.credit.url, s.credit.licence), ".");
  }
}

function standColourUI() {
  const btn = $("#stand-colour"), key = standKey(), entry = standEntry();
  if (!entry) return;
  if (key) { swatch(btn, key); return; }
  btn.innerHTML = `<span class="dot"></span><span class="txt">Its own colours</span>`;
  btn.querySelector(".dot").style.background = entry.colour;
  btn.classList.remove("off");
  btn.setAttribute("aria-label", "Stand colour: its own colours. Change");
}

// the badge as it prints, set in the stand's slot
function standUpdate() {
  if (!standView || !current) return;
  const d = current.design, comp = current.comp;
  let shown, slots;
  if (comp) {
    slots = filaments(d, comp);
    shown = parts(d, comp, slots, label).parts;
  } else {
    slots = [d.badge];
    shown = [{ mesh: extrude(roundedRect(BADGE.w, BADGE.h, BADGE.r), 0, d.thickness), extruder: 1 }];
  }
  standView.show(shown, {
    flip: !!comp && d.style === "flush", thickness: d.thickness,
    colours: slots.map(hexOf), matte: slots.map((k) => fil(k).line === "PLA Matte"),
    standColour: standKey() ? hexOf(standKey()) : null, standMatte: !!standKey() && fil(standKey()).line === "PLA Matte",
  });
}

// ---------------------------------------------------------------- readout

function slotsUI(d, comp) {
  const list = comp ? filaments(d, comp) : [d.badge];
  const roles = new Map(list.map((f) => [f, []]));
  roles.get(d.badge).push(d.style === "flush" ? "badge and face" : "badge");
  if (comp) for (const c of comp.colours) roles.get(c.fil).push(...[...c.roles].map((r) => ({ logo: "logo", name: "name", border: "edge line" }[r])));
  const ol = $("#slots");
  ol.replaceChildren(...list.map((f, i) => {
    const li = document.createElement("li");
    li.className = "slot";
    const x = fil(f);
    li.innerHTML = `<span class="n">${i + 1}</span><span class="spool"></span><span class="what"><strong></strong><span></span></span>`;
    li.querySelector(".spool").style.background = x.hex;
    li.querySelector("strong").textContent = x.name;
    li.querySelector(".what span").textContent = `${x.line === "Other" ? "PLA, your colour" : x.line} · ${[...new Set(roles.get(f))].join(", ")}`;
    return li;
  }));
  $("#slot-count").textContent = state.printer === OTHER ? `${list.length} filament${list.length === 1 ? "" : "s"}`
    : `${list.length} filament${list.length === 1 ? "" : "s"}${list.length > 4 ? ": more than most printers hold" : ""}`;
  return list;
}

function xsectionUI(d, comp) {
  const svg = $("#xsection");
  const T = +d.thickness, R = BADGE.relief;
  const top = d.style === "flush" ? T : T + R;
  const k = 58 / 6.8;                                   // px per mm: the thickest raised badge fills the drawing
  const x0 = 12, x1 = 228, base = 74;
  const y = (z) => base - z * k;
  const badge = hexOf(d.badge);
  const cols = comp && comp.colours.length ? comp.colours.map((c) => hexOf(c.fil)) : [hexOf(d.nameColour || d.badge)];
  const stroke = "var(--ink)";
  let s = `<rect x="4" y="${base}" width="232" height="6" rx="1.5" fill="var(--muted)" opacity="0.5"/>`;
  const segs = [[0.08, 0.2], [0.3, 0.42], [0.55, 0.62], [0.72, 0.9]];
  if (d.style === "flush") {
    s += `<rect x="${x0}" y="${y(T)}" width="${x1 - x0}" height="${(T - BADGE.inlay) * k}" fill="${badge}" stroke="${stroke}" stroke-width="0.6"/>`;
    s += `<rect x="${x0}" y="${y(BADGE.inlay)}" width="${x1 - x0}" height="${BADGE.inlay * k}" fill="${badge}" stroke="${stroke}" stroke-width="0.6"/>`;
    segs.forEach(([a, b], i) => {
      s += `<rect x="${x0 + a * (x1 - x0)}" y="${y(BADGE.inlay)}" width="${(b - a) * (x1 - x0)}" height="${BADGE.inlay * k}" fill="${cols[i % cols.length]}" stroke="${stroke}" stroke-width="0.6"/>`;
    });
  } else {
    s += `<rect x="${x0}" y="${y(T)}" width="${x1 - x0}" height="${T * k}" fill="${badge}" stroke="${stroke}" stroke-width="0.6"/>`;
    segs.forEach(([a, b], i) => {
      s += `<rect x="${x0 + a * (x1 - x0)}" y="${y(T + R)}" width="${(b - a) * (x1 - x0)}" height="${R * k}" fill="${cols[i % cols.length]}" stroke="${stroke}" stroke-width="0.6"/>`;
    });
  }
  const t = (yy, txt) => `<text x="246" y="${yy}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10" fill="var(--muted)">${txt}</text>`;
  const tick = (z) => `<line x1="232" x2="240" y1="${y(z)}" y2="${y(z)}" stroke="var(--muted)" stroke-width="0.8"/>`;
  s += tick(0) + tick(top);
  if (d.style === "flush") s += tick(BADGE.inlay) + t(y(BADGE.inlay / 2) + 3, "1.2 face") + t(y(top) + 3, `${top.toFixed(1)} mm`);
  else s += tick(T) + t(y(T + R / 2) + 3, "+1.2") + t(y(T) + 8, `${T.toFixed(1)} badge`);
  s += t(base + 13, "plate");
  svg.innerHTML = s;
  $("#xsection-text").textContent = d.style === "flush"
    ? `Printed face down. The first 1.2 mm (6 layers) on the plate is the face with the colours set into it, then ${(T - BADGE.inlay).toFixed(1)} mm of badge on top: ${T.toFixed(1)} mm in all.`
    : `Printed face up. A ${T.toFixed(1)} mm badge with the colours 1.2 mm (6 layers) on top: ${(T + R).toFixed(1)} mm in all.`;
}

function notesUI(notes) {
  $("#notes").replaceChildren(...notes.map((n) => {
    const li = document.createElement("li");
    li.className = n.level;
    li.textContent = n.text;
    return li;
  }));
}

// ---------------------------------------------------------------- controls

function swatch(btn, key, off = false) {
  const x = off ? null : fil(key);
  btn.innerHTML = `<span class="dot"></span><span class="txt"></span>`;
  btn.querySelector(".dot").style.background = x ? x.hex : "transparent";
  btn.querySelector(".txt").textContent = x ? label(key) : "Leave out";
  btn.classList.toggle("off", !x);
  btn.setAttribute("aria-label", `${btn.dataset.what || "Colour"}: ${x ? label(key) : "left out"}. Change`);
}

function regionsUI() {
  const ul = $("#regions");
  const has = !!(state.logo && logoData);
  $("#logo-name").textContent = has ? state.logo.fileName : "No logo";
  $("#logo-remove").hidden = !has;
  const asDrawn = has && !!logoData.frame && !state.name.trim();      // a ready-made badge, as designed
  $("#logo-size-row").hidden = !has || asDrawn;
  $("#logo-side-row").hidden = !has || !state.name.trim();
  $("#logo-hint").textContent = asDrawn
    ? "A ready-made badge, laid out as designed. Each of its colours gets a filament below. Adding a name fits the logo next to it."
    : "A vector logo (SVG) made of filled shapes. Each of its colours gets a filament below.";
  if (!has) { ul.replaceChildren(); return; }
  ul.replaceChildren(...logoData.regions.map((r, i) => {
    const li = document.createElement("li");
    li.className = "region";
    li.innerHTML = `<span class="from" title="Colour in the file: ${r.hex}"></span><span class="arrow">→</span><button type="button" class="swatch-button"></button>`;
    li.querySelector(".from").style.background = r.hex;
    const b = li.querySelector("button");
    b.dataset.what = `Logo colour ${r.hex}`;
    swatch(b, state.logo.use[i], !state.logo.use[i]);
    b.addEventListener("click", () => openPicker(b, {
      title: `Logo colour ${r.hex}`, current: state.logo.use[i], allowOff: true,
      pick: (key) => { state.logo.use[i] = key; swatch(b, key, !key); changed(); },
    }));
    return li;
  }));
}

function syncControls() {
  $("#name-text").value = state.name;
  $("#name-font").value = state.font;
  $("#name-cap").value = state.cap; $("#name-cap-out").textContent = `${(+state.cap).toFixed(1)} mm`;
  const lh = state.logo ? state.logo.height : 10.2;
  $("#logo-height").value = lh; $("#logo-height-out").textContent = `${(+lh).toFixed(1)} mm`;
  $(`#side-${state.side}`).checked = true;
  $(`#style-${state.style}`).checked = true;
  for (const r of document.querySelectorAll('input[name="thickness"]')) r.checked = +r.value === +state.thickness;
  $("#border-on").checked = state.borderOn;
  $("#border-colour").disabled = !state.borderOn;
  $("#printer").value = state.printer;
  $("#plate").value = state.plate;
  $("#copies").value = state.copies; $("#copies-out").textContent = state.copies;
  const other = state.printer === OTHER;
  $("#plate-field").hidden = other;
  // the settings are a starting point: the printer, its nozzle and the filaments may differ
  $("#printer-hint").textContent = other
    ? "The badge comes without print settings: set them up in your slicer for your printer and filaments."
    : "The project comes with suggested settings for this printer: a starting point, not a guarantee. Before printing, check in your slicer that the printer and nozzle, the plate, the filaments in each slot and the layer height match yours.";
  $("#download-stl").hidden = !other;
  $("#download").textContent = other ? "Download the badge (.3mf)" : "Download the badge";
  $("#download-stl").textContent = "Download the badge (STL)";
  $("#download-hint").textContent = other
    ? "The badge only. The .3mf has each colour as its own part, named with its filament number: pick each part’s filament in your slicer and print with 0.2 mm layers. The STL download has one file per colour, zipped, all on the same origin: load them together as one object. The stand’s own files are under the stand."
    : "The badge only, as a .3mf project for the printer you chose with each colour on its own filament: open it, check its settings and filaments, then slice and print. The stand’s own files are under the stand.";
  $("#plate-name").textContent = other ? "Print plate" : $("#plate").selectedOptions[0]?.textContent + " plate";
  $("#face-label").textContent = state.style === "flush" ? "face side, as it will look on the stand" : "seen from above";
  swatch($("#name-colour"), state.nameColour);
  swatch($("#badge-colour"), state.badge);
  swatch($("#border-colour"), state.border);
  standColourUI();
  [...$("#readymade-list").children].forEach((b, i) => b.setAttribute("aria-pressed", String(!!designs[i] && state.preset === designs[i].id)));
  regionsUI();
}

// the filament picker
let pickerFor = null;
function openPicker(btn, opt) {
  const pk = $("#picker");
  pickerFor = { btn, ...opt };
  $("#picker-title").textContent = opt.title;
  const body = $("#picker-body");
  body.replaceChildren();
  if (opt.allowOff) {
    const off = document.createElement("button");
    off.type = "button"; off.className = "button secondary small picker-off"; off.textContent = opt.offLabel || "Leave this colour out";
    off.addEventListener("click", () => choose(null));
    body.appendChild(off);
  }
  for (const line of ["PLA Basic", "PLA Matte"]) {
    const h = document.createElement("h3"); h.textContent = line;
    const grid = document.createElement("div"); grid.className = "picker-grid";
    for (const f of FIL.values()) {
      if (f.line !== line) continue;
      const b = document.createElement("button");
      b.type = "button"; b.style.background = f.hex; b.title = f.name;
      b.setAttribute("aria-label", `${f.name}, ${f.line}`);
      b.setAttribute("aria-pressed", String(opt.current === f.key));
      b.addEventListener("click", () => choose(f.key));
      for (const ev of ["mouseenter", "focus"]) b.addEventListener(ev, () => { $("#picker-name").textContent = `${f.name}, ${f.line}`; });
      grid.appendChild(b);
    }
    body.append(h, grid);
  }
  const cur = opt.current ? fil(opt.current) : null;
  $("#picker-name").textContent = cur ? label(opt.current) : "Left out";
  $("#picker-custom").value = cur ? cur.hex.toLowerCase() : "#888888";
  pk.hidden = false;
  const r = btn.getBoundingClientRect(), w = pk.offsetWidth, h = pk.offsetHeight;
  const left = Math.min(Math.max(16, r.left), window.innerWidth - w - 16);
  const top = r.bottom + 8 + h < window.innerHeight ? r.bottom + 8 : Math.max(16, r.top - h - 8);
  pk.style.left = `${left}px`; pk.style.top = `${top}px`;
  (body.querySelector('[aria-pressed="true"]') || body.querySelector("button")).focus();
}
function choose(key) {
  if (!pickerFor) return;
  const p = pickerFor;
  closePicker();
  p.pick(key);
}
function closePicker() {
  if (!pickerFor) return;
  const b = pickerFor.btn;
  $("#picker").hidden = true;
  pickerFor = null;
  b.focus();
}

function wire() {
  $("#name-font").replaceChildren(...FONTS.map((f) => new Option(`${f.label} (${f.note})`, f.id)));
  const ready = document.createElement("optgroup");
  ready.label = "Printers with suggested settings (check before printing)";
  ready.append(...printers.map((p) => new Option(p.label, p.id)));
  $("#printer").replaceChildren(ready, new Option("Other printer", OTHER));
  if (state.printer !== OTHER && !printers.some((p) => p.id === state.printer)) state.printer = printers[0]?.id || "a1";

  const on = (sel, ev, f) => $(sel).addEventListener(ev, f);
  on("#name-text", "input", (e) => {
    state.name = e.target.value;
    regionsUI();
    changed();
  });
  on("#name-font", "change", (e) => { state.font = e.target.value; changed(); });
  on("#name-cap", "input", (e) => { state.cap = +e.target.value; $("#name-cap-out").textContent = `${state.cap.toFixed(1)} mm`; changed(); });
  on("#logo-height", "input", (e) => {
    if (!state.logo) return;
    state.logo.height = +e.target.value; $("#logo-height-out").textContent = `${state.logo.height.toFixed(1)} mm`; changed();
  });
  for (const r of document.querySelectorAll('input[name="side"]')) r.addEventListener("change", (e) => { state.side = e.target.value; changed(); });
  for (const r of document.querySelectorAll('input[name="style"]')) r.addEventListener("change", (e) => { state.style = e.target.value; syncControls(); changed(); });
  for (const r of document.querySelectorAll('input[name="thickness"]')) r.addEventListener("change", (e) => { state.thickness = +e.target.value; changed(); });
  on("#border-on", "change", (e) => { state.borderOn = e.target.checked; $("#border-colour").disabled = !state.borderOn; changed(); });
  on("#printer", "change", (e) => { state.printer = e.target.value; syncControls(); changed(); });
  on("#plate", "change", (e) => { state.plate = e.target.value; syncControls(); changed(); });
  on("#copies", "input", (e) => { state.copies = +e.target.value; $("#copies-out").textContent = state.copies; changed(); });
  on("#logo-file", "change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });
  on("#logo-remove", "click", () => { state.logo = null; logoData = null; state.preset = null; syncControls(); changed(); });

  const colourButton = (sel, what, keyName) => on(sel, "click", (e) => openPicker(e.currentTarget, {
    title: what, current: state[keyName],
    pick: (key) => { if (!key) return; state[keyName] = key; syncControls(); changed(); },
  }));
  colourButton("#name-colour", "Name colour", "nameColour");
  colourButton("#badge-colour", "Badge colour", "badge");
  colourButton("#border-colour", "Edge line colour", "border");
  // the stand's main colour: a filament, or back to the stand's own colours
  on("#stand-colour", "click", (e) => openPicker(e.currentTarget, {
    title: `${standEntry().title} colour`, current: standKey(), allowOff: true, offLabel: "Its own colours",
    pick: (key) => {
      state.standColours = { ...(state.standColours || {}), [standEntry().id]: key };
      save(); standColourUI(); standUpdate();
    },
  }));
  on("#stand-front", "click", () => standView && standView.front());
  on("#stand-prev", "click", () => stepStand(-1));
  on("#stand-next", "click", () => stepStand(1));
  $("#name-colour").dataset.what = "Name colour";
  $("#badge-colour").dataset.what = "Badge colour";
  $("#border-colour").dataset.what = "Edge line colour";

  on("#picker-close", "click", closePicker);
  on("#picker-custom-use", "click", () => choose(`custom/${$("#picker-custom").value.toUpperCase()}`));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
  document.addEventListener("pointerdown", (e) => {
    if (pickerFor && !$("#picker").contains(e.target) && !pickerFor.btn.contains(e.target)) closePicker();
  });

  const bed = $("#drop");
  bed.addEventListener("dragover", (e) => { e.preventDefault(); bed.classList.add("dragging"); });
  bed.addEventListener("dragleave", () => bed.classList.remove("dragging"));
  bed.addEventListener("drop", (e) => { e.preventDefault(); bed.classList.remove("dragging"); readFile(e.dataTransfer.files[0]); });

  on("#controls", "submit", (e) => { e.preventDefault(); download("3mf"); });
  on("#download-stl", "click", () => download("stl"));
  let rt = 0;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => current && draw(current.comp, current.design), 80); });
}

// ---------------------------------------------------------------- download

const printerCache = new Map();
function loadPrinter(id) {
  if (!printerCache.has(id)) {
    printerCache.set(id, fetch(`printers/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the printer settings (${r.status}).`);
      return r.json();
    }).catch((e) => { printerCache.delete(id); throw e; }));
  }
  return printerCache.get(id);
}

// named as the stands' files are: "P1 ZapStand_Badge_SATOSHI.3mf"
function fileName(d, ext) {
  const base = d.name ? d.name.text : state.logo ? state.logo.fileName.replace(/\.svg$/i, "").replace(/ \(ready-made\)$/, "") : "";
  const slug = base.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `P1 ZapStand_Badge${slug ? "_" + slug : ""}.${ext}`;
}

function saveFile(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// kind: "3mf" (Bambu Studio project, or a plain .3mf for another printer) or "stl"
async function download(kind) {
  const btn = kind === "stl" ? $("#download-stl") : $("#download");
  if (!current || !current.comp) return;
  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = "Making the file…";
  try {
    const { design: d, comp } = current;
    const slots = filaments(d, comp);
    const built = parts(d, comp, slots, label);
    checkParts(d, built);
    const title = d.name ? d.name.text : (state.logo?.fileName || "Badge").replace(/\.svg$/i, "").replace(/ \(ready-made\)$/, "");
    const badges = Array.from({ length: +state.copies }, (_, i) => ({
      name: state.copies > 1 ? `${title} badge ${i + 1}` : `${title} badge`,
      parts: built.parts, top: built.top, w: BADGE.w, h: BADGE.h,
    }));
    const order = slots.map((f, i) => `${i + 1} ${fil(f).name}`).join(", ");
    let name;
    if (state.printer === OTHER && kind === "stl") {
      const out = stlFiles(built.parts, slots.map(fil), title);
      name = fileName(d, out.ext);
      saveFile(out.bytes, name, out.ext === "zip" ? "application/zip" : "model/stl");
      toast(`Saved ${name}. Filaments: ${order}.`);
    } else if (state.printer === OTHER) {
      name = fileName(d, "3mf");
      saveFile(genericProject(built.parts, slots.map(fil), `${title} badge`, +state.copies, BADGE.w, BADGE.h), name, "model/3mf");
      toast(`Saved ${name}. Filaments: ${order}.`);
    } else {
      const printer = await loadPrinter(state.printer);
      const { bytes } = buildProject(printer, badges, { colours: slots.map(hexOf), plate: state.plate, style: d.style });
      name = fileName(d, "3mf");
      saveFile(bytes, name, "model/3mf");
      toast(`Saved ${name}. Open it in your slicer and load filaments ${order}.`);
    }
  } catch (e) {
    console.error(e);
    toast(e.message || String(e));
  } finally {
    btn.textContent = was;
    btn.disabled = false;
  }
}

let toastTimer = 0;
function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
}

// ---------------------------------------------------------------- light or dark

// The visitor's choice is kept under this key; index.html's head applies it before the page shows.
// Without one the page follows its own default (lightningpiggy.com's copy has data-theme="light"),
// else the system's setting.
const THEME = "zapstand-badge-theme";
const SYSTEM_DARK = matchMedia("(prefers-color-scheme: dark)");
const MOON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20.5 13.6A8.5 8.5 0 1 1 10.4 3.5a6.6 6.6 0 0 0 10.1 10.1z" fill="currentColor"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

function themeUI() {
  const root = document.documentElement, btn = $("#theme-toggle");
  const dark = () => (root.dataset.theme || (SYSTEM_DARK.matches ? "dark" : "light")) === "dark";
  const show = () => { btn.innerHTML = dark() ? `${SUN}Light mode` : `${MOON}Dark mode`; };
  btn.addEventListener("click", () => {
    root.dataset.theme = dark() ? "light" : "dark";
    try { localStorage.setItem(THEME, root.dataset.theme); } catch (e) { /* not kept, fine */ }
    show();
  });
  SYSTEM_DARK.addEventListener("change", show);
  show();
  btn.hidden = false;
}

// ---------------------------------------------------------------- start

async function start() {
  // shown inside another page (lightningpiggy.com's /build/badge-maker): that page has the title
  if (window.self !== window.top) document.documentElement.classList.add("embedded");
  themeUI();
  try {
    printers = await (await fetch("printers/index.json")).json();
  } catch (e) {
    printers = [{ id: "a1", label: "A1" }];
  }
  try {
    designs = await (await fetch("designs/index.json")).json();
  } catch (e) {
    designs = [];
  }
  try {
    stands = await (await fetch("stand/index.json")).json();
  } catch (e) {
    stands = [];
  }
  // ?stand=kitty opens that stand (the Cases page links here like that)
  const asked = new URLSearchParams(location.search).get("stand");
  if (asked && stands.some((s) => s.id === asked)) state.stand = asked;
  wire();
  restoreLogo();
  readymadeUI();
  syncControls();
  render().then(startStand);
}
start();
