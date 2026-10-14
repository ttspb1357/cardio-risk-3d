// Anatomical 3D heart (BodyParts3D) with the three coronary arteries coloured by predicted stenosis risk.
// The model (public/models/heart.glb) is built by tools/anatomy/build_heart.py: one node per structure, baked
// ambient occlusion in the vertex colours, and on the heart wall two custom attributes:
//   _territory  vec3  soft weights of the supplying artery (LAD, LCX, RCA), zero on the atria
//   _segment    float AHA 17-segment id / 32 (18 = RV free wall, 0 = atria)
// Anatomy: BodyParts3D, (c) The Database Center for Life Science, CC Attribution-Share Alike 2.1 Japan.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { pct, riskColor } from "../lib/format";
import type { Vessel } from "../types";

export type ViewName = "front" | "left" | "back" | "below" | Vessel;
export type TerritoryMode = "auto" | "all";

export interface HeartApi {
  setRisks(risks: Partial<Record<Vessel, number>>): void;
  select(name: Vessel | null): void;
  resetView(): void;
  setBeating(on: boolean): void;
  setAutoRotate(on: boolean): void;
  /** Fly the camera to a named view (smooth orbit). */
  flyTo(view: ViewName, seconds?: number): void;
  /** "auto": only the selected artery's territory is tinted; "all": every territory is tinted. */
  setTerritoryMode(mode: TerritoryMode): void;
  /** Pulse one AHA segment (1-18) on the heart, or none. */
  highlightSegment(id: number | null): void;
  setXray(on: boolean): void;
  dispose(): void;
}

export interface HeartOptions {
  onSelect?: (name: Vessel | null) => void;
  onHover?: (name: Vessel | null, x: number, y: number) => void;
  onLoad?: () => void;
  onError?: (error: unknown) => void;
  /** The user dragged or zoomed (used to stop the guided tour). */
  onUserInteract?: () => void;
}

const MODEL_URL = "/models/heart.glb";
const NAMES: Vessel[] = ["LAD", "LCX", "RCA"];
const NEUTRAL = "#64748b";

// Tissue tints for non-coronary structures (glossy red great arteries, dark venous blood). Only LAD / LCX / RCA carry
// the green-amber-red risk scale; they also glow, which keeps them distinct from the red tissue.
const ANATOMY: Record<string, { color: string; roughness: number }> = {
  aorta: { color: "#e0726a", roughness: 0.34 },
  pulmonary_artery: { color: "#d06a74", roughness: 0.36 },
  pulmonary_veins: { color: "#8e4b58", roughness: 0.42 },
  superior_vena_cava: { color: "#5e4a78", roughness: 0.42 },
  inferior_vena_cava: { color: "#5e4a78", roughness: 0.42 },
  cardiac_veins: { color: "#553f6e", roughness: 0.38 },
  left_main: { color: "#b9b2b8", roughness: 0.35 },
};
// Where each artery's label sits: within a band of the artery's height (0 = lowest, 1 = highest), the vertex that
// maximises anterior position (+ a sideways preference). Mid-LAD; proximal LCX; proximal RCA in the right
// atrioventricular groove (towards the patient's right, i.e. negative x) rather than on a branch crossing the RV.
const LABEL_RULE: Record<Vessel, { band: [number, number]; sideways: number }> = {
  LAD: { band: [0.3, 0.7], sideways: 0 },
  LCX: { band: [0.6, 1], sideways: 0 },
  RCA: { band: [0.45, 1], sideways: -1.2 },
};

const LOOK = new THREE.Vector3(0, 0.35, 0);
// Camera positions for the named views (the camera always looks at LOOK). Artery views are chosen so the artery
// faces the viewer: LAD from the front-left, LCX from the left-back, RCA from the front-right.
const VIEWS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0.8, 1.2, 7.3),
  left: new THREE.Vector3(7.1, 1.4, 1.3),
  back: new THREE.Vector3(-0.8, 1.5, -7.3),
  below: new THREE.Vector3(1.2, -5.4, 4.9),
  LAD: new THREE.Vector3(3.2, 1.3, 6.4),
  LCX: new THREE.Vector3(7.0, 1.0, -3.6),
  RCA: new THREE.Vector3(-5.4, 0.8, 4.9),
};

