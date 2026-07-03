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

  // Map registry: manifest map code -> in-game name + the Portal SDK level
  // codename (the name creators actually pick in the SDK / web editor).
  // Granite (RedSec) enum codes were verified against asset levelRestrictions.
  maps: {
    Abbasid:                  { name: "Siege of Cairo",           level: "MP_Abbasid" },
    Aftermath:                { name: "Empire State",             level: "MP_Aftermath" },
    Badlands:                 { name: "Blackwell Fields",         level: "MP_Badlands" },
    Battery:                  { name: "Iberian Offensive",        level: "MP_Battery" },
    Capstone:                 { name: "Liberation Peak",          level: "MP_Capstone" },
    Contaminated:             { name: "Contaminated",             level: "MP_Contaminated" },
    Dumbo:                    { name: "Manhattan Bridge",         level: "MP_Dumbo" },
    Eastwood:                 { name: "Eastwood",                 level: "MP_Eastwood" },
    FireStorm:                { name: "Operation Firestorm",      level: "MP_FireStorm" },
    GolmudRailway:            { name: "Railway to Golmud",        level: "MP_GolmudRailway" },
    Limestone:                { name: "Saints Quarter",           level: "MP_Limestone" },
    Outskirts:                { name: "New Sobek City",           level: "MP_Outskirts" },
    Plaza:                    { name: "Cairo Bazaar",             level: "MP_Plaza" },
    Sand:                     { name: "Portal Sandbox",           level: "MP_Portal_Sand" },
    Subsurface:               { name: "Hagental Base",            level: "MP_Subsurface" },
    Tungsten:                 { name: "Mirak Valley",             level: "MP_Tungsten" },
    Granite_Downtown:         { name: "RedSec: Downtown",         level: "MP_Granite_MainStreet_Portal" },
    Granite_Marina:           { name: "RedSec: Marina",           level: "MP_Granite_Marina_Portal" },
    Granite_MilitaryRnD:      { name: "RedSec: Military R&D",     level: "MP_Granite_MilitaryRnD_Portal" },
    Granite_MilitaryStorage:  { name: "RedSec: Military Storage", level: "MP_Granite_MilitaryStorage_Portal" },
    Granite_ResidentialNorth: { name: "RedSec: Residential",      level: "MP_Granite_ClubHouse_Portal" },
    Granite_TechCenter:       { name: "RedSec: Tech Center",      level: "MP_Granite_TechCampus_Portal" },
    Granite_Underground:      { name: "RedSec: Underground",      level: "MP_Granite_Underground_Portal" },
  },
};
