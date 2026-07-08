# How the models are made

This page documents the full pipeline behind the model library and the
[High-Poly Godot Plugin](https://github.com/TabbedScamper/BF6_High_Poly_Godot_Plugin):
where the geometry comes from, how textures are reconstructed, how composite
objects are assembled, and how a fix travels from this site back into
everyone's editor. It exists so the process is reproducible and so
contributors know what they're looking at when something is wrong.

## 1. Source of truth

Everything starts from the retail Battlefield 6 files (read-only — the live
game process is never touched). Community Frostbite tools unpack the
superbundles into a browsable tree of typed assets:

- `*.MeshSet` — mesh geometry (all LODs + per-LOD material name tables)
- `*.Texture` — BCn-compressed textures; the header declares the role
  (`World_BaseColor`, `World_Normal`, `World_Vista`, `Vegetation_*` …)
- `*.ebx` — typed object data: prefab blueprints, physics, enums

The Portal SDK ships a low-poly proxy for every placeable object. The proxy
is the contract: everything the pipeline builds must match its name, pivot,
and dimensions. **The low-poly proxy is always the source of truth** — the
high-poly model is an overlay, never a replacement.

## 2. From MeshSet to a textured model

A mesh alone renders black or grey; the work is in the materials:

- **Shadow submeshes are dropped.** Nearly every MeshSet carries UV-less
  shadow/depth submeshes that enclose the visible mesh and sample nothing.
- **Per-LOD material tables** in the MeshSet map each submesh to its
  `M_*` material name — that name drives texture selection.
- **Texture roles come from headers, not filenames**, and sRGB BCn variants
  are remapped to their UNORM twins before decode (byte-identical blocks).
- **Multi-UV composites:** many props use UV0 for tiling detail, UV1 for a
  unique per-object bake (vista color/normal), UV2 for overlays. Composited
  sheets ride the bake channel whenever UV0 tiles beyond 0–1.
- **Shared-material props** (plaster walls, facades) have no co-located base
  color: the pipeline resolves the shared sheet from the architecture
  material packs by material-name family search, applies per-mesh tiling
  parameters read from the mesh EBX, and bakes vista color/normal on top.
- **Vegetation** gets its leaf cutout from the separate `Vegetation_Alpha`
  sheets (never basecolor alpha), with far-LOD billboard impostors dropped.
  The leaf rules apply **only** to actual vegetation (folder/name gated) — a
  truck's canvas "canopy" material must not inherit a tree-leaf cutout.
- **Texture candidates are scored against material context.** A candidate
  sheet whose distinctive name tokens (`dashboard`, `interior`, …) don't
  appear in the submesh's material name is penalized, and a sheet is only
  auto-picked when it wins uniquely. Names tokenize across letter↔digit
  boundaries so `exterior01` and `M_…_Exterior_01` meet in the middle.
- **Civilian vehicles and many decorated props bake their whole look** into a
  per-object vista sheet (`vst_<mesh>_cs`) addressed by the bake UV channel —
  the co-located "detail" sheets are only pieces (a dashboard, a decal). When
  the exact-name vista sheet exists, it wins.
- **Drivable-vehicle bodies mirror their UVs** (left half mirrored onto the
  right, UV span ≈ 2): that still means UV0, not the bake channel — only real
  tiling (span > 2.5) switches channels. Aircraft keep all paint in
  `skins/<variant>/`; when a folder has no base sheets the most complete skin
  is used.
- **Alpha is only honored when it looks like a cutout** (mostly-opaque sheet
  with a meaningful fully-transparent fraction). Wear/blend masks stored in
  alpha channels otherwise punch holes in solid surfaces.

Every rule above came from a human review loop (see §4) and is data-driven —
pinned in TSV tables, not hardcoded per model.

## 3. Composite objects (prefab assembly)

Many Portal placeables are not one mesh — souk houses with prop dressing,
interiors, wreck vehicles, planter clusters. Name-matching can never
represent them. For these the pipeline reads the game's own prefab
blueprints (`pf_portal_<name>.ebx`, the same data the game uses to spawn the
object) and assembles the full member tree — meshes, transforms, nested
sub-prefabs, mirrored instances — into one exact game-space GLB. Assembled
models ship with a `nofit` flag so the plugin places them identity instead
of auto-fitting.

Three repair classes exist for objects the original matcher got wrong:

| Class | Fix |
|---|---|
| Blueprint exists | exact assembly from the game's prefab data |
| Single mesh, name carries a region infix (`br_ind_…`, `seu_…`) | direct build of the correct mesh |
| No game-side definition at all (SDK-only compositions) | match removed → clean grey proxy instead of a wrong model |

That last class is verified, not assumed: the only place those names occur
in the retail data is the per-map spawn-name registries, so there is nothing
to build from. They stay grey until better data exists.

## 3b. Doors that open

Interactable doors are the trickiest single meshes in the game: one MeshSet
stores **both** states (intact leaf + destroyed splinters), sometimes with the
node basis flipped so the "spare" state hides below the origin. The door
builder classifies each connected component in **world space** against the
measured SDK proxy box — components that land underground are alternate
states and are dropped; the intact leaf is re-homed under a node **whose
origin is the real hinge**. Hinge transform and swing angle come from the
game's own `interactabledoorcontrol` data and ship in the plugin manifest, so
the editor can animate the exact swing (left double-click a door in the
plugin). Prefabs containing doors bake the closed state.

## 3c. Gameplay objects (vehicles, soldiers, weapons)

Vehicle spawners, soldier spawn points and the loot spawner have no mesh
blueprint at all — they are pure spawn logic. Their previews are built from
the game's hardware and character libraries instead:

- **Vehicles**: the base hull ships in bind pose, but wheels, tracks and
  turret parts are stored at the origin. Their true positions are mined from
  the vehicle's **skeleton** (model-space bind transforms of `loc_Wheel_*`
  and mount bones); tank tracks are mirrored to the road-wheel line, and
  mounted weapon stations are attached only where the game actually mounts
  one. Every result is gated against the measured proxy box before it ships.
- **Soldiers**: a full specialist is uniform body + headgear + backpack +
  face meshes, all in one shared space — an A-pose statue of the real
  character.
- **Weapons**: third-person weapon parts (receiver + barrel + sights)
  self-assemble at identity in weapon space.

## 4. The review loop

Nothing ships on automated confidence alone. Models are eyeballed in a
viewer (the same inspector that powers this site's desktop editor): surface
selection reports the material under the cursor, a crop tool sketches a
region on a wall plane, and texture realignments export as a small JSON fix.
The build consumes those fixes with the same UV rules the preview used, so
what you corrected is exactly what gets baked. Every finding that
generalizes becomes a global pipeline rule rather than a one-off patch.

## 5. Publishing and delivery

Releases are rolling — content hashes are the version numbers:

- Each model uploads in two renditions: a Godot-importable one (WebP
  textures, geometry untouched) and a condensed web one (plus Draco).
  Renditions are pure compression; nothing is joined or flattened, so the
  site's fix keys always match the source.
- The site manifest and the plugin manifest regenerate together. The plugin
  manifest is tier-filtered: only trustworthy proxy↔mesh matches are
  published, so a bad guess can never hide user geometry in the editor.
- The plugin syncs in the background — manifest diff on start and hourly,
  open-scene props first, progress bar instead of dialogs. A republished
  model self-heals on every user's machine via its content hash.

## 6. Contributing

Model fixes are welcome — see the README for the submission flow (fork, add
your GLB under `submissions/`, open a PR; CI validates and previews it).
The best fix reports name the exact prop from this site and include an
in-game screenshot of what it should look like.
