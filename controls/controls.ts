// OPEN WATER — WASM control core (AssemblyScript, compiled to controls.wasm)
// Owns: scene parameter store (smoothed), the floating-camera rig,
// the sun model, and the auto-quality governor. JS owns WebGPU plumbing.
//
// Param ids (must match the JS PARAMS descriptor):
// 0 sunEl  1 sunAz  2 exposure  3 waveScale  4 foam  5 camH
// 6 drift  7 timeScale  8 grain  9 vignette  10 fov

const N: i32 = 11;
const PI: f64 = 3.141592653589793;

const cur = new StaticArray<f64>(N);
const tgt = new StaticArray<f64>(N);

// Swell table: the 5 biggest waves — dx, dz, k, amp, omega, phase (scale = 1).
// Precomputed with deep-water dispersion omega = sqrt(9.81 * k).
const SW = new StaticArray<f64>(30);
let swReady: bool = false;

function initSwell(): void {
  if (swReady) return;
  swReady = true;
  SW[0]=0.99027;  SW[1]=0.13918;  SW[2]=0.12083; SW[3]=0.802; SW[4]=1.08873; SW[5]=0.0;
  SW[6]=0.97815;  SW[7]=-0.20791; SW[8]=0.13368; SW[9]=0.718; SW[10]=1.14516; SW[11]=1.9;
  SW[12]=0.78801; SW[13]=0.61566; SW[14]=0.10832; SW[15]=0.667; SW[16]=1.03083; SW[17]=3.6;
  SW[18]=0.66913; SW[19]=-0.74314; SW[20]=0.22440; SW[21]=0.911; SW[22]=1.48369; SW[23]=1.7;
  SW[24]=0.30902; SW[25]=0.95106; SW[26]=0.25133; SW[27]=0.709; SW[28]=1.57021; SW[29]=4.2;
}

// ---- camera + sun state ----
let yaw: f64 = 0, pitch: f64 = 0, roll: f64 = 0;
let dragYawT: f64 = 0, dragPitchT: f64 = 0, dragYaw: f64 = 0, dragPitch: f64 = 0;
let camPX: f64 = 0, camPY: f64 = 3, camPZ: f64 = 0;
let camFX: f64 = 0, camFY: f64 = 0, camFZ: f64 = 1;
let camRX: f64 = 1, camRY: f64 = 0, camRZ: f64 = 0;
let camUX: f64 = 0, camUY: f64 = 1, camUZ: f64 = 0;
let sunDX: f64 = 0, sunDY: f64 = 1, sunDZ: f64 = 0;
let sunCR: f64 = 1, sunCG: f64 = 0.82, sunCB: f64 = 0.62;
let started: bool = false;
let emaMs: f64 = -1;
// camera mode: 0 = waterline, 1 = elevated (30 m), 2 = high (75 m)
let modeTgt: f64 = 0;
let modeCur: f64 = 0;

export function setCamMode(m: i32): void {
  modeTgt = m < 0 ? 0 : (m > 2 ? 2 : <f64>m);
}
export function getCamMode(): f32 { return <f32>modeCur; }

function clampf(v: f64, lo: f64, hi: f64): f64 {
  return v < lo ? lo : (v > hi ? hi : v);
}

function swell(x: f64, z: f64, t: f64): f64 {
  const s: f64 = cur[3] <= 0.001 ? 1.0 : cur[3];
  let h: f64 = 0.0;
  for (let i: i32 = 0; i < 5; i++) {
    const b: i32 = i * 6;
    // sea-state evolution (must match the WGSL wander exactly): amplitudes
    // breathe and phases drift on incommensurate periods — never repeats
    const wob: f64 = <f64>i + 1.0;
    const ampW: f64 = 1.0 + 0.30 * Math.sin(t * 0.023 * wob + <f64>i * 2.39)
                                * Math.sin(t * 0.011 * (wob + 1.0) + <f64>i * 1.71);
    const k: f64 = SW[b + 2] / s;
    const amp: f64 = SW[b + 3] * s * ampW;
    const om: f64 = Math.sqrt(9.81 * k);
    const f: f64 = k * (SW[b] * x + SW[b + 1] * z) - om * t + SW[b + 5]
                 + 0.9 * Math.sin(t * 0.019 * wob + <f64>i * 4.13);
    h += amp * Math.sin(f);
  }
  return h;
}

