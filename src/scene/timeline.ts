// Scroll pacing and copy timing. Units are svh. Total scroll is 845svh: the motion spec's 660svh plus
// 185svh spread over the 3D stops, for a more unhurried fly-through (45 of it gives the first view of
// the quad, out of the archway, a clear moment before its copy arrives).
//
// The camera never parks. Each stop has a "moment" in the scroll where the camera passes it, and each
// stop's copy is timed around that moment (COPY). While a stop's copy and its overlay are up, the camera
// drops into slow motion (SLOW of cruising speed) so the drift behind the text is easy to follow; between
// stops it eases back up to cruise to do the travelling. Speed is one continuous curve across the whole
// scroll, and only settles fully at the very end. Moments are placed so the total works out exactly.

export const STOP_RANGES = [100, 225, 160, 180, 180];

/** When the camera passes the Archway stop, just inside the passage as the black lifts. */
export const ARCHWAY_AT = 145;

/**
 * Stop 1 photo → 3D handover, in svh. From the first scroll the photo zooms into the arch in one
 * continuous move (eased in zoom-as-perceived, i.e. log scale): gentle start, building through the
 * middle, easing off into the dark. The cut to 3D happens at `cut`, fully black; the 3D camera is
 * already at the mouth of the passage and glides on through it as the black lifts by `revealEnd`.
 */
export const HANDOVER = {
  darkStart: 90,
  cut: 128,
  zoomScale: 6,
  revealEnd: 150,
};

/**
 * Copy timing, in svh relative to each stop's moment. Each panel's beats (heading, then rule/body,
 * then cards/CTAs...) rise in BEAT_GAP apart, each taking FADE, starting LEAD before the moment;
 * the panel leaves EXIT after the moment. The Tower's copy goes as soon as scrolling starts; the
 * Archway's holds off until the camera is out into the quad, so the illustration is seen clear first.
 */
export const COPY = {
  BEAT_GAP: 6,
  FADE: 20,
  LEAD: [0, -40, 45, 45, 45],
  EXIT: [0, 115, 30, 30, Infinity],
};

/** Camera speed while a stop's overlay is up, as a fraction of cruising speed. */
export const SLOW = 0.2;
/** svh over which the camera eases between slow motion and cruise. */
const RAMP = 20;
const STEP = 0.5;
/** Distance (m) short of the Archway stop at the cut, i.e. the outer mouth of the passage. */
const AT_CUT = 7;
/** Camera speed (m/svh) at the cut, carrying on through the passage as the black lifts. */
const CUT_SPEED = 0.3;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const smooth01 = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};

export class Timeline {
  readonly total = STOP_RANGES.reduce((a, b) => a + b, 0);
  /** Scroll position (svh) at which the camera passes each stop. */
  moments: number[] = [];
  private lengths: number[] = [];
  /** Slow-motion windows [start, end] in svh, one per 3D stop. */
  private zones: [number, number][] = [];
  /** Per move after the archway: fraction of the move covered at each STEP of scroll. */
  private tables: number[][] = [];
  private cruise = 0;

  /** Slow-motion window for a stop, relative to its moment: while its overlay is mostly up. */
  private static zoneFor(i: number): [number, number] {
    const half = COPY.FADE / 2;
    return [half - COPY.LEAD[i], COPY.EXIT[i] + half];
  }

  /** Speed weighting at a scroll position: 1 = cruise, SLOW under an overlay, easing to 0 at the end. */
  private weight(s: number) {
    let z = 0;
    for (const [a, b] of this.zones) {
      z = Math.max(z, smooth01((s - a) / RAMP + 0.5) * (1 - smooth01((s - b) / RAMP + 0.5)));
    }
    return (SLOW + (1 - SLOW) * (1 - z)) * smooth01((this.total - s) / RAMP);
  }

