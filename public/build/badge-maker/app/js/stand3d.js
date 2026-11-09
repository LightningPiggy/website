// The badge on a stand, in 3D: a stand from stand/<id>.json + .bin (made by tools/make-stand.py
// from the stand's own model) with the badge's parts set in its slot, back on the slot's floor,
// in their filament colours. three.js is loaded the first time the view starts.
//
// The stands and the badge are modelled z up (as printed); three.js is y up, so the scene turns
// them -90 degrees about x.

let lib = null;
async function three() {
  if (!lib) {
    lib = Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/utils/BufferGeometryUtils.js"),
    ]).then(([THREE, oc, bgu]) => ({ THREE, OrbitControls: oc.OrbitControls, toCreasedNormals: bgu.toCreasedNormals }));
  }
  return lib;
}

const MATTE = 0.85, GLOSSY = 0.42;          // roughness of PLA Matte and of PLA Basic
const FILL = 0.8;                           // the stand fills at most this much of the view

// stand/<id>.json and its .bin -> {meta, parts: [{name, colour, main, positions (Float32Array,
// mm), indices}]}
const loaded = new Map();
function loadStand(entry) {
  if (!loaded.has(entry.id)) {
    loaded.set(entry.id, (async () => {
      const meta = await (await fetch(entry.file)).json();
      const base = entry.file.slice(0, entry.file.lastIndexOf("/") + 1);
      const r = await fetch(base + meta.data);
      if (!r.ok) throw new Error(`Couldn't load the ${meta.title} stand (${r.status}).`);
      const buf = await r.arrayBuffer();
      const parts = meta.parts.map((p) => {
        const raw = new Int16Array(buf, p.positions, p.points * 3);
        const positions = Float32Array.from(raw, (v) => v * meta.unit);
        const indices = p.wide ? new Uint32Array(buf, p.indices, p.triangles * 3) : new Uint16Array(buf, p.indices, p.triangles * 3);
        return { ...p, positions, indices };
      });
      return { meta, parts };
    })().catch((e) => { loaded.delete(entry.id); throw e; }));
  }
  return loaded.get(entry.id);
}

export async function createStandView(container) {
  const { THREE, OrbitControls, toCreasedNormals } = await three();

  // the picture stays readable after drawing (canvas.toDataURL), for saving views of the stands
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-90, 160, 140);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 600 });
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.4);
  rim.position.set(120, 90, -140);
  scene.add(rim);

  // edges sharper than crease are shown sharp; the badge's are all square (30 degrees will do),
  // the stands' curved surfaces want more blending (60) so their facets don't show
  const geometryOf = (positions, indices, crease = Math.PI / 6) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions instanceof Float32Array ? positions : Float32Array.from(positions), 3));
    g.setIndex(new THREE.BufferAttribute(indices instanceof Uint16Array || indices instanceof Uint32Array ? indices : Uint32Array.from(indices), 1));
    return toCreasedNormals(g, crease);
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.receiveShadow = true;
  world.add(ground);

  const standGroup = new THREE.Group();
  world.add(standGroup);
  const badge = new THREE.Group();
  badge.matrixAutoUpdate = false;
  world.add(badge);

  const camera = new THREE.PerspectiveCamera(28, 1, 1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.rotateSpeed = 0.55;
  const render = () => renderer.render(scene, camera);
  let touched = false;                      // once turned, resizing keeps the viewer's angle
  controls.addEventListener("start", () => { touched = true; });
  controls.addEventListener("change", render);

  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  let current = null;                       // {id, target, dir, points, mains: [materials], colour}
  let lastShow = null;

  // The distance from the target at which every point of the stand is in view, seen from dir,
  // filling at most FILL of the picture's height and width (room for the labels in the corners).
  function fit(dir = current.dir) {
    const { target, points } = current;
    const f = dir.clone().negate();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const u = new THREE.Vector3().crossVectors(r, f);
    const tv = Math.tan((camera.fov * Math.PI) / 360) * FILL, th = tv * camera.aspect;
    let d = 0;
    const p = new THREE.Vector3();
    for (const q of points) {
      p.copy(q).sub(target);
      const along = p.dot(dir);                     // towards the camera
      d = Math.max(d, along + Math.abs(p.dot(r)) / th, along + Math.abs(p.dot(u)) / tv);
    }
    return d;
  }

  // the stand from the front, as it opens; turn: degrees round it (from its right when positive)
  function front(turn = 0) {
    if (!current) return;
    touched = false;
    const dir = current.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (turn * Math.PI) / 180);
    const d = fit(dir);
    controls.target.copy(current.target);
    camera.position.copy(current.target).addScaledVector(dir, d);
    controls.minDistance = d * 0.4;
    controls.maxDistance = d * 2.4;
    controls.update();
    render();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (current && !touched) front();
    else render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    // entry: a line of stand/index.json. Loads the stand (once) and shows it, the badge in its slot.
    async setStand(entry) {
      const { meta, parts } = await loadStand(entry);
      for (const m of standGroup.children) { m.geometry.dispose(); m.material.dispose(); }
      standGroup.clear();
      const mains = [];
      const points = [];
      for (const p of parts) {
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.colour), roughness: GLOSSY });
        const mesh = new THREE.Mesh(geometryOf(p.positions, p.indices, Math.PI / 3), mat);
        mesh.castShadow = mesh.receiveShadow = true;
        standGroup.add(mesh);
        if (p.main) mains.push(mat);
        // its points as the scene holds them (turned z up -> y up), for framing; every other one will do
        for (let i = 0; i < p.positions.length; i += 6) {
          points.push(new THREE.Vector3(p.positions[i], p.positions[i + 2], -p.positions[i + 1]));
        }
      }
      const slot = meta.slot;
      badge.matrix.copy(new THREE.Matrix4().makeBasis(v3(slot.x), v3(slot.up), v3(slot.out)).setPosition(v3(slot.centre)));
      world.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(standGroup);
      const out = v3(slot.out).applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      current = {
        id: entry.id, colour: meta.colour, mains, points,
        target: box.getCenter(new THREE.Vector3()),
        dir: out.clone().add(new THREE.Vector3(-0.42, -0.12, 0)).normalize(),
      };
      front();
      if (lastShow) this.show(...lastShow);
    },

    // parts: [{mesh: {v, t}, extruder}] as made for printing; flip: true when they are face down
    // (flush badges), thickness T: they are turned face up again; colours: hex per filament;
    // standColour: the stand's main colour, or null for its own
    show(parts, opts) {
      lastShow = [parts, opts];
      const { flip, thickness, colours, matte, standColour, standMatte } = opts;
      for (const m of badge.children) { m.geometry.dispose(); m.material.dispose(); }
      badge.clear();
      const turn = flip ? new THREE.Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, thickness, 0, 0, 0, 1) : null;
      for (const p of parts) {
        const g = geometryOf(p.mesh.v, p.mesh.t);
        if (turn) g.applyMatrix4(turn);
        const i = p.extruder - 1;
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours[i]), roughness: matte[i] ? MATTE : GLOSSY });
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = mesh.receiveShadow = true;
        badge.add(mesh);
      }
      if (current) {
        for (const mat of current.mains) {
          mat.color.set(standColour || current.colour);
          mat.roughness = standColour && standMatte ? MATTE : GLOSSY;
        }
      }
      render();
    },
    resize,
    front,
    dispose() { ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
