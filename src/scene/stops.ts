// The 5 camera stops, one per content scene in the Figma homepage canvas.
// The camera holds at each stop while its copy is shown and glides between them on one smooth spline.
// Points without a `stop` index are pass-through points that shape a move; the camera doesn't pause there.
// Edit live with the debug panel, then paste "Copy JSON" output over DEFAULT_PATH.

export type Vec3 = [number, number, number];

export interface PathPoint {
  id: string;
  stop?: number;
  pos: Vec3;
  target: Vec3;
}

export const STOP_NAMES = ['The Tower', 'Archway', 'The Quad', 'Old Tree', 'Cloister'];

export const DEFAULT_PATH: PathPoint[] = [
  // 1. The Tower is the hero photo. In 3D the camera runs up the approach unseen, so that at the cut
  // (in the dark, see HANDOVER) it reaches the outer mouth of the arch at cruising speed and carries on
  // through the passage as the black lifts.
  { id: 'tower', stop: 0, pos: [83, 1.7, 0], target: [0, 3.5, 0] },
  // 2. Archway: inside the passage, the column framed by the arch.
  { id: 'archway', stop: 1, pos: [37, 1.7, 0], target: [0, 3.5, 0] },
  // 3. The Quad: low, south-west of the column, looking back towards the tower.
  { id: 'quad', stop: 2, pos: [-12, 0.8, 5], target: [2, 5.5, 0] },
  // Swing out towards the south-east corner, turning (via south) to look west along the south range,
  // then up the east side to the tree, clear of the column.
  { id: 'south-east', pos: [18, 3, 6], target: [-16, 4, 20] },
  // 4. Old Tree: from the north-east corner, looking back at the tree with the chapel beyond.
  { id: 'old-tree', stop: 3, pos: [24, 2.2, -14], target: [6, 5, -11] },
  // 5. Cloister: from the south lawn, looking across to the cloister walk and chapel.
  { id: 'cloister', stop: 4, pos: [-8, 1.8, 18], target: [-27, 5, -20] },
];

const STORAGE_KEY = 'bancrofts.path.v9';

export function clonePath(points: PathPoint[]): PathPoint[] {
  return points.map((p) => ({ ...p, pos: [...p.pos] as Vec3, target: [...p.target] as Vec3 }));
}

/** Debug edits survive reloads; falls back to defaults if storage is empty, blocked or stale. */
export function loadPath(): PathPoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as PathPoint[];
      if (Array.isArray(saved) && saved.filter((p) => p.stop !== undefined).length === STOP_NAMES.length) return saved;
    }
  } catch {
    // ignore
  }
  return clonePath(DEFAULT_PATH);
}

export function savePath(points: PathPoint[] | null) {
  try {
    if (points) localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
