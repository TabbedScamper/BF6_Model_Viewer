"""One-time bootstrap: publish the ENTIRE local model library to the bucket
and seed registry/manifest.json with hashes/versions.

Run locally (not CI). Reads the pipeline's site manifest + models dir, uploads
every GLB (optionally optimized), writes hash/v/updatedAt into the registry
manifest, generates plugin-manifest.json, uploads both.

Env: MODELS_ENDPOINT, MODELS_BUCKET, MODELS_KEY_ID, MODELS_SECRET
Usage: bulk_publish.py <site_dir> [--optimize]   (site_dir has manifest.json + models/)
"""
import sys, os, json, hashlib, subprocess, tempfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from publish import s3, make_plugin_manifest, optimize

def main():
    site = sys.argv[1]
    do_opt = "--optimize" in sys.argv
    man = json.load(open(os.path.join(site, "manifest.json"), encoding="utf-8"))
    client = s3(); bucket = os.environ["MODELS_BUCKET"]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    ok = fail = 0
    for i, e in enumerate(man["props"]):
        src = os.path.join(site, e["glb"].replace("/", os.sep))
        if not os.path.exists(src):
            fail += 1; continue
        try:
            gdata = open(src, "rb").read()
            gh = hashlib.sha1(gdata).hexdigest()[:12]
            client.put_object(Bucket=bucket, Key=f"godot/{e['name']}.glb", Body=gdata,
                              ContentType="model/gltf-binary",
                              CacheControl="public, max-age=31536000")
            if do_opt:
                with tempfile.TemporaryDirectory() as td:
                    opt = os.path.join(td, "m.glb")
                    optimize(src, opt)
                    data = open(opt, "rb").read()
            else:
                data = gdata
            h = hashlib.sha1(data).hexdigest()[:12]
            key = f"models/{e['name']}.glb"
            client.put_object(Bucket=bucket, Key=key, Body=data,
                              ContentType="model/gltf-binary",
                              CacheControl="public, max-age=31536000")
            e["glb"] = key; e["kb"] = round(len(data)/1024)
            e["hash"] = h; e["ghash"] = gh; e["gkb"] = round(len(gdata)/1024)
            e["v"] = int(e.get("v", 0)) or 1; e["updatedAt"] = now
            ok += 1
        except Exception as ex:
            fail += 1; print("FAIL", e["name"], ex)
        if i % 200 == 0:
            print(f"[{i}/{len(man['props'])}] ok={ok} fail={fail}", flush=True)
    json.dump(man, open(os.path.join(ROOT, "registry", "manifest.json"), "w", encoding="utf-8"))
    pm = make_plugin_manifest(man)
    pm_path = os.path.join(ROOT, "registry", "plugin-manifest.json")
    json.dump(pm, open(pm_path, "w", encoding="utf-8"))
    for key, path in (("manifest.json", os.path.join(ROOT, "registry", "manifest.json")),
                      ("plugin-manifest.json", pm_path)):
        client.put_object(Bucket=bucket, Key=key, Body=open(path, "rb").read(),
                          ContentType="application/json", CacheControl="public, max-age=300")
    print(f"DONE ok={ok} fail={fail}; manifests published")

if __name__ == "__main__":
    main()
