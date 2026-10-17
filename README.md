# webgpu-ocean

A photorealistic infinite ocean rendered in **raw WebGPU** — no engines, no libraries, one self-contained HTML file. Double-click `ocean.html` and it just runs.

![ocean](https://img.shields.io/badge/WebGPU-raw%20WGSL-blue) ![wasm](https://img.shields.io/badge/controls-AssemblyScript%20WASM-purple)

## What it is

- **Raymarched heightfield ocean** — 13 directional deep-water waves (dispersion ω=√(9.81k)), crest sharpening, wave-group modulation, analytic far-field blend to the horizon
- **Physical sky** — Rayleigh + Mie single scattering, sun disk with limb darkening
- **Water shading** — Fresnel sky reflection, sun glitter, subsurface scattering through wave flanks, crest-gated whitecap foam, ACES tone mapping, film grain + vignette
- **Floating camera** — drifts toward the sun, rides the swell, slope-driven pitch/roll; drag to look around
- **WASM controls** — a real AssemblyScript module (base64-embedded, ~7.7KB) owns the parameter store, camera rig, sun model and auto-quality governor

## Controls

| Input | Action |
|---|---|
| Drag | Look around |
| `Space` | Cycle camera: sea level → 30 m → 75 m (smooth glide, auto look-down) |
| `1` / `2` / `3` | Jump to sea / air / high camera directly |
| `P` | Pause |
| `H` | Toggle control panel |
| ☰ panel | 11 sliders (sun, sea, camera, look) + Midday / Golden hour / Storm presets |

## URL params

`?t=` freeze time · `?dyaw=` / `?dpitch=` fixed look offset · `?w=&h=&dpr=` canvas size · `?readback=1` offscreen capture (for headless) · `?dbg=` debug views · `?nospray`

## Rebuilding the WASM controls

The module source is `controls/controls.ts`. The compiled binary is embedded in `ocean.html`, but you can rebuild it:

```bash
cd controls
npx asc controls.ts --outFile controls.wasm --optimize --runtime stub
# then base64 it into ocean.html's WASM_B64 constant
```

Exports: `setParam`/`getParam`/`getParamTarget` (11 params: sunEl, sunAz, exposure, waveScale, foam, camH, drift, timeScale, grain, vignette, fov), `addDrag`, `resetView`, `setCamMode`, `tick`, `pushFrame`, camera/sun getters. `window.__wasm` is exposed for debugging.

## Notes

- Requires a WebGPU-capable browser (Chrome/Edge 113+). `file://` works — it's a secure context.
- `NOTES.md` has the headless SwiftShader test recipe and the critique-round log from development.

Built from scratch with Muse. The wave field slowly evolves on incommensurate cycles, so the sea never visibly repeats.

---

## 🏁 3D Boat Racer (`boat-racing-3d.html`)

A 3D buoy-slalom racing game built **on top of this ocean renderer** — same water, sky and sun, plus a drivable 3D speedboat.

- **Boat physics:** throttle/rudder, water drag, wave push and currents; the hull rides the exact rendered swell (CPU mirror of the shader's wave function), pitching and rolling over waves
- **Buoy gates:** ordered red/white gate pairs across 4 levels (Calm Bay → River Run → Open Sea → Storm), with a next-gate arrow, minimap, par times and 3-star ratings
- **Effects:** bow spray when slamming wave faces, wake trail, buoy collisions with splash and screen shake
- **Environment panel:** press `H` for live sliders (sun, waves, foam, exposure, FOV) — same controls as the ocean scene
- **Controls:** `WASD`/arrows to drive, `P` pause, `M` mute

Open `boat-racing-3d.html` in a WebGPU-capable browser (Chrome/Edge 113+) and race.
