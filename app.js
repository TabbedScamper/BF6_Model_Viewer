/* ============================================================
   BF6 Portal Model Library — 3D browser
   hover = spin 360 · click = grow-out viewer (look around / orbit+zoom)
   ============================================================ */
(() => {
  const CFG = window.CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const isTouch = window.matchMedia("(pointer: coarse)").matches;

  let ALL = [];            // all props
  let view = [];           // filtered/sorted
  let friendly = {};       // map codename -> friendly name (manifest fallback)
  const MAPS = CFG.maps || {};   // code -> {name, level} (SDK level codename)
  let term = "";
  let sort = "name";
  let mapf = "portal";     // default: show what's available in Portal
  let vfilter = "all";     // verify-state filter
  let showDestroyed = false; // hide dc_ destruction variants by default
  let shown = 0;           // how many currently rendered
  let cur = null;          // prop open in the big viewer

  // ---------- verification store (localStorage + export/import) ----------
  const VKEY = "bf6ml_verify";
  let verify = {};
  try { verify = JSON.parse(localStorage.getItem(VKEY) || "{}"); } catch (e) { verify = {}; }
  const saveV = () => localStorage.setItem(VKEY, JSON.stringify(verify));
  function setV(name, state) {
    if (verify[name] === state) delete verify[name]; else verify[name] = state;  // toggle off if same
    saveV();
    // reflect on the card if present
    const card = grid.querySelector(`.mcard[data-name="${CSS.escape(name)}"]`);
    if (card) reflectCard(card, name);
    if (cur && cur.name === name) reflectViewer(name);
    renderProgress();
    if (vfilter !== "all") applyFilters();   // may remove/add from current view
  }
  function reflectCard(card, name) {
    const v = verify[name];
    card.classList.toggle("v-ok", v === "ok");
    card.classList.toggle("v-bad", v === "bad");
    const ok = card.querySelector('.vbtn.vok'), bad = card.querySelector('.vbtn.vbad');
    if (ok) ok.classList.toggle("on", v === "ok");
    if (bad) bad.classList.toggle("on", v === "bad");
  }
  function reflectViewer(name) {
    const v = verify[name];
    $("#mvOk").classList.toggle("on", v === "ok");
    $("#mvBad").classList.toggle("on", v === "bad");
  }
  function renderProgress() {
    const vals = Object.values(verify);
    const ok = vals.filter(x => x === "ok").length, bad = vals.filter(x => x === "bad").length;
    const total = ALL.length, left = total - ok - bad;
    $("#vbProgress").innerHTML =
      `<b class="vp-ok">&#10003; ${ok}</b> verified &middot; <b class="vp-bad">&#10007; ${bad}</b> flagged &middot; <span class="vp-left">${left} left</span>`;
  }

  const grid = $("#grid");
  const empty = $("#empty");
  const sentinel = $("#sentinel");
  const toastEl = $("#toast");

  // ---------- boot ----------
  // no-store: the manifest changes after rebuilds; heuristic caching serves stale prop lists
  fetch(CFG.manifest, { cache: "no-store" }).then(r => r.json()).then(data => {
    ALL = data.props || [];
    friendly = data.friendly || {};
    buildStats();
    buildMapTabs();
    renderProgress();
    applyFilters();
    setTimeout(() => $("#loader").classList.add("hide"), 250);
  }).catch(err => {
    $("#loader").innerHTML = '<div class="loader-text">Could not load manifest.json</div>';
    console.error(err);
  });

  // ---------- version badge ----------
  // RULE: the site version IS the released Godot plugin version — read live
  // from the registry (plugin/plugin-version.json, the same file the plugin's
  // self-updater checks), so a plugin release bumps both at once. The baked
  // "V1.00" only shows if the registry is unreachable.
  (function siteVersion() {
    const el = document.getElementById("siteVer");
    if (!el || !CFG.modelsBase) return;
    fetch(CFG.modelsBase + "plugin/plugin-version.json", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && j.version) el.textContent = "V" + j.version; })
      .catch(() => {});
  })();

  // ---------- full-library bundle download ----------
  (function libBundle() {
    const btn = document.getElementById("libDl");
    if (!btn || !CFG.modelsBase) return;
    fetch(CFG.modelsBase + "bundles/bundles.json", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null).then(m => {
        if (!m || !m.file) return;
        const url = CFG.modelsBase + m.file;
        const gb = (m.bytes || 0) / 1e9;
        const size = gb >= 1 ? "(" + gb.toFixed(1) + " GB)" : "(" + Math.round((m.bytes || 0) / 1e6) + " MB)";
        document.getElementById("libDlSize").textContent = size;
        const dl = document.getElementById("installDlBtn");
        if (dl) { dl.href = url; document.getElementById("installDlSize").textContent = size; }
        btn.hidden = false;
        btn.onclick = () => openM("#installOverlay");
      }).catch(() => {});
  })();

  // ---------- stats (count-up) ----------
  function buildStats() {
    const live = ALL.filter(p => !p.destroyed && !p.dup);   // destruction variants + wrapper dupes hidden
    const portal = live.filter(p => p.portal).length;
    const tris = live.reduce((a, p) => a + (p.tris || 0), 0);
    const stats = [
      { n: live.length, label: "Models" },
      { n: portal, label: "In Portal" },
      { n: tris, label: "Triangles" },
    ];
    const wrap = $("#headerStats");
    wrap.innerHTML = stats.map(s => `<div class="stat"><b data-to="${s.n}">0</b><span>${s.label}</span></div>`).join("");
    $$(".stat b", wrap).forEach(el => countUp(el, +el.dataset.to));
  }
  function countUp(el, to) {
    const dur = 1100, t0 = performance.now();
    const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : "" + n;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(to * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- map tabs ----------
  const mapName = c => (MAPS[c] && MAPS[c].name) || friendly[c] || c.replace(/_/g, " ");
  const mapLevel = c => (MAPS[c] && MAPS[c].level) || "MP_" + c;
  function buildMapTabs() {
    const nav = $("#maptabs");
    // all map codes present across props
    const codes = new Set();
    ALL.forEach(p => (p.maps || []).forEach(m => codes.add(m)));
    const ordered = [...codes].sort((a, b) => mapName(a).localeCompare(mapName(b)));
    const live = ALL.filter(p => !p.destroyed && !p.dup);
    const nPortal = live.filter(p => p.portal).length;
    const nGlobal = live.filter(p => p.global).length;
    const nOut = live.filter(p => !p.portal).length;
    const perMap = c => live.filter(p => p.global || (p.maps || []).includes(c)).length;
    const tab = (val, name, sub, n) =>
      `<button class="mtab${val === mapf ? " active" : ""}" data-map="${val}" title="${sub}">
         <span class="mtab-name">${name}<span class="n">${n}</span></span>
         <span class="mtab-code">${sub}</span>
       </button>`;
    nav.innerHTML =
      tab("portal", "All Maps", "every Portal asset", nPortal) +
      tab("global", "Global", "placeable on any map", nGlobal) +
      `<span class="mtab-sep" aria-hidden="true"></span>` +
      ordered.map(c => tab("map:" + c, mapName(c), mapLevel(c), perMap(c))).join("");
    $$(".mtab", nav).forEach(b => b.onclick = () => {
      mapf = b.dataset.map;
      $$(".mtab", nav).forEach(x => x.classList.toggle("active", x === b));
      applyFilters();
    });
  }
  function mapMatch(p) {
    if (mapf === "all") return true;
    if (mapf === "portal") return !!p.portal;
    if (mapf === "global") return !!p.global;
    if (mapf === "notportal") return !p.portal;
    if (mapf.startsWith("map:")) { const c = mapf.slice(4); return p.global || (p.maps || []).includes(c); }
    return true;
  }
  function vMatch(p) {
    if (vfilter === "all") return true;
    const v = verify[p.name];
    if (vfilter === "unset") return !v;
    return v === vfilter;   // "ok" | "bad"
  }

  // ---------- filter / sort ----------
  function applyFilters() {
    const q = term.trim().toLowerCase();
    view = ALL.filter(p =>
      !p.dup &&
      (showDestroyed || !p.destroyed) &&
      mapMatch(p) &&
      vMatch(p) &&
      (!q || p.name.toLowerCase().includes(q) || (p.portalName || "").toLowerCase().includes(q))
    );
    if (sort === "name") view.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "tris-desc") view.sort((a, b) => (b.tris || 0) - (a.tris || 0));
    else if (sort === "tris-asc") view.sort((a, b) => (a.tris || 0) - (b.tris || 0));
    grid.innerHTML = "";
    shown = 0;
    empty.hidden = view.length > 0;
    if (view.length) { $("#emptyTerm").textContent = q; }
    renderMore();
  }

  function renderMore() {
    const next = view.slice(shown, shown + (CFG.pageSize || 48));
    const frag = document.createDocumentFragment();
    next.forEach(p => frag.appendChild(makeCard(p)));
    grid.appendChild(frag);
    shown += next.length;
  }

  // ---------- card ----------
  function fmtTris(n) { return !n ? "" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k tris" : n + " tris"; }
  function mapNames(p) { return (p.maps || []).map(mapName); }
  // Portal prefab name is the primary label; fall back to the raw asset name when not in Portal
  function displayName(p) { return p.portalName || p.name; }
  // cache-bust GLB urls by mtime (fallback: size) so a rebuilt model is re-fetched, not served stale
  function glbUrl(p) { return (CFG.modelsBase || "") + p.glb + "?b=" + (p.hash || p.mt || p.kb || 0); }
  function makeCard(p) {
    const card = document.createElement("div");
    card.className = "mcard" + (p.portal ? "" : " not-portal");
    card.dataset.name = p.name;
    const pb = !p.portal ? `<span class="pbadge pb-no" title="Extracted from the game, but not a placeable Portal asset">NOT IN PORTAL</span>`
      : p.global ? `<span class="pbadge pb-glob" title="Placeable on every Portal map">GLOBAL</span>`
      : `<span class="pbadge pb-yes" title="Portal maps: ${mapNames(p).join(', ')}">PORTAL · ${p.maps.length} map${p.maps.length !== 1 ? "s" : ""}</span>`;
    const title = displayName(p);
    card.innerHTML = `
      <div class="mcard-view">
        ${p.destroyed ? `<span class="pbadge pb-dc" title="Destruction variant (shot-up / debris version)">DESTROYED</span>` : ""}
        ${pb}
        <span class="spin-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg></span>
        <div class="vctl">
          <button class="vbtn vok" data-v="ok" title="Looks right">&#10003;</button>
          <button class="vbtn vbad" data-v="bad" title="Looks wrong">&#10007;</button>
        </div>
        <model-viewer src="${glbUrl(p)}" loading="lazy" reveal="auto" interaction-prompt="none"
          ${isTouch ? "" : "camera-controls"} disable-zoom disable-tap disable-pan camera-orbit="-25deg 78deg auto"
          rotation-per-second="${CFG.spinSpeed || '42deg'}" exposure="1.0" environment-image="neutral"></model-viewer>
      </div>
      <div class="mcard-foot">
        <span class="mcard-name" title="${title} — in-game: ${p.name}">${title}</span>
        <span class="mcard-tris">${fmtTris(p.tris)}</span>
      </div>`;
    const mv = $("model-viewer", card);
    // hover = spin 360; leave = stop + reset framing
    if (!isTouch) {
      card.addEventListener("mouseenter", () => mv.setAttribute("auto-rotate", ""));
      card.addEventListener("mouseleave", () => { mv.removeAttribute("auto-rotate"); try { mv.resetTurntableRotation(); } catch (e) {} });
    } else {
      mv.setAttribute("auto-rotate", "");           // gentle idle spin on mobile
    }
    card.addEventListener("click", () => openViewer(p));
    // verify buttons (don't open the viewer)
    reflectCard(card, p.name);
    card.querySelectorAll(".vbtn").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      setV(p.name, b.dataset.v);
    }));
    return card;
  }

  // ---------- grow-out expanded viewer ----------
  // Desktop gets the full inspector (Godot camera, surface select/crop,
  // live texture realign + fix export); phones keep the light spinner.
  const ov = $("#mvOverlay"), big = $("#mvBig"), inspectEl = $("#mvInspect");
  let inspector = null;                 // lazy-loaded module (desktop only)
  let closeTimer = null;
  function openViewer(p) {
    cur = p;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    $("#mvName").textContent = displayName(p);
    const pill = !p.portal ? `<span class="pill no">Not in Portal</span>`
      : p.global ? `<span class="pill glob">Global · every map</span>`
      : `<span class="pill yes">Portal</span>`;
    const maps = p.portal && !p.global && p.maps.length ? ` &middot; ${mapNames(p).join(", ")}` : "";
    // show the matching in-game asset name when the Portal name is what's headlined
    const ingame = (p.portalName && p.portalName !== p.name) ? `<span class="mv-ingame" title="In-game asset name">in-game: <code>${p.name}</code></span>` : "";
    $("#mvSub").innerHTML = `${fmtTris(p.tris)}${pill}${maps}${ingame}`;
    reflectViewer(p.name);
    if (!isTouch) {
      $("#mvHint").textContent = "drag = orbit · scroll = zoom · RMB = freelook + WASD fly (scroll = speed) · ✎ Edit to inspect & fix textures";
      big.style.display = "none";
      big.removeAttribute("src");
      inspectEl.hidden = false;
      const boot = mod => { inspector = mod; mod.open(glbUrl(p), p.name, inspectEl, $("#mvHint")); };
      if (inspector) boot(inspector);
      else import("./inspector.js?v=2").then(boot).catch(() => {
        // inspector failed (old browser?) — fall back to the spinner
        inspectEl.hidden = true;
        big.style.display = "";
        big.setAttribute("src", glbUrl(p));
      });
    } else {
      $("#mvHint").textContent = "drag to orbit · pinch to zoom";
      inspectEl.hidden = true;
      big.style.display = "";
      big.setAttribute("src", glbUrl(p));
      big.setAttribute("camera-controls", "");
      big.setAttribute("disable-pan", "");
      big.removeAttribute("disable-zoom");
    }
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add("show"));
  }
  $("#mvOk").onclick = () => cur && setV(cur.name, "ok");
  $("#mvBad").onclick = () => cur && setV(cur.name, "bad");
  function closeViewer() {
    ov.classList.remove("show");
    if (inspector) inspector.close();
    closeTimer = setTimeout(() => { ov.hidden = true; big.removeAttribute("src"); inspectEl.hidden = true; closeTimer = null; }, 340);
  }
  $("#mvClose").onclick = closeViewer;
  ov.addEventListener("click", e => { if (e.target === ov) closeViewer(); });
  $("#mvReset").onclick = () => { try { big.resetTurntableRotation(); big.jumpCameraToGoal(); } catch (e) {} big.cameraOrbit = "auto auto auto"; };
  $("#mvMax").onclick = () => {
    const st = $("#mvStage");
    const on = st.classList.toggle("mv-full");
    $("#mvMax").classList.toggle("on", on);
  };
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // let an active inspector selection / maximized sheet consume Esc first
    if (!ov.hidden && !isTouch && inspectEl && !inspectEl.hidden) {
      const p = inspectEl.querySelector(".insp-panel");
      const bt = inspectEl.querySelector(".insp-big");
      if ((p && p.style.display === "block") || (bt && bt.style.display !== "none")) return;
    }
    closeViewer(); closeModals();
  });

  // ---------- infinite scroll ----------
  new IntersectionObserver(es => {
    if (es[0].isIntersecting && shown < view.length) renderMore();
  }, { rootMargin: "600px" }).observe(sentinel);

  // ---------- search / sort ----------
  const search = $("#search");
  search.addEventListener("input", () => {
    term = search.value;
    $(".search").classList.toggle("has-text", !!term);
    applyFilters();
  });
  $("#searchClear").onclick = () => { search.value = ""; term = ""; $(".search").classList.remove("has-text"); applyFilters(); search.focus(); };
  $("#sortSel").addEventListener("change", e => { sort = e.target.value; applyFilters(); });
  $("#destToggle").addEventListener("change", e => { showDestroyed = e.target.checked; applyFilters(); });

  // ---------- verify controls ----------
  $("#verifySel").addEventListener("change", e => { vfilter = e.target.value; applyFilters(); });
  $("#vbExport").onclick = () => {
    const blob = new Blob([JSON.stringify(verify, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "verification.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    window.toast && toast("Exported " + Object.keys(verify).length + " marks");
  };
  $("#vbImport").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { Object.assign(verify, JSON.parse(rd.result)); saveV(); renderProgress(); applyFilters(); window.toast && toast("Imported marks"); }
      catch (x) { window.toast && toast("Bad JSON file"); }
    };
    rd.readAsText(f); e.target.value = "";
  });
  $("#vbReset").onclick = () => { if (confirm("Clear ALL verification marks?")) { verify = {}; saveV(); renderProgress(); applyFilters(); } };
  // keyboard: while a model is open, V = verify, X = flag
  document.addEventListener("keydown", e => {
    if (ov.hidden || !cur) return;
    if (e.key === "v" || e.key === "V") setV(cur.name, "ok");
    else if (e.key === "x" || e.key === "X") setV(cur.name, "bad");
  });

  // ---------- modals ----------
  function openM(id) { $(id).hidden = false; }
  function closeModals() { $$(".about-overlay").forEach(o => o.hidden = true); }
  $("#aboutBtn").onclick = () => openM("#aboutOverlay");
  $("#creditsBtn").onclick = () => openM("#creditsOverlay");
  $("#aboutClose").onclick = closeModals;
  $("#creditsClose").onclick = closeModals;

  // ---------- version history ----------
  $("#newsBtn").onclick = () => { openM("#newsOverlay"); loadNews(); };
  $("#newsClose").onclick = closeModals;
  let newsLoaded = false;
  function loadNews() {
    if (newsLoaded) return;
    fetch("changelog.json", { cache: "no-store" }).then(r => r.json()).then(doc => {
      newsLoaded = true;
      const body = $("#newsBody");
      // Three lanes per day — Plugin / Site / Models — grouped under version
      // banners. A day that carries a plugin release ({plugin:{version,notes}})
      // starts a new version section; rolling days nest under the last one.
      // Big model waves collapse to a count that expands on demand.
      const CHIP_LIMIT = 12;
      let k = 0;
      body.innerHTML = (doc.entries || []).map(en => {
        const banner = en.plugin && en.plugin.version
          ? `<div class="news-version"><span class="news-vtag">v${en.plugin.version}</span>${en.plugin.notes ? " " + en.plugin.notes : ""}</div>` : "";
        const plug = (en.pluginNotes || []).length
          ? `<h3 class="about-sub">Plugin</h3><ul class="news-list">${en.pluginNotes.map(s => `<li>${s}</li>`).join("")}</ul>` : "";
        const site = (en.site || []).length
          ? `<h3 class="about-sub">Site</h3><ul class="news-list">${en.site.map(s => `<li>${s}</li>`).join("")}</ul>` : "";
        let models = "";
        if ((en.models || []).length) {
          const chips = en.models.map(m => `<button class="news-model" data-m="${m}">${m}</button>`).join("");
          if (en.models.length > CHIP_LIMIT) {
            const id = "nm" + (k++);
            models = `<h3 class="about-sub">Models updated (${en.models.length})</h3>
              <button class="news-model news-expand" data-t="${id}">show all ${en.models.length} models</button>
              <div class="news-models" id="${id}" hidden>${chips}</div>`;
          } else {
            models = `<h3 class="about-sub">Models updated (${en.models.length})</h3>
              <div class="news-models">${chips}</div>`;
          }
        }
        return `${banner}<div class="news-entry">
          <div class="news-date">${en.date}${en.title ? " — " + en.title : ""}</div>
          ${en.note ? `<p class="news-note">${en.note}</p>` : ""}
          ${plug}${site}${models}
        </div>`;
      }).join("") || '<p class="about-note">No entries yet.</p>';
      // expanders
      body.querySelectorAll(".news-expand").forEach(b => b.onclick = () => {
        const box = document.getElementById(b.dataset.t);
        if (box) { box.hidden = false; b.remove(); }
      });
      // clicking a model name searches for it
      body.querySelectorAll(".news-model:not(.news-expand)").forEach(b => b.onclick = () => {
        closeModals();
        const s = $("#search");
        s.value = b.dataset.m; term = b.dataset.m;
        $(".search").classList.add("has-text");
        applyFilters();
        s.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }).catch(() => { $("#newsBody").innerHTML = '<p class="about-note">Could not load the changelog.</p>'; });
  }
  { const ic = $("#installClose"); if (ic) ic.onclick = closeModals; }
  $$(".about-overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) closeModals(); }));

  // ---------- header shrink ----------
  addEventListener("scroll", () => $("#header").classList.toggle("small", scrollY > 40), { passive: true });

  // ---------- toast ----------
  window.toast = (m) => { toastEl.textContent = m; toastEl.classList.add("show"); setTimeout(() => toastEl.classList.remove("show"), 2000); };
})();
