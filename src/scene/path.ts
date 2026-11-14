import * as THREE from 'three';
import type { PathPoint } from './stops';

const SAMPLES = 160;

interface Angle {
  /** Distance along the whole path (m). */
  at: number;
  yaw: number;
  pitch: number;
}

/**
 * Camera position spline through every path point, with the view direction on its own smooth curve.
 * Progress is expressed as a "stop value": 0 = stop 1, 1 = stop 2, ... with fractions travelling
 * between stops at constant speed (arc-length) regardless of how many waypoints a segment has.
 * Each point's view is turned into yaw/pitch (unwrapped so turns take the short way round) and
 * interpolated by distance travelled with a C1 spline, so the turning rate changes smoothly through
 * every point, and the view never swings towards a target the camera happens to pass close to.
 */
export class CameraPath {
  pos!: THREE.CatmullRomCurve3;
  private angles: Angle[] = [];
  private stopIdx: number[] = [];
  private tables: { t: number[]; len: number[] }[] = [];
  /** Distance along the whole path at which each stop's move begins. */
  private starts: number[] = [];
  /** Length in metres of each move between consecutive stops. */
  lengths: number[] = [];

  constructor(points: PathPoint[]) {
    this.set(points);
  }

  get segments() {
    return this.stopIdx.length - 1;
  }

  set(points: PathPoint[]) {
    this.pos = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p.pos)), false, 'centripetal');
    this.stopIdx = points.flatMap((p, i) => (p.stop !== undefined ? [i] : []));

    // getPoint(t) maps t linearly onto point indices, so point i sits at t = i / (n - 1).
    const n = points.length - 1;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.tables = [];
    this.lengths = [];
    this.starts = [];
    const pointAt: number[] = [0];
    let run = 0;
    for (let k = 0; k < this.segments; k++) {
      const t0 = this.stopIdx[k] / n;
      const t1 = this.stopIdx[k + 1] / n;
      const t: number[] = [];
      const len: number[] = [];
      let total = 0;
      this.pos.getPoint(t0, a);
      for (let i = 0; i <= SAMPLES; i++) {
        const ti = t0 + ((t1 - t0) * i) / SAMPLES;
        this.pos.getPoint(ti, b);
        total += a.distanceTo(b);
        a.copy(b);
        t.push(ti);
        len.push(total);
      }
      // Where each point after this stop (up to and including the next stop) falls along the path.
      for (let j = this.stopIdx[k] + 1; j <= this.stopIdx[k + 1]; j++) {
        const tj = j / n;
        let i = 1;
        while (i < t.length - 1 && t[i] < tj) i++;
        const f = (tj - t[i - 1]) / (t[i] - t[i - 1] || 1);
        pointAt[j] = run + len[i - 1] + (len[i] - len[i - 1]) * f;
      }
      this.tables.push({ t, len: len.map((l) => l / (total || 1)) });
      this.starts.push(run);
      this.lengths.push(total);
      run += total;
    }

    let prevYaw = 0;
    this.angles = points.map((p, i) => {
      const d = new THREE.Vector3(...p.target).sub(new THREE.Vector3(...p.pos));
      let yaw = Math.atan2(-d.x, -d.z);
      if (i > 0) yaw += Math.round((prevYaw - yaw) / (2 * Math.PI)) * 2 * Math.PI;
      prevYaw = yaw;
      return { at: pointAt[i] ?? 0, yaw, pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
    });
  }

  /** Curve parameter for a stop value. */
  paramAt(stopValue: number) {
    const k = THREE.MathUtils.clamp(Math.floor(stopValue), 0, this.segments - 1);
    const u = THREE.MathUtils.clamp(stopValue - k, 0, 1);
    const { t, len } = this.tables[k];
    let i = 1;
    while (i < len.length - 1 && len[i] < u) i++;
    const f = (u - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return t[i - 1] + (t[i] - t[i - 1]) * f;
  }

  /** Yaw/pitch at a distance along the path: cubic Hermite with tangents from neighbouring points. */
  private angleAt(dist: number, key: 'yaw' | 'pitch') {
    const A = this.angles;
    let i = 0;
    while (i < A.length - 2 && dist > A[i + 1].at) i++;
    const p0 = A[i];
    const p1 = A[i + 1];
    const h = p1.at - p0.at || 1;
    const slope = (j: number) => {
      if (j === 0 || j === A.length - 1) return 0;
      return (A[j + 1][key] - A[j - 1][key]) / (A[j + 1].at - A[j - 1].at || 1);
    };
    const u = THREE.MathUtils.clamp((dist - p0.at) / h, 0, 1);
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      p0[key] * (2 * u3 - 3 * u2 + 1) +
      slope(i) * h * (u3 - 2 * u2 + u) +
      p1[key] * (-2 * u3 + 3 * u2) +
      slope(i + 1) * h * (u3 - u2)
    );
  }

  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  sample(stopValue: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    const t = this.paramAt(stopValue);
    this.pos.getPoint(t, outPos);
    const k = THREE.MathUtils.clamp(Math.floor(stopValue), 0, this.segments - 1);
    const dist = this.starts[k] + THREE.MathUtils.clamp(stopValue - k, 0, 1) * this.lengths[k];
    outQuat.setFromEuler(this.euler.set(this.angleAt(dist, 'pitch'), this.angleAt(dist, 'yaw'), 0));
  }
}
