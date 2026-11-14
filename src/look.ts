import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

// Objects on this camera layer (ink lines, debug path helpers) show in the colour render but are left
// out of the depth render used to find silhouettes.
export const NO_INK_LAYER = 1;

const INK = '#1d1d1b';
/** Line weight in CSS px, for both crease lines and silhouettes. */
const LINE_WIDTH = 1.5;
/** Faces meeting at more than this angle (degrees) get a crease line. */
const CREASE_ANGLE = 25;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Silhouettes: ink where depth jumps (Laplacian of 1/z, which is flat across any plane), measured
// against immediate neighbours and then thickened, so outlines are continuous at any distance.
const fragmentShader = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 texel;
  uniform float spread;
  uniform float near;
  uniform float far;
  uniform vec3 ink;
  varying vec2 vUv;

  float invZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return (far - d * (far - near)) / (near * far);
  }

  float edgeAt(vec2 uv) {
    vec2 ox = vec2(texel.x, 0.0);
    vec2 oy = vec2(0.0, texel.y);
    float c = invZ(uv);
    float lap = abs(invZ(uv - ox) + invZ(uv + ox) + invZ(uv - oy) + invZ(uv + oy) - 4.0 * c);
    return smoothstep(0.05, 0.12, lap / max(c, 1e-6));
  }

  void main() {
    vec2 sx = vec2(texel.x * spread, 0.0);
    vec2 sy = vec2(0.0, texel.y * spread);
    float e = max(
      edgeAt(vUv),
      max(max(edgeAt(vUv - sx), edgeAt(vUv + sx)), max(edgeAt(vUv - sy), edgeAt(vUv + sy)))
    );
    vec3 col = texture2D(tColor, vUv).rgb;
    gl_FragColor = vec4(mix(col, ink, e), 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Crease lines as real geometry: every edge where faces meet at more than CREASE_ANGLE, drawn as
 * screen-space lines of constant width. Fills are pushed back slightly so lines on their edges win.
 */
function buildCreaseLines(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const positions: number[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const edges = new THREE.EdgesGeometry(o.geometry, CREASE_ANGLE).applyMatrix4(o.matrixWorld);
    const arr = edges.attributes.position.array;
    for (let i = 0; i < arr.length; i++) positions.push(arr[i]);
    edges.dispose();
    const m = o.material as THREE.Material;
    m.polygonOffset = true;
    m.polygonOffsetFactor = 1;
    m.polygonOffsetUnits = 1;
  });
  const material = new LineMaterial({ color: INK, linewidth: LINE_WIDTH });
  const lines = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material);
  lines.layers.set(NO_INK_LAYER);
  lines.frustumCulled = false;
  return { lines, material };
}

/**
 * Renders the scene as an ink drawing: crease lines drawn as geometry in the colour pass, then a depth
 * pass and a full-screen composite that adds silhouette outlines (the tree canopy, column, skyline).
 */
export function createInkRenderer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  inkRoot: THREE.Object3D,
) {
  const crease = buildCreaseLines(inkRoot);
  scene.add(crease.lines);

  const colorRT = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  // Float depth: an integer depth buffer quantises distant depth enough to read as false edges.
  const depthRT = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
  });
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });

  const composite = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      tColor: { value: colorRT.texture },
      tDepth: { value: depthRT.depthTexture },
      texel: { value: new THREE.Vector2() },
      spread: { value: 1 },
      near: { value: camera.near },
      far: { value: camera.far },
      ink: { value: new THREE.Color(INK) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composite);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  camera.layers.enable(NO_INK_LAYER);

  function setSize(width: number, height: number, pixelRatio: number) {
    const w = Math.round(width * pixelRatio);
    const h = Math.round(height * pixelRatio);
    colorRT.setSize(w, h);
    depthRT.setSize(w, h);
    composite.uniforms.texel.value.set(1 / w, 1 / h);
    // Silhouettes: a 2px edge plus this many px either side, to match the crease line weight.
    composite.uniforms.spread.value = Math.max(LINE_WIDTH * pixelRatio - 2, 0) / 2;
    crease.material.resolution.set(w, h);
    crease.material.linewidth = LINE_WIDTH * pixelRatio;
  }

  function render() {
    renderer.setRenderTarget(colorRT);
    renderer.render(scene, camera);

    const background = scene.background;
    scene.background = null;
    scene.overrideMaterial = depthOnly;
    camera.layers.disable(NO_INK_LAYER);
    renderer.setRenderTarget(depthRT);
    renderer.render(scene, camera);
    camera.layers.enable(NO_INK_LAYER);
    scene.overrideMaterial = null;
    scene.background = background;

    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCamera);
  }

  return { render, setSize };
}