// ---- public API ----
export function setParam(id: i32, v: f64): void {
  initSwell();
  if (id >= 0 && id < N) tgt[id] = v;
}

export function getParam(id: i32): f32 {
  if (id < 0 || id >= N) return 0;
  return <f32>cur[id];
}

export function getParamTarget(id: i32): f32 {
  if (id < 0 || id >= N) return 0;
  return <f32>tgt[id];
}

export function addDrag(dx: f64, dy: f64): void {
  dragYawT -= dx * 0.0028;
  dragPitchT = clampf(dragPitchT - dy * 0.0028, -0.55, 0.55);
}

export function resetView(): void {
  dragYawT = 0; dragPitchT = 0; dragYaw = 0; dragPitch = 0;
}

export function tick(dt: f64, t: f64, yawOvr: f64, pitchOvr: f64): void {
  initSwell();
  if (!started) {
    for (let i: i32 = 0; i < N; i++) cur[i] = tgt[i];
    started = true;
  } else if (dt > 0) {
    const k: f64 = dt * 7.0 < 1.0 ? dt * 7.0 : 1.0;   // param glide
    for (let i: i32 = 0; i < N; i++) cur[i] += (tgt[i] - cur[i]) * k;
  }

  const el: f64 = cur[0] * PI / 180.0;
  const az: f64 = cur[1] * PI / 180.0;
  const ce: f64 = Math.cos(el);
  sunDX = ce * Math.cos(az); sunDY = Math.sin(el); sunDZ = ce * Math.sin(az);

  // sun color temperature follows elevation: deep orange -> warm white
  const w: f64 = clampf(el / 1.0472, 0.0, 1.0);
  sunCR = 1.0;
  sunCG = clampf(0.60 + 0.94 * w, 0.0, 1.0);
  sunCB = clampf(0.36 + 1.12 * w, 0.0, 1.0);

  // camera mode glide: 0 waterline -> 1 elevated (30 m) -> 2 high (75 m)
  modeCur += (modeTgt - modeCur) * (dt <= 0 ? 1.0 : (dt * 1.6 < 1.0 ? dt * 1.6 : 1.0));
  const airB: f64 = modeCur < 1.0 ? modeCur : 1.0;   // 0 = riding the swell, 1 = airborne
  let hEff: f64;
  if (modeCur <= 1.0) hEff = cur[5] * (1.0 - modeCur) + 30.0 * modeCur;
  else hEff = 30.0 * (2.0 - modeCur) + 75.0 * (modeCur - 1.0);

  const drift: f64 = cur[6] * (1.0 + 1.6 * airB);
  const cx: f64 = Math.cos(az) * t * drift;
  const cz: f64 = Math.sin(az) * t * drift + 4.0 * Math.sin(t * 0.045);
  const h: f64 = swell(cx, cz, t);

  const yawBase: f64 = yawOvr != yawOvr ? az + Math.sin(t * 0.03) * 0.22 : yawOvr;
  const yawT: f64 = yawBase + dragYaw;
  const kd: f64 = dt * 10.0 < 1.0 ? dt * 10.0 : 1.0;
  dragYaw += (dragYawT - dragYaw) * kd;
  dragPitch += (dragPitchT - dragPitch) * kd;
  const ky: f64 = dt <= 0 ? 1.0 : (dt * 2.5 < 1.0 ? dt * 2.5 : 1.0);
  yaw += (yawT - yaw) * ky;

  const fx: f64 = Math.cos(yaw), fz: f64 = Math.sin(yaw);
  const hF: f64 = swell(cx + fx * 2.5, cz + fz * 2.5, t);
  const hB: f64 = swell(cx - fx * 2.5, cz - fz * 2.5, t);
  const hR: f64 = swell(cx - fz * 2.5, cz + fx * 2.5, t);
  const hL: f64 = swell(cx + fz * 2.5, cz - fx * 2.5, t);
  const autoPitch: f64 = clampf(Math.atan2(hF - hB, 5.0) * 0.55, -0.14, 0.14);
  const autoRoll: f64 = clampf(Math.atan2(hR - hL, 5.0) * 0.25, -0.04, 0.04);
  // airborne: look down at the water instead of riding the slope
  const pitchAir: f64 = modeCur <= 1.0 ? -0.45 * modeCur : -0.45 - 0.57 * (modeCur - 1.0);
  const pitchBase: f64 = autoPitch * (1.0 - airB) + pitchAir;
  const pitchT: f64 = (pitchOvr != pitchOvr ? pitchBase : pitchOvr) + dragPitch;
  pitch += (pitchT - pitch) * ky;
  roll += (autoRoll * (1.0 - airB) - roll) * ky;

  const cp: f64 = Math.cos(pitch), sp: f64 = Math.sin(pitch);
  const cy: f64 = Math.cos(yaw), sy: f64 = Math.sin(yaw);
  camFX = cp * cy; camFY = sp; camFZ = cp * sy;
  const r0x: f64 = -sy, r0y: f64 = 0, r0z: f64 = cy;
  // up0 = r0 x fwd
  const u0x: f64 = r0y * camFZ - r0z * camFY;
  const u0y: f64 = r0z * camFX - r0x * camFZ;
  const u0z: f64 = r0x * camFY - r0y * camFX;
  const cr: f64 = Math.cos(roll), sr: f64 = Math.sin(roll);
  camRX = r0x * cr + u0x * sr; camRY = r0y * cr + u0y * sr; camRZ = r0z * cr + u0z * sr;
  camUX = u0x * cr - r0x * sr; camUY = u0y * cr - r0y * sr; camUZ = u0z * cr - r0z * sr;

  camPX = cx; camPY = h * 0.55 * (1.0 - airB) + hEff; camPZ = cz;
}

