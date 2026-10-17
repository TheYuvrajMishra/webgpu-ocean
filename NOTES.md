# ocean-webgpu — notes

## Headless WebGPU recipe (verified 2026-10-17)
- Browser binary: `/opt/meta-chromium/chrome`
- Playwright shim: `NODE_PATH=~/workspace/anim-env/node_modules` (provides `playwright` / `playwright-core`)
- Launch flags that work: `--headless=new --enable-unsafe-webgpu --use-angle=swiftshader --enable-webgpu`
- `headless: false` in playwright launch options + pass `--headless=new` manually via args
- Probe: `navigator.gpu.requestAdapter()` → adapter OK (SwiftShader), device OK, trivial compute shader returned 42 → real working WebGPU.
- file:// pages are a secure context — WebGPU available on double-click too.

## Screenshot harness
- `shot.js "<out.png>" "<query>" [waitFrames]` — viewport from `w`/`h` query params (default 1600x900), waits until `window.__frames >= waitFrames` (default 15), screenshots viewport to PNG.
- Query params on ocean.html: `t` (freeze water/sky time, seconds), `dyaw`/`dpitch` (rad, override look), `w`/`h`, `dpr`.
- Particles are pre-warmed (4 virtual seconds) at load so `t`-frozen shots still have spray.

## Round log
- R1: v1 built — 10-wave sharpened sine/Gerstner sum, analytic normals + 3 detail octaves, Rayleigh+Mie sky (8-step single scatter), foam crest mask + fbm breakup, 240 instanced spray particles, ACES + grain + vignette. Screenshots at t=4/9/14, yaw varied, 1600x900.
- R1 builder fixes (pre-critic): foam blanket -> crest-only; corduroy -> organic (noise-gradient detail normals, phase-wiggled short crests); 13 waves w/ directional swell clusters + cross-swell; wave groups + crest sharpening; brown horizon band -> multiple-scattering wash; sky striations -> 12 jittered steps; spray snow -> wispy.
- R1 critics (3/3): UNANIMOUS NO. Defects: (1) ordered-dither crosshatch over everything (IGN); (2) CR1A sun+glitter total blowout, solid white bar, tiny oval sun; (3) single-scale wavelet tiling, horizontal brightness banding rows; (4) horizon seams (dark stripe, stair-step, floating streaks); (5) foam absent, sparkle confetti mimics foam; (6) water too cyan; (7) spray reads as snow/smeared shafts.
- R2 fixes: PCG white-noise grain+dither (no structure); sunI 14->10, betaM 14e-6->10e-6, tight warm corona, warmer sun; glitter -> sparse discrete sparkles (pow6 noise gate) + faint sheen; big-5 swell x1.25, wind-sea x0.8, detail normals weaker, distance fade 0.6; real whitecaps (threshold 0.60/0.86); greener body color; spray subtler (wind-stretched, dimmer, close-fade); tMax 650, gentler march; murk wash smoothed; HUD hidden in readback captures.
- R2 note: jittered sky integration caused visible sky noise -> reverted to 16 fixed steps, grain 0.014.
- R2 critics (3/3): UNANIMOUS NO. (1) CR2B horizon seam = full-width white band w/ jagged stepped edge (tMax->flat fallback transition); (2) no swell/no foam/single-scale chop, "rippled bathtub"; (3) CR2A glitter fuses to white wash near horizon; (4) sky banding in pale strip + green-yellow tint; (5) sun disputed (one: decent disk, one: blown blob); (6) CR2C diagonal row-repetition/tiling; (7) hammered-metal at grazing.
- R3 fixes: horizon = distance-blended analytic far field (smoothstep 250->600m, no hit/miss seam); big-5 swell x1.15 more, mid waves restored x1.0, camera follows 55% of swell (reveals geometry); glitter far-fade (x0.45 by 400m); foam threshold 0.48/0.72 (whitecaps now visible); sky 20 steps + uniform murk-free wash + betaR x1.15 (deeper zenith).

## Round 4 (2026-10-17) — wave coherence restoration
Round-3 critics (unanimous NO): #1 defect = water reads as "single-scale noise, zero wave structure" (all 3 critics); sun = fuzzy blob no disk; horizon white stripe (CR3C) / dark seam (CR3B); terracing stripes; glitter = solid white blob; tilted horizon (~5° roll in CR3B); zero foam.

Root causes found:
- The per-wave phase wiggle (±2.2 rad) and amp modulation (0.05–1.0x) for i>=5 were destroying wave coherence → turned swells into noise. Reduced wiggle to ±0.7 rad, amp modulation to 0.65–1.0x.
- The old distance fade (exp(-(d-6)*k*0.6)) was killing big swells by 20m. Replaced with wavelength-relative fade: 1/(1+(k*d/700)^2) — fades only when undersampled.
- Crest normalization used theoretical MAXH (never occurs) → suppressed foam. Now crest = h/2.5m (realistic large crest).
- Camera roll was ±5.7° (visible tilt). Reduced to ±2.3°.
- Sun disk enlarged to 0.42° radius with crisp limb.
- Glitter: sparser gate (pow 10), tighter (pow 1400), less far wash.
- Far-field ripple strengthened (breaks mirror stripe).
- Wave amps scaled 1.45x for a more energetic sea.
R4A/B/C @1600x900 rendering; R4A shows clear rolling swell structure (huge improvement).

## Round 5 (2026-10-17) — cross-sea, discrete glitter, hard sun
Round-4 critics (unanimous NO): corduroy parallel waves ("sand dunes", all 3); glitter wrong (smear vs absent); sun disk weak/lumpy; foam absent; micro detail = noise; water murky teal-olive (2/3).

Fixes:
- Wave directions widened to true cross-sea: [8,-12,38,-48,72,-68,108,-28,58,-82,18,-52,96] deg (was all within 52deg).
- Sun limb hardened: smoothstep(0.9999728, 0.9999733, mu) — near-step edge.
- Glitter: sparser gate (pow 14), brighter (30x), slightly broader lobe (pow 1100) for a visible but discrete path.
- Foam threshold lowered to (0.22, 0.42) for visible whitecaps.
R5A/B/C @1600x900 rendering.

## Round 6 (2026-10-17) — final validation
Round-5 critics (unanimous NO): corduroy persists as #1; R5B white blob = spray particle sprite reading as "smoke puff" (worse than absence); sun weak; glitter smear; speckle noise.

Final fixes:
- Spray particles DISABLED (trySpawn returns early). The sprites hurt more than help.
- Wave amplitudes rebalanced: primary 52m swell 1.46→0.80m, cross-swells boosted (0.79→0.91, 0.57→0.71, 0.44→0.57, 0.26→0.37) so no single train dominates.
- Foam threshold raised (0.22,0.42)→(0.38,0.58) to kill huge blobs, keep tight crest caps.
R6A/B/C re-shot @1600x900 with all fixes.
