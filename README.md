# BF6 Portal Model Library

Browse every extracted Battlefield 6 prop in 3D — with the Portal prefab
names and per-map availability used by the Portal SDK. Companion to the
High-Poly Preview plugin for building more accurate Portal maps in Godot.

## Running locally

Put (or symlink) a `models/` folder and `manifest.json` next to `index.html`,
then:

    python serve.py 8000

`serve.py` sends correct cache headers (`no-cache` for HTML/JS/JSON, long
cache for models — model URLs are content-hash busted).

## Production

The site is static — host it anywhere (GitHub Pages works). Point it at the
published registry via `config.js`:

    manifest:   "https://<models-host>/manifest.json",
    modelsBase: "https://<models-host>/",

Models and manifests are published from the community registry repo, where
model fixes are submitted and reviewed. Corrected models appear here
automatically (content-hash cache busting).