// Auto-quality governor: feed measured frame ms, returns suggested render
// scale (0.6 / 0.75 / 1.0) or -1 for "no change".
export function pushFrame(ms: f64): f32 {
  if (emaMs < 0) emaMs = ms; else emaMs = emaMs * 0.95 + ms * 0.05;
  if (emaMs > 30.0) return 0.6;
  if (emaMs > 22.0) return 0.75;
  if (emaMs < 13.0) return 1.0;
  return -1.0;
}

// ---- getters ----
export function camPosX(): f32 { return <f32>camPX; }
export function camPosY(): f32 { return <f32>camPY; }
export function camPosZ(): f32 { return <f32>camPZ; }
export function camFwdX(): f32 { return <f32>camFX; }
export function camFwdY(): f32 { return <f32>camFY; }
export function camFwdZ(): f32 { return <f32>camFZ; }
export function camRightX(): f32 { return <f32>camRX; }
export function camRightY(): f32 { return <f32>camRY; }
export function camRightZ(): f32 { return <f32>camRZ; }
export function camUpX(): f32 { return <f32>camUX; }
export function camUpY(): f32 { return <f32>camUY; }
export function camUpZ(): f32 { return <f32>camUZ; }
export function sunDirX(): f32 { return <f32>sunDX; }
export function sunDirY(): f32 { return <f32>sunDY; }
export function sunDirZ(): f32 { return <f32>sunDZ; }
export function sunColR(): f32 { return <f32>sunCR; }
export function sunColG(): f32 { return <f32>sunCG; }
export function sunColB(): f32 { return <f32>sunCB; }
