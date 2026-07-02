"""Publish approved model fixes (runs in CI on merge to main).

For each GLB under submissions/:
  1. optimize a copy (gltf-transform: dedup/prune/meshopt + webp textures)
  2. content-hash it (sha1, first 12 hex)
  3. upload to the bucket at models/<name>.glb (S3-compatible: R2/B2)
  4. bump the model's entry in registry/manifest.json
     {name, glb, kb, hash, version+1, updatedAt}
  5. regenerate registry/plugin-manifest.json (proxy-name keyed, via matches.tsv)
  6. upload both manifests

Bucket credentials from env: MODELS_ENDPOINT, MODELS_BUCKET,
MODELS_KEY_ID, MODELS_SECRET (set as repo Actions secrets).
Usage: publish.py <file.glb> [more.glb ...]
"""
import sys, os, json, hashlib, subprocess, tempfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "registry", "manifest.json")

def optimize(src, dst):
    r = subprocess.run(["npx", "--yes", "@gltf-transform/cli", "optimize", src, dst,
                        "--compress", "meshopt", "--texture-compress", "webp"],
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
    """proxy-name keyed manifest for the Godot plugin (via matches.tsv)"""
    byname = {e["name"]: e for e in man["props"]}
    match = {}
    for ln in open(os.path.join(ROOT, "data", "matches.tsv"), encoding="utf-8"):
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 4 and p[0] != "godot_proxy":
            match[p[0]] = p[1]
    out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "props": {}}
    for prox, game in match.items():
        e = byname.get(game)
        if e is None: continue
        out["props"][prox] = {"glb": e["glb"], "hash": e.get("hash"), "v": e.get("v", 1)}
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
            e["v"] = int(e.get("v", 0)) + 1
            e["updatedAt"] = now
            print(f"published {name} v{e['v']} hash={h} ({e['kb']} KB)")
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
