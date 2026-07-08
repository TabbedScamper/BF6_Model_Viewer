"""Publish approved model fixes (runs in CI on merge to main).

For each GLB under submissions/, publishes TWO renditions:
  - godot/<name>.glb  — Godot-importable: plain geometry (no draco), WebP
    textures (Godot imports EXT_texture_webp) -> plugin-manifest.json
  - models/<name>.glb — condensed web rendition (gltf-transform draco +
    webp; Godot canNOT import these) -> manifest.json (the site)
  Both are content-hashed; manifests bumped and uploaded.

Bucket credentials from env: MODELS_ENDPOINT, MODELS_BUCKET,
MODELS_KEY_ID, MODELS_SECRET (set as repo Actions secrets).
Usage: publish.py <file.glb> [more.glb ...]
"""
import sys, os, json, hashlib, subprocess, tempfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "registry", "manifest.json")

def optimize(src, dst):
    r = subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", src, dst,
                        "--compress", "draco", "--texture-compress", "webp"],
                       capture_output=True, text=True, shell=os.name == "nt")
    if r.returncode != 0 or not os.path.exists(dst):
        print(f"  optimize failed ({r.stderr.strip()[:200]}); publishing unoptimized")
        import shutil; shutil.copy(src, dst)

def s3():
    import boto3
    return boto3.client("s3",
        endpoint_url=os.environ["MODELS_ENDPOINT"],
        aws_access_key_id=os.environ["MODELS_KEY_ID"],
        aws_secret_access_key=os.environ["MODELS_SECRET"])

def make_plugin_manifest(man):
    """proxy-name keyed manifest for the Godot plugin (via matches.tsv).
    Points at the godot/ rendition (ghash/gkb per entry)."""
    byname = {e["name"]: e for e in man["props"]}
    match = {}
    for ln in open(os.path.join(ROOT, "data", "matches.tsv"), encoding="utf-8"):
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 4 and p[0] != "godot_proxy":
            # none/weak rows are name-matcher noise: they map gameplay/logic
            # proxies (Sector, MCOM, ...) or wildly wrong meshes, and matching
            # them makes the plugin hide user geometry. Drop at the source.
            if p[3] in ("none", "weak"):
                continue
            match[p[0]] = p[1]
    # interactable-door hinge specs (data/door_specs.json): the plugin's
    # right-click door toggle swings `doorleaf_*` nodes baked into the model
    doors = {}
    dsp = os.path.join(ROOT, "data", "door_specs.json")
    if os.path.exists(dsp):
        doors = json.load(open(dsp, encoding="utf-8"))
    out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "props": {}}
    for prox, game in match.items():
        e = byname.get(game)
        if e is None: continue
        entry = {"glb": "godot/%s.glb" % e["name"],
                 "hash": e.get("ghash") or e.get("hash"),
                 "v": e.get("v", 1)}
        # medium tier retired: high-poly is the only downloadable rendition
        # ("no textures" mode is a runtime override, not separate data)
        if e.get("asm"):
            # prefab-assembled, exact game-space build: plugin skips auto-fit
            entry["nofit"] = True
        if prox in doors:
            entry["door"] = {"deg": doors[prox].get("deg", 85.0)}
        out["props"][prox] = entry
    return out

def main():
    files = [f for f in sys.argv[1:] if f.endswith(".glb")]
    man = json.load(open(MANIFEST, encoding="utf-8"))
    byname = {e["name"]: e for e in man["props"]}
    client = s3()
    bucket = os.environ["MODELS_BUCKET"]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    for f in files:
        name = os.path.basename(f)[:-4]
        with tempfile.TemporaryDirectory() as td:
            # godot rendition = webp textures, geometry untouched (importable)
            gsrc = os.path.join(td, name + ".godot.glb")
            r = subprocess.run(["npx", "--yes", "@gltf-transform/cli", "webp", f, gsrc],
                               capture_output=True, text=True, shell=os.name == "nt")
            gdata = open(gsrc if os.path.exists(gsrc) else f, "rb").read()
            gh = hashlib.sha1(gdata).hexdigest()[:12]
            client.put_object(Bucket=bucket, Key=f"godot/{name}.glb", Body=gdata,
                              ContentType="model/gltf-binary",
                              CacheControl="public, max-age=31536000")
            # web rendition = condensed
            opt = os.path.join(td, name + ".glb")
            optimize(f, opt)
            data = open(opt, "rb").read()
            h = hashlib.sha1(data).hexdigest()[:12]
            key = f"models/{name}.glb"
            client.put_object(Bucket=bucket, Key=key, Body=data,
                              ContentType="model/gltf-binary",
                              CacheControl="public, max-age=31536000")
            e = byname.get(name)
            if e is None:
                e = {"name": name, "cat": "misc", "glb": key, "tris": 0,
                     "maps": [], "global": False, "portal": False,
                     "portalName": None, "glass": False,
                     "destroyed": name.startswith("dc_")}
                man["props"].append(e); byname[name] = e
            e["glb"] = key
            e["kb"] = round(len(data) / 1024)
            e["hash"] = h
            e["ghash"] = gh
            e["gkb"] = round(len(gdata) / 1024)
            e["v"] = int(e.get("v", 0)) + 1
            e["updatedAt"] = now
            print(f"published {name} v{e['v']} web={h}({e['kb']}KB) godot={gh}({e['gkb']}KB)")
    man["props"].sort(key=lambda x: x["name"])
    man["count"] = len(man["props"])
    json.dump(man, open(MANIFEST, "w", encoding="utf-8"))
    pm = make_plugin_manifest(man)
    pm_path = os.path.join(ROOT, "registry", "plugin-manifest.json")
    json.dump(pm, open(pm_path, "w", encoding="utf-8"))
    for key, path in (("manifest.json", MANIFEST), ("plugin-manifest.json", pm_path)):
        client.put_object(Bucket=bucket, Key=key, Body=open(path, "rb").read(),
                          ContentType="application/json",
                          CacheControl="public, max-age=300")
    print("manifests published")

if __name__ == "__main__":
    main()
