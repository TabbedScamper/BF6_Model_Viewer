# BF6 Model Viewer

Browse every extracted Battlefield 6 prop in 3D — with the Portal prefab
names and per-map availability used by the Portal SDK — and the community
registry for submitting model fixes. Companion to the
[High-Poly Godot Plugin](https://github.com/TabbedScamper/BF6_High_Poly_Godot_Plugin)
for building more accurate Portal maps.

## The site

Static, host anywhere (GitHub Pages works). `config.js` points it at the
published registry:

    manifest:   "https://<models-host>/manifest.json",
    modelsBase: "https://<models-host>/",

Local dev: put a `models/` folder + `manifest.json` next to `index.html`,
then `python serve.py 8000` (correct cache headers included). The site is
browse-only by design — model downloads and updates go through the Godot
plugin.

## Submitting a model fix

Found a prop with a broken texture, wrong variant, or bad geometry?

1. Fork, add your fixed model at `submissions/<PropName>/<PropName>.glb`
   (exact model name from the site; multiple models per PR is fine).
2. Open a PR describing the fix. CI validates automatically (parses, UVs,
   vertex normals, texture/tri budgets, dimensions vs the SDK proxy) and
   renders preview screenshots for review.
3. Once approved and merged, the model is optimized, uploaded, and
   versioned automatically. The site shows it within minutes; Godot plugin
   users get it on their next **Update Models** click.

Submission requirements (CI enforces):
- Binary glTF (`.glb`), meters, Y-up, pivot matching the original model
- UVs + vertex normals present; textures ≤ 2048px; ≤ 150k triangles
- Overall dimensions must agree with the SDK proxy (wrong-size submissions
  are usually the wrong variant — check the site first)

Match corrections (an SDK proxy pointing at the wrong game mesh) are a
one-line PR to `data/matches.tsv` — set `tier` to `manual` so the fix is
never regenerated over.

## Repo layout

- `index.html`, `app.js`, … — the viewer site
- `registry/manifest.json` — every model: URL, content hash, version
- `registry/plugin-manifest.json` — same, keyed by SDK proxy name (consumed
  by the Godot plugin's Update Models)
- `data/matches.tsv`, `data/proxy_aabb.tsv` — proxy↔mesh mapping + dims
- `submissions/` — model fixes come in here via PR
- `scripts/` — CI validation and publishing

Maintainer: publishing needs `MODELS_ENDPOINT`, `MODELS_BUCKET`,
`MODELS_KEY_ID`, `MODELS_SECRET` secrets (any S3-compatible store);
first-time bootstrap via `scripts/bulk_publish.py`.