/** Convert quantized (meshopt) attributes to floats and bake the node transform, so all geometry is in scene units. */
function bake(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color", "_territory", "_segment"]) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    // getComponent() already de-normalizes quantized (normalized integer) data.
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) out.setIndex(src.index.clone());
  mesh.updateWorldMatrix(true, false);
  out.applyMatrix4(mesh.matrixWorld);
  out.computeBoundingSphere();
  return out;
}

/** Copy of a geometry pushed outwards along its normals (the glow shell, also a larger click target). */
function inflate(geometry: THREE.BufferGeometry, distance: number): THREE.BufferGeometry {
  const g = geometry.clone();
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * distance, p.getY(i) + n.getY(i) * distance, p.getZ(i) + n.getZ(i) * distance);
  }
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(NEUTRAL) }, intensity: { value: 0.16 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float intensity;
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        gl_FragColor = vec4(color * intensity * (0.35 + rim), (0.2 + rim) * intensity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------- heart-wall shader
// Extends MeshPhysicalMaterial with: territory tint (risk colour of the supplying artery), a pulsing AHA segment
// highlight, fine procedural tissue relief (bump + roughness variation; the clearcoat stays smooth like a wet
// epicardium) and a faint red translucent rim (living-tissue look).
const WALL_UNIFORMS = {
  uTColor: { value: [new THREE.Color(NEUTRAL), new THREE.Color(NEUTRAL), new THREE.Color(NEUTRAL)] },
  uTAmount: { value: new THREE.Vector3() },
  uSegment: { value: -1 },
  uTime: { value: 0 },
  uMicro: { value: 1 },
};

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float tissue(vec3 p) {  // fine fibrous relief: stretched noise (fibres) + two finer octaves
    vec3 q = p * vec3(22.0, 44.0, 22.0);
    return 0.55 * vnoise(q) + 0.3 * vnoise(q * 2.07 + 7.1) + 0.15 * vnoise(q * 4.13 + 3.7);
  }
  vec3 bumpNormal(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
    vec3 sx = normalize(dFdx(surfPos)); vec3 sy = normalize(dFdy(surfPos));
    vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);
    float det = dot(sx, r1) * faceDir;
    vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
    return normalize(abs(det) * surfNorm - grad);
  }`;

function wallMaterial(): THREE.MeshPhysicalMaterial {
  // Double-sided: the model keeps only the outer surface (inner chamber walls are removed at build time), so a
  // small natural opening would otherwise show straight through the heart to the background.
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true, color: new THREE.Color("#ff8f88"), roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.16,
    sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color("#ff9aa8"), side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WALL_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec3 _territory; attribute float _segment;
        varying vec3 vTerritory; flat varying float vSegment; varying vec3 vObjPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vTerritory = _territory; vSegment = floor(_segment * 32.0 + 0.5); vObjPos = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform vec3 uTColor[3]; uniform vec3 uTAmount; uniform float uSegment; uniform float uTime; uniform float uMicro;
        varying vec3 vTerritory; flat varying float vSegment; varying vec3 vObjPos;
        ${NOISE_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 tw = vTerritory * uTAmount;
        float ts = tw.x + tw.y + tw.z;
        vec3 tColor = ts > 1e-4 ? (uTColor[0] * tw.x + uTColor[1] * tw.y + uTColor[2] * tw.z) / ts : vec3(0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, tColor, clamp(ts, 0.0, 0.78));
        // Thin dark borders where one territory hands over to the next (weights are soft there), so territories
        // stay distinguishable even when their arteries have similar risk colours.
        float wsum = vTerritory.x + vTerritory.y + vTerritory.z;
        float dominance = wsum > 1e-3 ? max(max(vTerritory.x, vTerritory.y), vTerritory.z) / wsum : 1.0;
        float border = (1.0 - smoothstep(0.52, 0.68, dominance)) * step(0.3, wsum);
        diffuseColor.rgb *= 1.0 - 0.72 * border * clamp(max(max(uTAmount.x, uTAmount.y), uTAmount.z) * 1.6, 0.0, 1.0);
        // The highlighted AHA segment glows in the risk colour of its own supplying artery.
        float segHit = (uSegment > 0.5 && abs(vSegment - uSegment) < 0.5) ? 1.0 : 0.0;
        vec3 segColor = (vTerritory.x >= vTerritory.y && vTerritory.x >= vTerritory.z) ? uTColor[0]
          : (vTerritory.y >= vTerritory.z ? uTColor[1] : uTColor[2]);
        diffuseColor.rgb = mix(diffuseColor.rgb, segColor, 0.6 * segHit);
        float relief = tissue(vObjPos);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (relief - 0.5) * 0.22 * uMicro, 0.22, 1.0);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec2 dH = vec2(dFdx(relief), dFdy(relief)) * 0.018 * uMicro;
        normal = bumpNormal(-vViewPosition, normal, dH, faceDirection);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += tColor * clamp(ts, 0.0, 1.0) * 0.16;
        float pulse = 0.55 + 0.45 * sin(uTime * 5.0);
        totalEmissiveRadiance += segColor * segHit * (0.3 + 0.35 * pulse);
        float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += vec3(0.42, 0.05, 0.06) * rim * 0.35;`);
  };
  return m;
}

