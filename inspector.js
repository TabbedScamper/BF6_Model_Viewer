// Desktop model inspector — the review-train editor, embedded in the site's
// expanded viewer. Godot-style camera, surface select / crop-region tools,
// live texture realign + swap, fix export/import (same JSON the asset
// pipeline bakes from). Phones keep the lightweight <model-viewer> spinner.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

let S = null;   // active session state

export function close() {
  if (!S) return;
  S.abort.abort();
  if (S.ro) S.ro.disconnect();
  cancelAnimationFrame(S.raf);
  S.renderer.dispose();
  S.mount.innerHTML = '';
  S = null;
}

export function open(url, modelName, mount, statusEl) {
  close();
  const abort = new AbortController();
  const sig = { signal: abort.signal };
  mount.innerHTML = `
    <div class="insp-hud">
      <button class="i-edit" title="Inspect surfaces, realign textures, export fixes">&#9998; Edit</button>
      <span class="i-tools" hidden>
        <label><input type="checkbox" class="i-crop"> crop mode (B)</label>
        <button class="i-export">Export fixes</button>
        <button class="i-import">Import fixes</button>
        <input type="file" class="i-file" accept=".json" style="display:none">
      </span>
    </div>
    <div class="insp-panel" style="display:none"></div>
    <div class="insp-big" style="display:none"></div>
    <div class="insp-view"></div>`;
  const $ = s => mount.querySelector(s);
  const view = $('.insp-view'), panel = $('.insp-panel'), bigEl = $('.insp-big');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x24282e);
  const cam = new THREE.PerspectiveCamera(55, 1, 0.05, 5000);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
  scene.add(new THREE.HemisphereLight(0xffffff, 0x585d66, 1.15));
  const sun = new THREE.DirectionalLight(0xfff2df, 2.0); sun.position.set(60, 90, 40); scene.add(sun);
  const sun2 = new THREE.DirectionalLight(0xdfe8ff, 0.7); sun2.position.set(-50, 40, -60); scene.add(sun2);
  const grid = new THREE.GridHelper(200, 100, 0x3a4048, 0x2c3138); scene.add(grid);

  let defHint = statusEl ? statusEl.textContent : '';
  const status = t => { if (statusEl) statusEl.textContent = t || defHint; };
  // view-first: editing tools stay hidden until the user opts in
  let editMode = false;
  $('.i-edit').onclick = () => {
    editMode = !editMode;
    $('.i-tools').hidden = !editMode;
    $('.i-edit').classList.toggle('on', editMode);
    if (editMode) {
      defHint = 'click = inspect surface · B = crop a region · drag its box on the sheet to realign · X = isolate · Esc = deselect';
    } else {
      defHint = 'drag = orbit · scroll = zoom · RMB = freelook + WASD fly (scroll = speed) · ✎ Edit to inspect & fix textures';
      $('.i-crop').checked = false;
      clearPick();
    }
    status('');
  };
  S = { abort, renderer, mount, raf: 0 };
  let current = null, frameSize = 20;

  function size() {
    // layout size (clientWidth), NOT gBCR — the overlay grows in via a CSS
    // transform which scales gBCR without ever refiring ResizeObserver
    const w = view.clientWidth, h = view.clientHeight;
    if (w < 10 || h < 10) return;
    renderer.setSize(w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  // track the stage through its grow-in animation and window resizes
  S.ro = new ResizeObserver(size);
  S.ro.observe(view);

  loader.load(url, g => {
    current = g.scene;
    scene.add(current);
    const box = new THREE.Box3().setFromObject(current);
    frameSize = box.getSize(new THREE.Vector3()).length();
    const c = box.getCenter(new THREE.Vector3());
    controls.target.copy(c);
    cam.position.set(c.x + frameSize * 0.85, c.y + frameSize * 0.5, c.z + frameSize * 0.85);
    cam.near = Math.max(frameSize / 1000, 0.02);
    cam.far = frameSize * 20 + 100;
    cam.updateProjectionMatrix();
    grid.position.y = box.min.y;
    status('');
  }, undefined, () => status('model load failed'));
  status('loading…');

  // ---------- Godot freelook ----------
  const flyKeys = {};
  let flying = false, flySpeedMult = 1, lookLast = null;
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    flyKeys[e.key.toLowerCase()] = true;
    if (e.key === 'Escape') {
      if (bigEl.style.display !== 'none') { bigEl.style.display = 'none'; return; }
      clearPick();
    }
    if ((e.key === 'b' || e.key === 'B') && editMode) $('.i-crop').checked = !$('.i-crop').checked;
    if ((e.key === 'x' || e.key === 'X') && editMode && picked && current) {
      isolated = !isolated;
      current.traverse(o => { if (o.isMesh) o.visible = isolated ? (o === picked) : true; });
    }
  }, sig);
  addEventListener('keyup', e => { flyKeys[e.key.toLowerCase()] = false; }, sig);
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault(), sig);
  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.button === 2) {
      flying = true; lookLast = [e.clientX, e.clientY];
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
  }, sig);
  renderer.domElement.addEventListener('pointermove', e => {
    if (!flying || !lookLast) return;
    const dx = e.clientX - lookLast[0], dy = e.clientY - lookLast[1];
    lookLast = [e.clientX, e.clientY];
    const eu = new THREE.Euler(0, 0, 0, 'YXZ');
    eu.setFromQuaternion(cam.quaternion);
    eu.y -= dx * 0.0032;
    eu.x = Math.max(-1.55, Math.min(1.55, eu.x - dy * 0.0032));
    eu.z = 0;
    cam.quaternion.setFromEuler(eu);
  }, sig);
  renderer.domElement.addEventListener('pointerup', e => {
    if (e.button === 2 && flying) {
      flying = false; lookLast = null;
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      controls.target.copy(cam.position).addScaledVector(fwd, Math.max(frameSize * 0.4, 1));
      controls.enabled = true;
    }
  }, sig);
  renderer.domElement.addEventListener('wheel', e => {
    if (flying) {
      e.preventDefault();
      flySpeedMult = Math.max(0.05, Math.min(30, flySpeedMult * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      status(`fly speed ×${flySpeedMult.toFixed(2)}`);
      return;
    }
    // zoom must never change orientation: re-anchor the orbit pivot straight
    // ahead at the current distance BEFORE OrbitControls dollies, so a stale
    // pivot (left behind by freelook) can't snap/teleport the camera
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const dist = Math.max(cam.position.distanceTo(controls.target), 0.5);
    controls.target.copy(cam.position).addScaledVector(fwd, dist);
  }, { passive: false, signal: abort.signal, capture: true });
  function flyStep() {
    if (!flying) return;
    const sp = frameSize * 0.010 * flySpeedMult * (flyKeys['shift'] ? 3 : 1);
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const mv = new THREE.Vector3();
    if (flyKeys['w']) mv.add(fwd);
    if (flyKeys['s']) mv.sub(fwd);
    if (flyKeys['d']) mv.add(right);
    if (flyKeys['a']) mv.sub(right);
    if (flyKeys['e']) mv.y += 1;
    if (flyKeys['q']) mv.y -= 1;
    if (mv.lengthSq()) cam.position.addScaledVector(mv.normalize(), sp);
  }

  // ---------- selection / crop / align (same behavior as the review train) ----
  const ray = new THREE.Raycaster();
  let picked = null, savedEmissive = null, isolated = false, downPos = null;
  let lockedPlane = null, boxMesh = null, boxLine = null, regionMesh = null;
  let cropping = false, cropA = null;
  const sessionFixes = {};
  const recordFix = f => { sessionFixes[`${f.model}|${f.surface}`] = f; };

  function clearBox() {
    for (const o of [boxMesh, boxLine, regionMesh]) if (o) {
      scene.remove(o); o.geometry.dispose();
      if (o.material.map && o === regionMesh) o.material.map.dispose();
      o.material.dispose();
    }
    boxMesh = boxLine = regionMesh = null;
    bigEl.style.display = 'none';
  }
  function clearPick(restoreVis = true) {
    if (picked && savedEmissive !== null && picked.material?.emissive)
      picked.material.emissive.setHex(savedEmissive);
    if (isolated && restoreVis && current)
      current.traverse(o => { if (o.isMesh) o.visible = true; });
    isolated = false; picked = null; savedEmissive = null; lockedPlane = null;
    clearBox();
    panel.style.display = 'none';
  }
  function setPlaneFromHit(hit) {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const up0 = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const t1 = new THREE.Vector3().crossVectors(up0, n).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
    lockedPlane = { obj: hit.object, n, t1, t2,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point) };
  }
  function meshAt(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1,
                                        -((y - r.top) / r.height) * 2 + 1), cam);
    const hits = ray.intersectObject(current, true).filter(h => h.object.visible && h.object !== regionMesh);
    return hits.length ? hits[0] : null;
  }
  function planePoint(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1,
                                        -((y - r.top) / r.height) * 2 + 1), cam);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(lockedPlane.plane, out) ? out : null;
  }
  const surfKeyOf = o => {
    const m = o.name.match(/^(.*)_s(\d+)/);
    return m ? `${m[1]}:s${m[2]}` : o.name;
  };
  function doPickHit(hit) {
    clearPick(false);
    setPlaneFromHit(hit);
    picked = hit.object;
    if (picked.material?.emissive) {
      savedEmissive = picked.material.emissive.getHex();
      picked.material.emissive.setHex(0xcc2244);
    }
    panel.innerHTML = `<span class="mat">${picked.material?.name || '(unnamed)'}</span><br>` +
      `<b>node:</b> ${picked.name}<br><b>pin key:</b> <span style="user-select:all">${surfKeyOf(picked)}</span>` +
      `<div class="hint">B+drag = crop a region · X = isolate · Esc = deselect</div>`;
    panel.style.display = 'block';
  }
  function boxCorners(A, B) {
    const { t1, t2 } = lockedPlane;
    const d = new THREE.Vector3().subVectors(B, A);
    const a1 = d.dot(t1), a2 = d.dot(t2);
    return [A.clone(), A.clone().addScaledVector(t1, a1),
            A.clone().addScaledVector(t1, a1).addScaledVector(t2, a2),
            A.clone().addScaledVector(t2, a2)];
  }
  function updateBox(A, B) {
    if (boxMesh) { scene.remove(boxMesh); boxMesh.geometry.dispose(); boxMesh = null; }
    if (boxLine) { scene.remove(boxLine); boxLine.geometry.dispose(); boxLine = null; }
    const lift = lockedPlane.n.clone().multiplyScalar(0.02);
    const c = boxCorners(A, B).map(p => p.clone().add(lift));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      [...c[0].toArray(), ...c[1].toArray(), ...c[2].toArray(),
       ...c[0].toArray(), ...c[2].toArray(), ...c[3].toArray()], 3));
    boxMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial(
      { color: 0xffd479, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    scene.add(boxMesh);
    boxLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...c, c[0]]),
      new THREE.LineBasicMaterial({ color: 0xffd479 }));
    scene.add(boxLine);
  }
  function buildRegionGeometry(target, c0, e1, e2, n) {
    const pos = target.geometry.attributes.position, uva = target.geometry.attributes.uv;
    if (!pos || !uva) return null;
    const idx3 = target.geometry.index, mw = target.matrixWorld;
    const gi = i => idx3 ? idx3.getX(i) : i;
    const L1 = e1.length(), L2 = e2.length();
    const u1 = e1.clone().normalize(), u2 = e2.clone().normalize();
    const tol = Math.max(frameSize * 0.01, 0.15);
    const P = [], U = [], v = new THREE.Vector3();
    for (let t = 0; t < (idx3 ? idx3.count : pos.count) / 3; t++) {
      const vids = [gi(3 * t), gi(3 * t + 1), gi(3 * t + 2)];
      const world = []; let cx = 0, cy = 0, cz = 0;
      for (const vi of vids) {
        v.fromBufferAttribute(pos, vi).applyMatrix4(mw);
        world.push(v.clone()); cx += v.x; cy += v.y; cz += v.z;
      }
      const cen = new THREE.Vector3(cx / 3, cy / 3, cz / 3).sub(c0);
      const s1 = cen.dot(u1), s2 = cen.dot(u2);
      if (s1 < 0 || s1 > L1 || s2 < 0 || s2 > L2 || Math.abs(cen.dot(n)) > tol) continue;
      for (let k = 0; k < 3; k++) {
        P.push(world[k].x, world[k].y, world[k].z);
        U.push(uva.getX(vids[k]), uva.getY(vids[k]));
      }
    }
    if (!P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.computeVertexNormals();
    return g;
  }
  function finishCrop(A, B) {
    controls.enabled = true;
    cropping = false;
    if (!lockedPlane) return;
    const c = boxCorners(A, B);
    const e1 = new THREE.Vector3().subVectors(c[1], c[0]);
    const e2 = new THREE.Vector3().subVectors(c[3], c[0]);
    if (e1.length() < 0.02 || e2.length() < 0.02) { clearBox(); return; }
    const target = lockedPlane.obj;
    const rc = new THREE.Raycaster();
    const dir = lockedPlane.n.clone().negate();
    const N = 11; let us = [], vs = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const P = c[0].clone().addScaledVector(e1, i / (N - 1)).addScaledVector(e2, j / (N - 1))
                   .addScaledVector(lockedPlane.n, 0.3);
      rc.set(P, dir);
      const hits = rc.intersectObject(target, false);
      if (hits.length && hits[0].distance < 0.8 && hits[0].uv) { us.push(hits[0].uv.x); vs.push(hits[0].uv.y); }
    }
    if (us.length < 4) { status('crop: the box missed the selected wall'); return; }
    const wrapf = t => ((t % 1) + 1) % 1;
    const uMin = Math.min(...us), uMax = Math.max(...us);
    const vMin = Math.min(...vs), vMax = Math.max(...vs);
    if (regionMesh) { scene.remove(regionMesh); regionMesh = null; }
    const rgeo = buildRegionGeometry(target, c[0], e1, e2, lockedPlane.n);
    if (rgeo && target.material) {
      const rmat = target.material.clone();
      if (rmat.map) { rmat.map = rmat.map.clone(); rmat.map.needsUpdate = true;
                      rmat.map.wrapS = rmat.map.wrapT = THREE.RepeatWrapping; }
      rmat.polygonOffset = true; rmat.polygonOffsetFactor = -2; rmat.polygonOffsetUnits = -2;
      if (rmat.emissive) rmat.emissive.setHex(0x000000);
      regionMesh = new THREE.Mesh(rgeo, rmat);
      scene.add(regionMesh);
    }
    const surfKey = surfKeyOf(target);
    const matName = target.material?.name || '(unnamed)';
    panel.innerHTML = `<span class="mat">${matName}</span><br><b>node:</b> ${target.name}` +
      `<br><b>pin key:</b> <span style="user-select:all">${surfKey}</span>` +
      `<div class="region">region: ${surfKey} uv=[${uMin.toFixed(3)},${vMin.toFixed(3)} → ${uMax.toFixed(3)},${vMax.toFixed(3)}]</div>`;
    const alignMat = (regionMesh && regionMesh.material.map) ? regionMesh.material
                    : (target.material?.map ? target.material : null);
    if (alignMat?.map?.image) {
      const curMap = () => alignMat.map;
      const frac = { x: wrapf(uMin), y: wrapf(vMin),
                     w: Math.max(Math.min(uMax - uMin, 1), 0.02),
                     h: Math.max(Math.min(vMax - vMin, 1), 0.02) };
      const frac0 = { ...frac };
      const canvases = [];
      const drawAll = () => canvases.forEach(cc => cc.redraw());
      const offEl = document.createElement('div');
      offEl.className = 'region';
      offEl.textContent = 'drag box = realign · corner = scale — only inside your selection';
      let swapLike = null, customTexture = null;
      const applyAlign = () => {
        const su = frac.w / frac0.w, sv = frac.h / frac0.h;
        const ou = frac.x - frac0.x * su, ov = frac.y - frac0.y * sv;
        curMap().repeat.set(su, sv);
        curMap().offset.set(ou, ov);
        offEl.innerHTML = `<span style="user-select:all">align: ${surfKey} scale=[${su.toFixed(4)},${sv.toFixed(4)}] offset=[${ou.toFixed(4)},${ov.toFixed(4)}]</span>`;
        recordFix({ model: modelName, surface: surfKey, material: matName, swapLike,
                    customTexture,
                    scale: [+su.toFixed(4), +sv.toFixed(4)],
                    offset: [+ou.toFixed(4), +ov.toFixed(4)],
                    region: [+uMin.toFixed(3), +vMin.toFixed(3), +uMax.toFixed(3), +vMax.toFixed(3)] });
      };
      function makeCanvas(maxPx) {
        const cv = document.createElement('canvas');
        const sc = Math.min(1.6, maxPx / curMap().image.width);
        cv.width = curMap().image.width * sc; cv.height = curMap().image.height * sc;
        const ctx = cv.getContext('2d');
        const H = Math.max(10, cv.width * 0.02);
        cv.redraw = () => {
          ctx.drawImage(curMap().image, 0, 0, cv.width, cv.height);
          const r = { x: frac.x * cv.width, y: frac.y * cv.height, w: frac.w * cv.width, h: frac.h * cv.height };
          ctx.strokeStyle = '#ff3355'; ctx.lineWidth = 2;
          ctx.strokeRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = '#ff3355';
          ctx.fillRect(r.x + r.w - H / 2, r.y + r.h - H / 2, H, H);
        };
        const xy = e => {
          const r = cv.getBoundingClientRect();
          return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)];
        };
        let drag = null;
        cv.style.cursor = 'grab';
        cv.addEventListener('pointerdown', e => {
          const [px, py] = xy(e);
          const rx = frac.x * cv.width, ry = frac.y * cv.height, rw = frac.w * cv.width, rh = frac.h * cv.height;
          const onH = Math.abs(px - (rx + rw)) < H && Math.abs(py - (ry + rh)) < H;
          drag = onH ? { mode: 'scale' } : { mode: 'move', dx: px - rx, dy: py - ry };
          cv.setPointerCapture(e.pointerId);
          e.preventDefault();
        });
        cv.addEventListener('pointermove', e => {
          if (!drag) return;
          const [px, py] = xy(e);
          if (drag.mode === 'move') { frac.x = (px - drag.dx) / cv.width; frac.y = (py - drag.dy) / cv.height; }
          else { frac.w = Math.max((px - frac.x * cv.width) / cv.width, 0.01);
                 frac.h = Math.max((py - frac.y * cv.height) / cv.height, 0.01); }
          drawAll(); applyAlign();
        });
        cv.addEventListener('pointerup', () => { drag = null; });
        canvases.push(cv); cv.redraw();
        return cv;
      }
      const links = document.createElement('div');
      links.className = 'hint';
      links.innerHTML = '<u style="cursor:pointer">reset</u> · <u style="cursor:pointer">⛶ maximize sheet</u>';
      const [rl, ml] = links.querySelectorAll('u');
      rl.onclick = () => { Object.assign(frac, frac0); curMap().repeat.set(1, 1); curMap().offset.set(0, 0); drawAll(); };
      ml.onclick = () => {
        bigEl.innerHTML = '';
        const closer = document.createElement('div');
        closer.className = 'closer'; closer.textContent = 'close (Esc)';
        closer.onclick = () => { bigEl.style.display = 'none'; };
        bigEl.appendChild(makeCanvas(Math.min(innerWidth * 0.86, 1400)));
        bigEl.appendChild(closer);
        bigEl.style.display = 'flex';
      };
      panel.appendChild(makeCanvas(240));
      panel.appendChild(offEl);
      panel.appendChild(links);
      const seen = new Map();
      current.traverse(o => {
        if (o.isMesh && o.material?.map?.image && o !== regionMesh)
          seen.set(o.material.map.image, o.material.name || o.name);
      });
      if (seen.size > 1) {
        const strip = document.createElement('div');
        strip.className = 'insp-strip';
        for (const [img, srcName] of seen) {
          const t = document.createElement('canvas');
          t.width = 44; t.height = 44;
          t.getContext('2d').drawImage(img, 0, 0, 44, 44);
          t.title = srcName;
          t.onclick = () => {
            const nt = new THREE.Texture(img);
            nt.flipY = false; nt.colorSpace = THREE.SRGBColorSpace;
            nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.needsUpdate = true;
            alignMat.map = nt; alignMat.needsUpdate = true;
            swapLike = srcName;
            drawAll(); applyAlign();
          };
          strip.appendChild(t);
        }
        const lbl = document.createElement('div');
        lbl.className = 'hint'; lbl.textContent = 'swap texture:';
        panel.appendChild(lbl);
        panel.appendChild(strip);
      }
      // no matching game sheet anywhere? show us what it SHOULD look like:
      // upload an image (e.g. an in-game screenshot) — it previews live and
      // travels inside the exported fix as a reference for locating the real
      // game texture
      const upWrap = document.createElement('div');
      upWrap.className = 'hint';
      upWrap.innerHTML = '<u style="cursor:pointer">upload custom texture… (reference for a missing sheet)</u>';
      const upIn = document.createElement('input');
      upIn.type = 'file'; upIn.accept = 'image/*'; upIn.style.display = 'none';
      upWrap.appendChild(upIn);
      upWrap.querySelector('u').onclick = () => upIn.click();
      upIn.onchange = () => {
        const f = upIn.files[0];
        if (!f) return;
        const img = new Image();
        img.onload = () => {
          const nt = new THREE.Texture(img);
          nt.flipY = false; nt.colorSpace = THREE.SRGBColorSpace;
          nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.needsUpdate = true;
          alignMat.map = nt; alignMat.needsUpdate = true;
          swapLike = null;
          const c = document.createElement('canvas');
          const s = Math.min(1, 512 / img.width);
          c.width = Math.max(img.width * s, 1); c.height = Math.max(img.height * s, 1);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          customTexture = c.toDataURL('image/jpeg', 0.85);
          drawAll(); applyAlign();
          offEl.innerHTML = `<span style="user-select:all">custom: ${surfKey} — reference image attached</span> · align it, then Export fixes`;
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(f);
      };
      panel.appendChild(upWrap);
    }
    panel.style.display = 'block';
  }

  renderer.domElement.addEventListener('pointerdown', e => {
    downPos = [e.clientX, e.clientY];
    if (editMode && $('.i-crop').checked && e.button === 0 && current) {
      if (!lockedPlane) {
        const hit = meshAt(e.clientX, e.clientY);
        if (hit) { doPickHit(hit); status('work plane locked — drag to sketch the box'); }
        return;
      }
      const A = planePoint(e.clientX, e.clientY);
      if (A) { cropping = true; cropA = A; controls.enabled = false; }
    }
  }, sig);
  renderer.domElement.addEventListener('pointermove', e => {
    if (cropping && lockedPlane) {
      const B = planePoint(e.clientX, e.clientY);
      if (B) updateBox(cropA, B);
    }
  }, sig);
  renderer.domElement.addEventListener('pointerup', e => {
    if (cropping) {
      const B = planePoint(e.clientX, e.clientY);
      if (B) finishCrop(cropA, B); else { cropping = false; controls.enabled = true; }
      downPos = null;
      return;
    }
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
    downPos = null;
    if (editMode && moved < 5 && e.button === 0) {
      const hit = current && meshAt(e.clientX, e.clientY);
      if (hit) doPickHit(hit); else clearPick();
    }
  }, sig);

  // ---------- export / import ----------
  $('.i-export').onclick = () => {
    const fixes = Object.values(sessionFixes);
    if (!fixes.length) { status('no fixes recorded'); return; }
    const blob = new Blob([JSON.stringify({ version: 1, generated: new Date().toISOString(),
      source: 'model-viewer-site', fixes }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fixes_${modelName}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    status(`exported ${fixes.length} fix(es)`);
  };
  $('.i-import').onclick = () => $('.i-file').click();
  $('.i-file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    let doc;
    try { doc = JSON.parse(await f.text()); } catch { status('import: invalid JSON'); return; }
    const fixes = (doc.fixes || []).filter(x => x.model === modelName);
    let n = 0;
    for (const fix of fixes) n += applyImportedFix(fix) ? 1 : 0;
    status(`import: ${n}/${fixes.length} fixes previewing`);
    e.target.value = '';
  };
  const importedOverlays = [];
  function applyImportedFix(fix) {
    const [member, siStr] = String(fix.surface).split(':s');
    const rx = new RegExp('^' + member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_s' + siStr + '(_|$)');
    let count = 0;
    const customMats = [];
    current.traverse(o => {
      if (!o.isMesh || !rx.test(o.name) || !o.material) return;
      const pos = o.geometry.attributes.position, uva = o.geometry.attributes.uv;
      if (!pos || !uva) return;
      const idx3 = o.geometry.index;
      const gi = i => idx3 ? idx3.getX(i) : i;
      const [u0, v0, u1, v1] = fix.region || [-1e9, -1e9, 1e9, 1e9];
      const P = [], U = [], v = new THREE.Vector3();
      for (let t = 0; t < (idx3 ? idx3.count : pos.count) / 3; t++) {
        const vids = [gi(3 * t), gi(3 * t + 1), gi(3 * t + 2)];
        let cu = 0, cvv = 0;
        for (const vi of vids) { cu += uva.getX(vi); cvv += uva.getY(vi); }
        cu /= 3; cvv /= 3;
        if (cu < u0 || cu > u1 || cvv < v0 || cvv > v1) continue;
        for (const vi of vids) {
          v.fromBufferAttribute(pos, vi).applyMatrix4(o.matrixWorld);
          P.push(v.x, v.y, v.z);
          U.push(uva.getX(vi), uva.getY(vi));
        }
      }
      if (!P.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.computeVertexNormals();
      const mat = o.material.clone();
      let srcImg = mat.map && mat.map.image;
      if (fix.swapLike) current.traverse(x => {
        if (x.isMesh && x.material?.name === fix.swapLike && x.material.map) srcImg = x.material.map.image;
      });
      if (srcImg) {
        const nt = new THREE.Texture(srcImg);
        nt.flipY = false; nt.colorSpace = THREE.SRGBColorSpace;
        nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
        nt.repeat.set(fix.scale[0], fix.scale[1]);
        nt.offset.set(fix.offset[0], fix.offset[1]);
        nt.needsUpdate = true;
        mat.map = nt;
      }
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      if (fix.customTexture) customMats.push(mat);
      const om = new THREE.Mesh(g, mat);
      scene.add(om);
      importedOverlays.push(om);
      count++;
    });
    if (fix.customTexture && customMats.length) {
      const img = new Image();
      img.onload = () => {
        const nt = new THREE.Texture(img);
        nt.flipY = false; nt.colorSpace = THREE.SRGBColorSpace;
        nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
        nt.repeat.set(fix.scale[0], fix.scale[1]);
        nt.offset.set(fix.offset[0], fix.offset[1]);
        nt.needsUpdate = true;
        customMats.forEach(m => { m.map = nt; m.needsUpdate = true; });
      };
      img.src = fix.customTexture;
    }
    return count > 0;
  }

  // ---------- loop ----------
  size();
  (function tick() {
    S.raf = requestAnimationFrame(tick);
    flyStep();
    if (!flying) controls.update();
    renderer.render(scene, cam);
  })();
}
