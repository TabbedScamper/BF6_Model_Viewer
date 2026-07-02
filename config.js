/* Model Library config */
window.CONFIG = {
  // Where to fetch the manifest. Local file for dev; point at the published
  // registry manifest (e.g. https://models.example.com/manifest.json) in prod.
  manifest: "https://pub-45114dae448e4a059f488662e3d47b19.r2.dev/manifest.json",
  // Base URL prefixed to every model path. "" = same-origin ./models/…
  // In prod: "https://<bucket-host>/" (must allow CORS from the site origin).
  modelsBase: "https://pub-45114dae448e4a059f488662e3d47b19.r2.dev/",
  pageSize: 48,          // cards rendered per infinite-scroll page
  spinSpeed: "42deg",    // hover auto-rotate speed (per second)
};
