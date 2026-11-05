// 3D-перегляд пакета на three.js. Бібліотека вантажиться лише при першому відкритті 3D.

import { groupColor } from './render.js';

let THREE = null;
let OrbitControls = null;

async function loadThree() {
  if (THREE) return;
  THREE = await import('../vendor/three/three.module.min.js');
  ({ OrbitControls } = await import('../vendor/three/OrbitControls.js'));
}

function textSprite(text, color = '#1d232b', bg = 'rgba(255,255,255,0.92)', border = null) {
  const canvas = document.createElement('canvas');
  const fontPx = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = `800 ${fontPx}px Inter, Segoe UI, Arial, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  canvas.width = Math.max(w, 96); canvas.height = 96;
  const c2 = canvas.getContext('2d');
  c2.fillStyle = bg;
  const r = 30;
  c2.beginPath();
  if (c2.roundRect) c2.roundRect(4, 4, canvas.width - 8, canvas.height - 8, r);
  else c2.rect(4, 4, canvas.width - 8, canvas.height - 8);
  c2.fill();
  if (border) { c2.lineWidth = 8; c2.strokeStyle = border; c2.stroke(); }
  c2.font = `800 ${fontPx}px Inter, Segoe UI, Arial, sans-serif`;
  c2.fillStyle = color; c2.textAlign = 'center'; c2.textBaseline = 'middle';
  c2.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.userData.aspect = canvas.width / canvas.height;
  sp.renderOrder = 10;
  return sp;
}

/**
 * Створити переглядач у контейнері.
 * @param {HTMLElement} host
 * @param {HTMLElement} tooltip
 */
export async function createViewer(host, tooltip) {
  await loadThree();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef1f5');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(35, 1, 1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;

  let root = new THREE.Group();
  scene.add(root);
  let grid = null;
  let bounds = null;
  let disposables = [];
  const cellMeshes = [];
  let running = false;
  let lastDesc = null;

  const matCache = new Map();
  const mat = (color, opts = {}) => {
    const k = `${color}|${JSON.stringify(opts)}`;
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.55, metalness: 0.05, ...opts }));
    return matCache.get(k);
  };

  function clear() {
    scene.remove(root);
    for (const d of disposables) d.dispose();
    disposables = [];
    cellMeshes.length = 0;
    root = new THREE.Group();
    scene.add(root);
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
  }

  function build(desc, info) {
    clear();
    const { h } = desc;
    const keep = (g) => { disposables.push(g); return g; };
    if (desc.shape === 'cyl') {
      const r = desc.r;
      const body = keep(new THREE.CylinderGeometry(r, r, h * 0.94, 36));
      const cap = keep(new THREE.CylinderGeometry(r * 0.93, r * 0.93, h * 0.03, 36));
      const button = keep(new THREE.CylinderGeometry(r * 0.36, r * 0.36, 1.4, 24));
      const ring = keep(new THREE.TorusGeometry(r * 0.62, r * 0.06, 8, 36));
      const metal = mat('#c9ced6', { metalness: 0.75, roughness: 0.3 });
      const red = mat('#d93636', { metalness: 0.3, roughness: 0.4 });
      for (const it of desc.items) {
        if (it.kind !== 'cell') continue;
        const g = new THREE.Group();
        g.position.set(it.x, it.y0 || 0, it.z);
        const m = new THREE.Mesh(body, mat(groupColor(it.group, 62)));
        m.position.y = h / 2;
        m.userData.info = info(it);
        cellMeshes.push(m);
        g.add(m);
        const top = new THREE.Mesh(cap, metal); top.position.y = h - h * 0.015; g.add(top);
        const bot = new THREE.Mesh(cap, metal); bot.position.y = h * 0.015; g.add(bot);
        // «+» — червона кнопка та ізоляційне кільце
        const by = it.plusTop ? h + 0.7 : -0.7;
        const btn = new THREE.Mesh(button, red); btn.position.y = by; g.add(btn);
        const rg = new THREE.Mesh(ring, mat('#f1f3f5')); rg.rotation.x = Math.PI / 2; rg.position.y = it.plusTop ? h + 0.2 : -0.2; g.add(rg);
        root.add(g);
      }
    } else {
      const box = keep(new THREE.BoxGeometry(desc.w, h, desc.d));
      const tr = Math.min(desc.w, desc.d) * 0.14;
      const stud = keep(new THREE.CylinderGeometry(tr, tr, 6, 24));
      const terms = new Map((desc.terminals || []).map((t) => [t.id, t]));
      for (const it of desc.items) {
        if (it.kind !== 'cell') continue;
        const m = new THREE.Mesh(box, mat(groupColor(it.group, 62)));
        m.position.set(it.x, (it.y0 || 0) + h / 2, it.z);
        m.userData.info = info(it);
        cellMeshes.push(m);
        root.add(m);
        const t = terms.get(it.id);
        for (const side of ['top', 'bottom']) {
          const plus = side === 'top' ? it.plusTop : !it.plusTop;
          const s = new THREE.Mesh(stud, mat(plus ? '#d93636' : '#2b2f36', { metalness: 0.4 }));
          s.position.set(t[side][0], (it.y0 || 0) + h + 3, t[side][1]);
          root.add(s);
        }
      }
    }
    // перемички
    const unitBox = keep(new THREE.BoxGeometry(1, 1, 1));
    for (const it of desc.items) {
      if (it.kind !== 'strip') continue;
      const dx = it.x2 - it.x1, dz = it.z2 - it.z1;
      const len = Math.hypot(dx, dz);
      const m = new THREE.Mesh(unitBox, mat(it.color, { metalness: 0.55, roughness: 0.35 }));
      m.scale.set(len + it.width * 0.9, it.thick, it.width);
      m.position.set((it.x1 + it.x2) / 2, it.y, (it.z1 + it.z2) / 2);
      m.rotation.y = -Math.atan2(dz, dx);
      if (it.current != null) m.userData.info = `Перемичка B${it.bus}: ${it.current.toFixed(1)} А`;
      root.add(m);
    }
    // дроти
    for (const it of desc.items) {
      if (it.kind !== 'wire') continue;
      const pts = it.points.map((p) => new THREE.Vector3(...p));
      let curve;
      if (it.polyline) {
        // ламана траса: точно повторює 2D-розводку (без згладжування, що могло б дати перехльост)
        curve = new THREE.CurvePath();
        for (let i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      } else curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const tube = keep(new THREE.TubeGeometry(curve, it.polyline ? 24 * (pts.length - 1) : 48, it.radius, 8, false));
      root.add(new THREE.Mesh(tube, mat(it.color, { roughness: 0.6 })));
    }
    // BMS
    for (const it of desc.items) {
      if (it.kind !== 'bms') continue;
      const g = keep(new THREE.BoxGeometry(it.sx, it.sy, it.sz));
      const m = new THREE.Mesh(g, mat('#1f6f4a', { roughness: 0.7 }));
      m.position.set(it.x, it.y, it.z);
      m.userData.info = it.label;
      root.add(m);
      const sp = textSprite(it.label, '#ffffff', 'rgba(36,86,199,0.95)');
      disposables.push(sp.material.map, sp.material);
      const hgt = Math.max(desc.h * 0.12, 10);
      sp.scale.set(hgt * sp.userData.aspect, hgt, 1);
      sp.position.set(it.x + it.nx * 6, it.y + it.sy / 2 + hgt * 0.8, it.z + it.nz * 6);
      root.add(sp);
    }
    // корпус
    for (const it of desc.items) {
      if (it.kind !== 'enclosure') continue;
      if (it.outline && it.outline.length >= 3) {
        // корпус довільної форми: витягнутий контур (каркас + напівпрозорі грані)
        const y0 = it.y - it.sy / 2, y1 = it.y + it.sy / 2;
        const shape = new THREE.Shape(it.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
        const eg = keep(new THREE.ExtrudeGeometry(shape, { depth: it.sy, bevelEnabled: false }));
        const faces = new THREE.Mesh(eg, new THREE.MeshBasicMaterial({ color: 0x2456c7, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
        faces.rotation.x = -Math.PI / 2;
        faces.position.y = y0;
        disposables.push(faces.material);
        root.add(faces);
        const pts = [];
        const n = it.outline.length;
        for (let k = 0; k < n; k++) {
          const [ax, az] = it.outline[k], [bx, bz] = it.outline[(k + 1) % n];
          pts.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz, ax, y0, az, ax, y1, az);
        }
        const lg = keep(new THREE.BufferGeometry());
        lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2456c7 }));
        disposables.push(lines.material);
        root.add(lines);
        continue;
      }
      const g = keep(new THREE.BoxGeometry(it.sx, it.sy, it.sz));
      const faces = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2456c7, transparent: true, opacity: 0.06, depthWrite: false }));
      faces.position.set(it.x, it.y, it.z);
      disposables.push(faces.material);
      root.add(faces);
      const eg = keep(new THREE.EdgesGeometry(g));
      const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x2456c7 }));
      disposables.push(edges.material);
      edges.position.copy(faces.position);
      root.add(edges);
    }
    // підписи
    const size = desc.r ? desc.r * 1.3 : Math.min(desc.w, desc.d) * 0.4;
    for (const it of desc.items) {
      if (it.kind !== 'label') continue;
      const color = it.color || groupColor(it.group ?? 0, 30);
      const sp = textSprite(it.text, color, 'rgba(255,255,255,0.92)', it.group != null ? groupColor(it.group, 45) : color);
      disposables.push(sp.material.map, sp.material);
      sp.scale.set(size * sp.userData.aspect, size, 1);
      sp.position.set(it.x, it.y, it.z);
      root.add(sp);
    }
    // сітка «підлоги»
    bounds = desc.bounds;
    const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
    grid = new THREE.GridHelper(span * 2, 20, 0xb8c0ca, 0xd9dee5);
    grid.position.y = bounds.min[1] - 2;
    scene.add(grid);
  }

  function radius() {
    if (!bounds) return 100;
    const [a, b] = [bounds.min, bounds.max];
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  }
  function center() {
    const [a, b] = [bounds.min, bounds.max];
    return new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  }

  function setView(name = 'iso') {
    if (!bounds) return;
    resize();
    const dirs = { iso: [1, 0.85, 1.25], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], front: [0, 0.25, 1], side: [1, 0.25, 0] };
    const d = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
    // вписуємо сферу меж і по вертикалі, і по горизонталі (вузький екран телефона)
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = (radius() / Math.sin(Math.min(vHalf, hHalf))) * 1.02;
    const c = center();
    camera.position.copy(c.clone().add(d.multiplyScalar(dist)));
    camera.up.set(0, 1, 0);
    if (name === 'top' || name === 'bottom') camera.up.set(0, 0, -1);
    camera.near = dist / 100; camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(c);
    controls.update();
    key.position.copy(c.clone().add(new THREE.Vector3(1, 2, 1.4).multiplyScalar(dist)));
    fill.position.copy(c.clone().add(new THREE.Vector3(-1, -1.2, -0.8).multiplyScalar(dist)));
  }

  function resize() {
    const w = host.clientWidth || 600, hgt = host.clientHeight || 400;
    renderer.setSize(w, hgt, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => { resize(); renderer.render(scene, camera); });
  ro.observe(host);

  // підказка при наведенні
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!tooltip) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(root.children, true).find((x) => x.object.userData.info);
    if (hit) {
      tooltip.textContent = hit.object.userData.info;
      tooltip.hidden = false;
      tooltip.style.left = `${e.clientX - rect.left + 14}px`;
      tooltip.style.top = `${e.clientY - rect.top + 14}px`;
    } else tooltip.hidden = true;
  });
  renderer.domElement.addEventListener('pointerleave', () => { if (tooltip) tooltip.hidden = true; });

  return {
    /** Оновити сцену. Камера зберігається, якщо розмір пакета суттєво не змінився. */
    update(desc, info = () => '') {
      const prevR = bounds ? radius() : null;
      lastDesc = desc;
      build(desc, info);
      resize();
      if (prevR == null || Math.abs(radius() - prevR) / prevR > 0.3) setView('iso');
      renderer.render(scene, camera);
    },
    setView(name) { setView(name); renderer.render(scene, camera); },
    start() {
      if (running) return;
      running = true;
      resize();
      renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    },
    stop() { running = false; renderer.setAnimationLoop(null); },
    png() {
      renderer.render(scene, camera);
      return new Promise((resolve, reject) => renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG')))));
    },
    get desc() { return lastDesc; },
  };
}
