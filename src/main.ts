import './style.css';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildModel } from './scene/model';
import { CameraPath } from './scene/path';
import { STOP_NAMES, loadPath } from './scene/stops';
import { Timeline } from './scene/timeline';
import { initDebug, type Mode } from './debug';
import { initHero } from './hero';
import { createInkRenderer } from './look';
import { initContent } from './content';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

const DEBUG = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
// Reduced motion: no camera movement; each stop becomes a still of its view with its copy, stacked.
// `?reduced` forces it, for previewing without changing system settings.
const REDUCED =
  matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('reduced');
// Phones and tablets: pixel ratio capped at 1.5 to keep the ink passes light.
const isMobile = () => innerWidth < 768 || matchMedia('(pointer: coarse)').matches;

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const track = document.querySelector<HTMLElement>('#track')!;
const hud = document.querySelector<HTMLElement>('#hud')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

const scene = new THREE.Scene();
scene.background = new THREE.Color('#E7ECF0');
// Mostly ambient, so faces only shift by a light wash: lit sides ~paper, shaded sides a little greyer.
// (Lambert divides light by π, so ambient π·0.8 leaves shaded faces at 80% of their fill colour.)
scene.add(new THREE.AmbientLight('#ffffff', Math.PI * 0.8));
const sun = new THREE.DirectionalLight('#fffaf2', Math.PI * 0.28);
sun.position.set(-30, 50, 40);
scene.add(sun);

// Near plane kept off 0.1 for depth precision (the ink pass reads depth); nothing comes closer than ~1m.
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 600);

const model = buildModel();
scene.add(model.root);
const ink = createInkRenderer(renderer, scene, camera, model.root);

const points = loadPath();
const path = new CameraPath(points);
const timeline = new Timeline();
timeline.pace(path.lengths);

// Scroll → position in svh along the timeline, smoothed in the render loop.
track.style.height = `${timeline.total}svh`;
const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
let targetS = (scrollY / Math.max(maxScroll(), 1)) * timeline.total;
let currentS = targetS;
ScrollTrigger.create({
  trigger: track,
  start: 'top top',
  end: 'bottom bottom',
  onUpdate: (self) => (targetS = self.progress * timeline.total),
});

function scrollToS(s: number) {
  gsap.to(window, { duration: 1.4, ease: 'power2.inOut', scrollTo: (s / timeline.total) * maxScroll() });
}

// Debug free-fly camera. Only attached to the canvas while in free mode: attached, it sets
// `touch-action: none` on the canvas, which stops touch scrolling on phones once the 3D is showing.
const controls = new OrbitControls(camera);
controls.enableDamping = true;
let mode: Mode = 'scroll';

function setMode(next: Mode) {
  mode = next;
  if (next === 'free') {
    controls.connect(canvas);
    controls.target.copy(camera.getWorldDirection(lookAt).multiplyScalar(15).add(camera.position));
  } else {
    controls.disconnect();
    canvas.style.touchAction = '';
  }
}

const debug = DEBUG
  ? initDebug({ points, path, timeline, scene, camera, controls, triangles: model.triangles, scrollToS, setMode })
  : null;
hud.hidden = !DEBUG;
// Console access for inspecting views while developing.
if (DEBUG) Object.assign(window, { fly: { camera, controls, setMode, timeline, path } });

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 1.5 : 2));
  renderer.setSize(w, h, false);
  ink.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h;
  // Portrait screens get a wider view so each stop's focal point stays in frame (50° on landscape,
  // up to ~72° on a tall phone).
  camera.fov = camera.aspect < 1 ? 50 + (1 - camera.aspect) * 40 : 50;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const hero = initHero();
const content = initContent(timeline, scrollToS, REDUCED);
const lookAt = new THREE.Vector3();
let last = performance.now();
let hudText = '';

/** Reduced motion: render each 3D stop's view once into a still behind its copy; no animation loop. */
function buildStills() {
  document.body.classList.add('reduced');
  const panels = [...document.querySelectorAll<HTMLElement>('.panel')];
  const still = (panel: HTMLElement, src: string) => {
    const img = document.createElement('img');
    img.className = 'panel__still';
    img.alt = '';
    img.src = src;
    panel.prepend(img);
  };
  still(panels[0], `${import.meta.env.BASE_URL}hero-tower.webp`);
  for (let i = 1; i < panels.length; i++) {
    path.sample(i, camera.position, camera.quaternion);
    ink.render();
    still(panels[i], canvas.toDataURL('image/jpeg', 0.9));
  }
}

if (REDUCED) buildStills();
else renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  currentS += (targetS - currentS) * (1 - Math.exp(-dt * 6));

  const stopValue = timeline.stopAt(currentS);
  if (mode === 'scroll') {
    path.sample(stopValue, camera.position, camera.quaternion);
  } else {
    controls.update();
  }
  // The free camera always looks at the 3D scene, so the photo steps aside.
  const photoCovers = hero.update(mode === 'scroll' ? currentS : Infinity);
  content.update(currentS);

  if (DEBUG) {
    const current = timeline.rangeAt(currentS);
    const text = `${currentS.toFixed(0)} / ${timeline.total}svh · ${current + 1}. ${STOP_NAMES[current]} · path ${stopValue.toFixed(2)}`;
    if (text !== hudText) {
      hud.textContent = `${text}\n${mode} camera · ${model.triangles.toLocaleString()} tris`;
      debug?.update(text);
      hudText = text;
    }
  }

  if (!photoCovers) ink.render();
});