  /**
   * Place each stop's moment so that, after the archway, every move travels at the same cruising speed
   * and the same slow-motion speed, and the whole thing ends exactly at the end of the scroll.
   */
  pace(segmentLengths: number[]) {
    this.lengths = segmentLengths;
    const n = segmentLengths.length + 1;
    const rel = Array.from({ length: n }, (_, i) => Timeline.zoneFor(i));
    const setZones = (moments: number[]) =>
      (this.zones = moments.slice(1).map((m, j) => [m + rel[j + 1][0], m + rel[j + 1][1]]));

    // Scroll needed to cover each move at cruising speed c, given that the slow-motion windows sit
    // around the stops at either end (the far stop's window moves with where that stop lands).
    const place = (c: number) => {
      const moments = [0, ARCHWAY_AT];
      for (let k = 1; k < n - 1; k++) {
        const from = moments[k];
        const covered = (to: number) => {
          setZones([...moments, to]);
          let acc = 0;
          for (let x = from; x < to; x += STEP) acc += this.weight(Math.min(x + STEP / 2, to)) * Math.min(STEP, to - x);
          return c * acc;
        };
        let lo = from;
        let hi = from + 3000;
        for (let it = 0; it < 40; it++) {
          const mid = (lo + hi) / 2;
          if (covered(mid) < segmentLengths[k]) lo = mid;
          else hi = mid;
        }
        moments.push((lo + hi) / 2);
      }
      return moments;
    };

    // Pick the one cruising speed that makes the last stop land exactly at the end of the scroll.
    let lo = 0.01;
    let hi = 10;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (place(mid)[n - 1] > this.total) lo = mid;
      else hi = mid;
    }
    this.cruise = (lo + hi) / 2;
    const moments = place(this.cruise);
    moments[n - 1] = this.total;
    this.moments = moments;
    setZones(moments);

    // Integrate the speed weighting across each move on an even grid, normalised so each lands
    // exactly on its stop.
    this.tables = [];
    for (let k = 1; k < n - 1; k++) {
      const steps = Math.max(1, Math.ceil((moments[k + 1] - moments[k]) / STEP));
      const h = (moments[k + 1] - moments[k]) / steps;
      const t: number[] = [0];
      let acc = 0;
      let prev = this.weight(moments[k]);
      for (let j = 1; j <= steps; j++) {
        const w = this.weight(moments[k] + j * h);
        acc += ((prev + w) / 2) * h;
        prev = w;
        t.push(acc);
      }
      this.tables.push(t.map((v) => v / (acc || 1)));
    }
  }

  /** Scroll position (svh) → stop value for CameraPath. */
  stopAt(s: number) {
    const m = this.moments;
    if (s >= this.total) return m.length - 1;

    if (s <= m[1]) {
      // Tower → Archway. Unseen behind the photo until the cut, then a smooth run from the passage
      // mouth into the Archway stop, arriving at cruising speed.
      const D = this.lengths[0] || 1;
      const atCut = Math.max(D - AT_CUT, 0);
      if (s <= HANDOVER.cut) return (atCut / D) * clamp01(s / HANDOVER.cut);
      const T = m[1] - HANDOVER.cut;
      const u = clamp01((s - HANDOVER.cut) / T);
      const u2 = u * u;
      const u3 = u2 * u;
      const v1 = this.cruise * this.weight(m[1]);
      const d = atCut + (D - atCut) * (3 * u2 - 2 * u3) + T * (CUT_SPEED * (u3 - 2 * u2 + u) + v1 * (u3 - u2));
      return clamp01(d / D);
    }

    let k = 1;
    while (k < m.length - 2 && s > m[k + 1]) k++;
    const table = this.tables[k - 1];
    const x = ((s - m[k]) / (m[k + 1] - m[k])) * (table.length - 1);
    const i = Math.min(Math.floor(x), table.length - 2);
    return k + table[i] + (table[i + 1] - table[i]) * (x - i);
  }

  /** Which stop is current: the Tower until the cut, then whichever stop's moment is nearest. */
  rangeAt(s: number) {
    const m = this.moments;
    if (s < HANDOVER.cut) return 0;
    let i = 1;
    while (i < m.length - 1 && s >= (m[i] + m[i + 1]) / 2) i++;
    return i;
  }
}
