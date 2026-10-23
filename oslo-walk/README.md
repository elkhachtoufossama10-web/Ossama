# Oslo Walk — An Immersive City Experience

A first-person walking simulator for four real areas of central Oslo, built with **React + TypeScript + Three.js** (Vite).

```bash
cd oslo-walk
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (npm run preview to serve it)
```

No API keys or external services are needed at runtime; everything ships in the repo.

## Controls

| Input | Action |
|---|---|
| W A S D / arrow keys | walk |
| Mouse | look (click "Start Walking" to capture the mouse) |
| Shift | walk a little faster |
| Esc | release the mouse → pause menu |
| H | show / hide the controls hint |
| Touch | left stick to walk, drag anywhere else to look |

## What is real and what is reconstructed

| Part | Source |
|---|---|
| Street layout, road and path widths, squares, piers, coastline, water | **OpenStreetMap** (© OpenStreetMap contributors, ODbL), downloaded with the official OSM API and converted by `scripts/build_osm.py` |
| Building footprints and courtyards | OSM, including `building:part` volumes (Opera House, Barcode, Oslo S…) |
| Building heights | OSM `height` / `building:levels` where mapped. About 25 % of buildings have no height in OSM; those use a typical height for their type (marked `e:1` in the data). |
| Trees, benches, street lamps, traffic signals | OSM points. Extra lamps are added along streets where OSM has none. |
| Facades, windows, shopfronts, materials | **Procedural** shaders: plaster, brick, stone and glass styles with Oslo-like colours. Landmarks get a hand-picked style (Opera = white stone, Stortinget = yellow brick…). They are not photographs or scans of the real facades. |
| Roof shapes | Flat. Sloped roofs, the Opera's walkable roof and towers are not modelled. |
| Pedestrians, cyclists, cars, red city buses | Procedural, animated in real time. People walk the real footways and sidewalks; cars drive the real streets on the right-hand side. |
| Sound | Synthesised with the Web Audio API (no recordings, nothing to license). |

The four areas are separate, explorable reconstructions of about 1.0–1.4 km × 0.6 km each, not a seamless city.

## Features

- **First-person walking** at 1.68 m eye height: smooth acceleration, subtle stride-synced head-bob (reduced-motion option), collision with every building footprint, the quay edge and pools, and an area boundary.
- **Day presets:** Sunny, Overcast, Golden hour. Each has its own sun angle, sky, clouds, shadow softness and fog.
- **Night presets:** Blue hour and Night, with a dark Nordic sky, stars and moon. Lit windows are random per window, shopfronts and signs glow at night, there are warm pools of streetlight and real point lights on the nearest lamps, headlights and taillights, and restrained bloom.
- **Weather:** clear, overcast, light rain (rain streaks plus wet, reflective pavement with puddles) and wet streets.
- **Seasons:** summer, autumn (orange trees, leaves on the ground) and winter (snow on the ground, roofs and ledges; snowfall instead of rain).
- **Crowds:** walkers at different speeds, groups of friends, people waiting at shop windows, people sitting on benches, cyclists. They avoid each other and you.
- **Audio:** footsteps (stone, wet or snow), traffic that gets louder near cars, wind, rain, harbour water near the quay, an unintelligible crowd murmur, and birds by day. Volume and mute controls. Sound starts only after you press Start.
- **Graphics quality:**
  - **Low:** 1024 shadows, no bloom, simple water.
  - **High:** 2048 shadows, bloom, reflective water.
  - **Ultra:** 4096 shadows, ambient occlusion (GTAO), more people and lights.
  - Render resolution also adapts automatically when the frame rate drops.
- **Error handling:** if map data fails to load, a retry dialog appears. WebGL context loss recovers automatically, and missing optional models fall back to procedural people.

## Optional: realistic GLB characters

The procedural pedestrians are lightweight stand-ins. To use real rigged characters (for example licensed Mixamo or Ready Player Me exports):

1. Put the files in `public/models/`. Each `.glb` needs a walking animation, ideally a clip whose name contains "walk".
2. List them in `public/models/manifest.json`, for example `[{ "file": "woman_coat.glb" }, { "file": "man_jacket.glb" }]`.

Up to 12 walkers near you are then rendered with those models. Only add models whose licence allows redistribution.

## Updating the map data

The raw `.osm` extracts live in `osm-raw/` (git-ignored). To download fresh data and rebuild:

```bash
curl -o osm-raw/karljohan.osm "https://api.openstreetmap.org/api/0.6/map?bbox=10.7265,59.9110,10.7480,59.9165"
pip install shapely
npm run data
```

## Project structure

```
scripts/build_osm.py          OSM → compact JSON (projection, heights, coastline → land/sea)
public/data/*.json            the four areas (OSM-derived, ODbL)
src/engine/Engine.ts          renderer, post-processing, loading, loop, quality, adaptive resolution
src/engine/materials.ts       procedural textures + facade / ground / roof shaders (wet, snow, night)
src/engine/world/City.ts      builds roads, pavements, buildings, trees, lamps, benches from the data
src/engine/world/Collision.ts walkable ground + building collision (grid accelerated)
src/engine/systems/*          atmosphere (sky, sun, presets), player, pedestrians, traffic,
                              street lights, precipitation, audio
src/ui/*                      welcome screen, settings panel, joystick, icons
```

## Known limitations

- Facades are procedural, so they don't show the real details of each building.
- Roofs are flat, and the Opera House is a set of white blocks rather than its sloped marble planes.
- People are stylised figures unless GLB models are added.
- Trams are drawn as rails only.
- Distant parts of each area are clipped at the area boundary.
