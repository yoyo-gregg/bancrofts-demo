import GUI from 'lil-gui';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPath } from './scene/path';
import { STOP_NAMES, savePath, type PathPoint } from './scene/stops';
import type { Timeline } from './scene/timeline';
import { NO_INK_LAYER } from './look';

export type Mode = 'scroll' | 'free';

interface DebugContext {
  points: PathPoint[];
  path: CameraPath;
  timeline: Timeline;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  triangles: number;
  scrollToS: (s: number) => void;
  setMode: (mode: Mode) => void;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** lil-gui panel: edit stop/waypoint positions and targets live, fly freely, copy the result as JSON. */
export function initDebug(ctx: DebugContext) {
  const { points, camera, controls } = ctx;
  const gui = new GUI({ title: "Bancroft's fly-through · H to hide" });
  // Below the site header and collapsed, so it doesn't cover Visit Us or the rail.
  gui.domElement.style.top = '120px';
  gui.close();
  const state = { mode: 'scroll' as Mode, showPath: true, progress: '' };
  const helpers = new THREE.Group();
  ctx.scene.add(helpers);
  let visible = true;
  // Path lines and markers only show in the free camera; in scroll mode the camera flies through them.
  const syncHelpers = () => (helpers.visible = visible && state.mode === 'free');

  const setMode = (mode: Mode) => {
    state.mode = mode;
    ctx.setMode(mode);
    syncHelpers();
  };

  function drawHelpers() {
    helpers.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
    });
    helpers.clear();
    if (!state.showPath) return;
    const line = (curve: THREE.Curve<THREE.Vector3>, color: string) =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(800)),
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }),
      );
    helpers.add(line(ctx.path.pos, '#d6336c'));
    for (const p of points) {
      helpers.add(
        line(new THREE.LineCurve3(new THREE.Vector3(...p.pos), new THREE.Vector3(...p.target)), '#3a7bd5'),
      );
      const isStop = p.stop !== undefined;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(isStop ? 0.55 : 0.3, 12, 8),
        new THREE.MeshBasicMaterial({ color: isStop ? '#22344D' : '#8a8f96', depthTest: false }),
      );
      dot.position.set(...p.pos);
      helpers.add(dot);
    }
    helpers.traverse((o) => {
      o.renderOrder = 999;
      o.layers.set(NO_INK_LAYER);
    });
  }

  // Read-only pacing: where each stop's moment falls and how long each move is.
  const pacing: Record<string, string> = {};
  function describePacing() {
    const { moments } = ctx.timeline;
    STOP_NAMES.forEach((name, i) => {
      pacing[`${i + 1}. ${name}`] = `${moments[i].toFixed(0)}svh`;
    });
    ctx.path.lengths.forEach((len, k) => {
      const span = moments[k + 1] - moments[k];
      pacing[`move ${k + 1}→${k + 2}`] = `${len.toFixed(0)}m / ${span.toFixed(0)}svh`;
    });
  }

  function rebuild() {
    ctx.path.set(points);
    ctx.timeline.pace(ctx.path.lengths);
    describePacing();
    drawHelpers();
    savePath(points);
  }
  describePacing();

  gui.add(state, 'mode', ['scroll', 'free']).name('camera').onChange(setMode).listen();
  gui.add(state, 'showPath').name('show path (free cam)').onChange(drawHelpers);
  gui.add(state, 'progress').name('progress').disable().listen();
  gui.add({ triangles: ctx.triangles }, 'triangles').disable();

  const jump = gui.addFolder('Jump to stop');
  STOP_NAMES.forEach((name, i) => {
    jump
      .add(
        {
          go: () => {
            setMode('scroll');
            ctx.scrollToS(ctx.timeline.moments[i]);
          },
        },
        'go',
      )
      .name(`${i + 1}. ${name}`);
  });

  const pace = gui.addFolder('Pacing (auto, by move length)');
  for (const key of Object.keys(pacing)) pace.add(pacing, key).disable().listen();
  pace.close();

  const pts = gui.addFolder('Path points');
  for (const p of points) {
    const title = p.stop !== undefined ? `★ ${p.stop + 1}. ${STOP_NAMES[p.stop]}` : `· ${p.id}`;
    const f = pts.addFolder(title);
    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      f.add(p.pos, i, i === 1 ? 0 : -120, i === 1 ? 40 : 120, 0.1).name(`pos ${axis}`).onChange(rebuild);
    });
    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      f.add(p.target, i, i === 1 ? -5 : -120, i === 1 ? 40 : 120, 0.1).name(`target ${axis}`).onChange(rebuild);
    });
    f.add(
      {
        view: () => {
          setMode('free');
          camera.position.set(...p.pos);
          controls.target.set(...p.target);
          controls.update();
        },
      },
      'view',
    ).name('view from here');
    f.add(
      {
        capture: () => {
          camera.position.toArray().forEach((v, i) => (p.pos[i] = round(v)));
          controls.target.toArray().forEach((v, i) => (p.target[i] = round(v)));
          f.controllersRecursive().forEach((c) => c.updateDisplay());
          rebuild();
        },
      },
      'capture',
    ).name('set from current view');
    f.close();
  }
  pts.close();

  gui.add(
    {
      copy: async () => {
        const json = JSON.stringify(
          {
            path: points.map((p) => ({ ...p, pos: p.pos.map(round), target: p.target.map(round) })),
            moments: ctx.timeline.moments.map(round),
          },
          null,
          2,
        );
        console.log(json);
        try {
          await navigator.clipboard.writeText(json);
          alert('Path JSON copied to clipboard (also logged to the console).');
        } catch {
          alert('Clipboard blocked; the JSON is in the console.');
        }
      },
    },
    'copy',
  ).name('Copy JSON');
  gui.add(
    {
      reset: () => {
        if (!confirm('Discard path edits and go back to the defaults in stops.ts?')) return;
        savePath(null);
        location.reload();
      },
    },
    'reset',
  ).name('Reset path to defaults');

  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'h' || (e.target as HTMLElement).closest('input')) return;
    visible = !visible;
    gui.show(visible);
    syncHelpers();
  });

  drawHelpers();
  syncHelpers();

  return {
    update(text: string) {
      state.progress = text;
    },
  };
}
