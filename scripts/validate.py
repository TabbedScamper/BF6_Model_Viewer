"""Validate submitted model fixes (runs in CI on every PR).

For each GLB under submissions/<PropName>/:
  - parses as glTF and contains triangles
  - has UVs and vertex normals (Godot needs normals for tangents)
  - textures within budget (<= 2048 px)
  - triangle budget (<= 150k per prop)
  - dimensions vs the SDK proxy AABB (data/proxy_aabb.tsv) when the prop name
    is a known proxy: sorted-dims ratio spread <= 1.5 (catches wrong-variant
    submissions), logged as warning otherwise

Exit code 1 on any hard failure. Prints a markdown report to stdout
(the workflow posts it as a PR comment).
Usage: validate.py <file.glb> [more.glb ...]
"""
import sys, os, json
import numpy as np

def load_proxy_aabb():
    d = {}
    p = os.path.join(os.path.dirname(__file__), "..", "data", "proxy_aabb.tsv")
    for ln in open(p, encoding="utf-8"):
        c = ln.rstrip("\n").split("\t")
        if c[0] == "proxy": continue
        d[c[0].lower()] = np.sort([float(c[1]), float(c[2]), float(c[3])])[::-1]
    return d

def check(path, proxy_aabb):
    import trimesh
    name = os.path.basename(path)[:-4]
    errs, warns, info = [], [], []
    try:
        sc = trimesh.load(path, force="scene")
    except Exception as e:
        return [f"does not parse as glTF: {e}"], [], []
    tris = 0
    has_uv = True
    has_norm = True
    tex_max = 0
    bounds_lo = None; bounds_hi = None
    for g in sc.geometry.values():
        tris += len(g.faces)
        uv = getattr(g.visual, "uv", None)
        if uv is None or len(uv) == 0: has_uv = False
        vn = getattr(g, "vertex_normals", None)
        if vn is None or len(vn) == 0: has_norm = False
        mat = getattr(g.visual, "material", None)
        for attr in ("baseColorTexture", "normalTexture", "metallicRoughnessTexture"):
            img = getattr(mat, attr, None)
            if img is not None and hasattr(img, "size"):
                tex_max = max(tex_max, max(img.size))
        b = g.bounds
        if b is not None:
            bounds_lo = b[0] if bounds_lo is None else np.minimum(bounds_lo, b[0])
            bounds_hi = b[1] if bounds_hi is None else np.maximum(bounds_hi, b[1])
    if tris == 0: errs.append("no triangles")
    if tris > 150_000: errs.append(f"triangle budget exceeded: {tris:,} > 150,000")
    if not has_uv: errs.append("missing UVs on at least one mesh")
    if not has_norm: errs.append("missing vertex normals (Godot needs them for tangents)")
    if tex_max > 2048: errs.append(f"texture larger than 2048px ({tex_max})")
    info.append(f"{tris:,} tris, textures <= {tex_max or 'none'} px")
    if bounds_lo is not None:
        ext = np.sort(bounds_hi - bounds_lo)[::-1]
        info.append(f"extents {ext.round(3).tolist()} m")
        pa = proxy_aabb.get(name.lower())
        if pa is not None:
            r = [pa[i] / ext[i] for i in range(3) if pa[i] > 0.05 and ext[i] > 0.05]
            if r and max(r) / min(r) > 1.5:
                errs.append(f"dimensions disagree with SDK proxy {pa.round(2).tolist()} "
                            f"(ratio spread {max(r)/min(r):.2f}) — wrong variant?")
            elif r:
                info.append(f"proxy dims OK (spread {max(r)/min(r):.2f})")
        else:
            warns.append("no SDK proxy AABB on record — dims not cross-checked")
    return errs, warns, info

def main():
    files = sys.argv[1:]
    if not files:
        print("nothing to validate"); return
    proxy_aabb = load_proxy_aabb()
    failed = False
    print("## Model validation\n")
    for f in files:
        errs, warns, info = check(f, proxy_aabb)
        status = "FAIL" if errs else "PASS"
        if errs: failed = True
        print(f"### `{os.path.basename(f)}` — **{status}**")
        for e in errs: print(f"- :x: {e}")
        for w in warns: print(f"- :warning: {w}")
        for i in info: print(f"- {i}")
        print()
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