interface VesselState {
  core: THREE.MeshPhysicalMaterial;
  glow: THREE.ShaderMaterial;
  target: THREE.Color;
  anchor: THREE.Vector3;
  label: HTMLDivElement;
  value: HTMLSpanElement;
}

/** A label spot on an artery that faces the viewer (see LABEL_RULE). */
function anchorOf(geometry: THREE.BufferGeometry, { band: [from, to], sideways }: { band: [number, number]; sideways: number }): THREE.Vector3 {
  const p = geometry.getAttribute("position") as THREE.BufferAttribute;
  const ys = Array.from({ length: p.count }, (_, i) => p.getY(i)).sort((a, b) => a - b);
  const lo = ys[Math.floor((ys.length - 1) * from)], hi = ys[Math.floor((ys.length - 1) * to)];
  let best = new THREE.Vector3();
  let bestScore = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < lo || y > hi) continue;
    const score = p.getZ(i) + sideways * p.getX(i);
    if (score > bestScore) { bestScore = score; best = new THREE.Vector3(p.getX(i), y, p.getZ(i)); }
  }
  return best;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function createHeart(container: HTMLElement, { onSelect, onHover, onLoad, onError, onUserInteract }: HeartOptions = {}): HeartApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const canvas = renderer.domElement;
  canvas.className = "stage-gl";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  camera.position.copy(VIEWS.front);

  scene.add(new THREE.HemisphereLight("#b9d8ff", "#2a0a12", 0.55));
  const key = new THREE.DirectionalLight("#fff4ec", 2.2);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight("#7f9dff", 1.4);
  rim.position.set(-4, 2, -4);
  const fill = new THREE.DirectionalLight("#ffb4c0", 0.6);
  fill.position.set(-3, -1.5, 3);
  const back = new THREE.DirectionalLight("#ffd9c9", 0.9); // keeps the posterior surface readable when rotated
  back.position.set(1.5, 2.5, -5);
  const under = new THREE.DirectionalLight("#ffe2d6", 0.7); // lights the inferior surface for the "below" view
  under.position.set(0.5, -5, 2);
  scene.add(key, rim, fill, back, under);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 3;
  controls.maxDistance = 14;
  controls.target.copy(LOOK);

  const heart = new THREE.Group();
  scene.add(heart);

  const vessels = {} as Record<Vessel, VesselState>;
  const hitTargets: THREE.Mesh[] = [];
  const tissueMaterials: THREE.MeshPhysicalMaterial[] = []; // everything that fades in X-ray mode
  let wall: THREE.Mesh | null = null;
  for (const name of NAMES) {
    const label = document.createElement("div");
    label.className = "hud-label";
    label.style.opacity = "0";
    const dot = document.createElement("i");
    const code = document.createElement("b");
    code.textContent = name;
    const value = document.createElement("span");
    value.textContent = "–";
    label.append(dot, code, value);
    // The hotspot is clickable and hoverable like the artery itself.
    label.addEventListener("click", () => { api.select(name === selected ? null : name); onSelect?.(selected); });
    label.addEventListener("pointerenter", (e) => { hovered = name; onHover?.(name, e.clientX, e.clientY); });
    label.addEventListener("pointerleave", () => { hovered = null; onHover?.(null, 0, 0); });
    container.appendChild(label);
    vessels[name] = {
      core: new THREE.MeshPhysicalMaterial({
        vertexColors: true, color: NEUTRAL, emissive: NEUTRAL, emissiveIntensity: 0.3, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2,
      }),
      glow: glowMaterial(),
      target: new THREE.Color(NEUTRAL),
      anchor: new THREE.Vector3(),
      label,
      value,
    };
  }

  let disposed = false;
  let loaded = false;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(MODEL_URL, (gltf) => {
    if (disposed) return;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      const geometry = bake(src);
      const name = src.name || src.parent?.name || "";
      if (name === "heart_wall") {
        const material = wallMaterial();
        tissueMaterials.push(material);
        wall = new THREE.Mesh(geometry, material);
        heart.add(wall);
      } else if ((NAMES as string[]).includes(name)) {
        const v = vessels[name as Vessel];
        const core = new THREE.Mesh(geometry, v.core);
        core.renderOrder = 2;
        const shell = new THREE.Mesh(inflate(geometry, 0.022), v.glow);
        shell.userData.vessel = name;
        shell.renderOrder = 3;
        heart.add(core, shell);
        hitTargets.push(shell);
        v.anchor = anchorOf(geometry, LABEL_RULE[name as Vessel]);
        v.anchor.addScaledVector(v.anchor.clone().setY(0).normalize(), 0.12);
      } else if (ANATOMY[name]) {
        const a = ANATOMY[name];
        // Vertex colours carry baked ambient occlusion; the build seals every vessel cut, so one side is enough.
        const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: a.color, roughness: a.roughness, clearcoat: 0.3, clearcoatRoughness: 0.4 });
        tissueMaterials.push(material);
        heart.add(new THREE.Mesh(geometry, material));
      }
    });
    loaded = true;
    for (const n of NAMES) vessels[n].label.style.opacity = "1";
    onLoad?.();
  }, undefined, (err) => {
    console.error(err);
    onError?.(err);
  });

  let hovered: Vessel | null = null;
  let selected: Vessel | null = null;
  let beating = true;
  let territoryMode: TerritoryMode = "auto";
  let segment = -1;
  let xray = 0; // animated 0..1
  let xrayTarget = 0;
  const focus = LOOK.clone();

  // Camera flight: orbit around LOOK from the current position to the target view.
  let flight: { from: THREE.Spherical; to: THREE.Spherical; start: number; seconds: number } | null = null;
  controls.addEventListener("start", () => {
    flight = null;
    onUserInteract?.();
  });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (e: PointerEvent): Vessel | null => {
    if (!loaded) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // In X-ray mode the wall no longer hides arteries behind it.
    const targets = wall && xrayTarget === 0 ? [...hitTargets, wall] : hitTargets;
    const hit = ray.intersectObjects(targets, false)[0];
    return hit?.object.userData.vessel ?? null;
  };

  let down: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
      const name = pick(e);
      api.select(name === selected ? null : name);
      onSelect?.(selected);
    }
    down = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    hovered = pick(e);
    canvas.style.cursor = hovered ? "pointer" : "grab";
    onHover?.(hovered, e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => { hovered = null; onHover?.(null, 0, 0); });

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole heart in view on narrow (portrait) stages.
    camera.fov = w / h < 0.9 ? 42 : 32;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const timer = new THREE.Timer();
  const tmp = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const amount = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let raf = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    timer.update(now);
    // Clamp both ways: the first frame's timestamp can predate the timer's creation (a negative step, measured at
    // -0.74 s on a slow machine), which would make the exponential easing below overshoot wildly.
    const dt = THREE.MathUtils.clamp(timer.getDelta(), 0, 0.05);
    if (!container.clientWidth) return; // hidden (other page): skip rendering
    const t = timer.getElapsed();
    heart.scale.setScalar(beating ? 1 + 0.014 * Math.max(0, Math.sin(t * 2 * Math.PI * 1.1)) ** 2 : 1);

    if (flight) {
      const k = THREE.MathUtils.clamp((now - flight.start) / (flight.seconds * 1000), 0, 1);
      const e = easeInOut(k);
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(flight.from.radius, flight.to.radius, e),
        THREE.MathUtils.lerp(flight.from.phi, flight.to.phi, e),
        flight.from.theta + (flight.to.theta - flight.from.theta) * e,
      );
      camera.position.copy(offset.setFromSpherical(s).add(controls.target));
      if (k >= 1) flight = null;
    }
    // Frame-rate independent easing factors, so fades take the same time on slow and fast machines.
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    controls.target.lerp(focus, ease(5));
    controls.update();

    // Territory tint amounts (animated): the selected artery's territory, or all of them.
    const want = NAMES.map((n) => (territoryMode === "all" ? 0.62 : n === selected ? 0.55 : 0));
    amount.lerp(tmp.set(want[0], want[1], want[2]), ease(7));
    WALL_UNIFORMS.uTAmount.value.copy(amount);
    WALL_UNIFORMS.uSegment.value = segment;
    WALL_UNIFORMS.uTime.value = t;

    xray += (xrayTarget - xray) * ease(8);
    for (const m of tissueMaterials) {
      m.opacity = 1 - 0.82 * xray;
      const transparent = xray > 0.01;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.depthWrite = !transparent;
        m.needsUpdate = true;
      }
    }

    toCam.copy(camera.position).sub(controls.target);
    for (const [i, name] of NAMES.entries()) {
      const v = vessels[name];
      v.core.color.lerp(v.target, ease(8));
      v.core.emissive.copy(v.core.color);
      WALL_UNIFORMS.uTColor.value[i].copy(v.core.color);
      const isSel = name === selected;
      v.core.emissiveIntensity = isSel ? 0.75 : name === hovered ? 0.6 : 0.22;
      (v.glow.uniforms.color.value as THREE.Color).copy(v.core.color);
      const glow = selected ? (isSel ? 0.8 + 0.28 * Math.sin(t * 5) : 0.05) : name === hovered ? 0.65 : 0.11 + 0.28 * xray;
      v.glow.uniforms.intensity.value += (glow - v.glow.uniforms.intensity.value) * ease(9);
      if (!loaded) continue;

      tmp.copy(v.anchor).applyMatrix4(heart.matrixWorld);
      const facing = xray > 0.5 || tmp.clone().sub(controls.target).dot(toCam) > -0.3;
      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * container.clientWidth;
      const y = (-tmp.y * 0.5 + 0.5) * container.clientHeight;
      // The dot (12px into the label) sits on the anchor; the label text runs to its right.
      v.label.style.transform = `translate(-12px, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      v.label.style.opacity = tmp.z > 1 ? "0" : facing ? "1" : "0.35";
      v.label.classList.toggle("is-selected", isSel);
      v.label.classList.toggle("is-hovered", name === hovered);
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  const api: HeartApi = {
    setRisks(risks) {
      for (const name of NAMES) {
        const p = risks[name];
        if (p === undefined) continue;
        const c = riskColor(p);
        vessels[name].target = new THREE.Color(c);
        vessels[name].value.textContent = pct(p);
        vessels[name].label.style.setProperty("--c", c);
      }
    },
    select(name) {
      selected = name;
      focus.copy(name ? vessels[name].anchor.clone().multiplyScalar(0.45).add(new THREE.Vector3(0, 0.3, 0)) : LOOK);
    },
    resetView() {
      selected = null;
      segment = -1;
      focus.copy(LOOK);
      api.flyTo("front", 0.9);
      onSelect?.(null);
    },
    setBeating(on) { beating = on; },
    setAutoRotate(on) {
      controls.autoRotate = on;
      controls.autoRotateSpeed = 1.1;
    },
    flyTo(view, seconds = 1.4) {
      const from = new THREE.Spherical().setFromVector3(offset.copy(camera.position).sub(controls.target));
      const to = new THREE.Spherical().setFromVector3(offset.copy(VIEWS[view]).sub(LOOK));
      // Take the short way round.
      let dTheta = to.theta - from.theta;
      if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
      to.theta = from.theta + dTheta;
      flight = { from, to, start: performance.now(), seconds };
    },
    setTerritoryMode(mode) { territoryMode = mode; },
    highlightSegment(id) { segment = id ?? -1; },
    setXray(on) { xrayTarget = on ? 1 : 0; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => { (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose(); });
      });
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.remove();
      NAMES.forEach((n) => vessels[n].label.remove());
    },
  };
  return api;
}
