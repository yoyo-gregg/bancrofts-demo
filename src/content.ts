import { COPY, type Timeline } from './scene/timeline';

// Copy timing lives in timeline.ts (COPY), since the camera slows to slow motion under each stop's copy.
const { BEAT_GAP, FADE, LEAD, EXIT } = COPY;
const RISE = 14; // px travelled while fading
// Which way copy drifts as it leaves: the Tower's sinks down as the zoom begins; the rest drift up.
const EXIT_DRIFT = [1, -1, -1, -1, -1];
// Full-screen Oats veil behind a stop's copy (1 = solid, as in the Figma frames): VEIL while the copy
// fades in and out, rising to VEIL_SETTLED once all of it is in, for contrast while it's being read.
// The scene behind is blurred up to BLUR px, softening its ink lines into texture.
const VEIL = 0.85;
const VEIL_SETTLED = 0.95;
const BLUR = 6;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const ease = (u: number) => 1 - Math.pow(1 - u, 3);

interface Beat {
  el: HTMLElement;
  order: number;
}

/**
 * Content overlay for the five stops (Figma Desktop Scenes 1-5), the right-hand rail and the
 * Head's video placeholder. Driven by the same smoothed scroll position as the camera. With reduced
 * motion the panels are static sections stacked down the page, and the rail simply jumps between them.
 */
export function initContent(timeline: Timeline, scrollToS: (s: number) => void, reduced = false) {
  const panels = [...document.querySelectorAll<HTMLElement>('.panel')];
  const beats = panels.map((panel) =>
    [...panel.querySelectorAll<HTMLElement>('[data-beat]')].map((el): Beat => ({ el, order: Number(el.dataset.beat) })),
  );
  const cue = document.querySelector<HTMLElement>('.scroll-cue')!;
  const veil = document.querySelector<HTMLElement>('#veil')!;
  const railButtons = [...document.querySelectorAll<HTMLButtonElement>('#rail button')];

  // Rail links land where a stop's copy is fully in: the camera's pass, or later if the copy finishes
  // arriving after it (the Archway's copy comes in as the camera emerges into the quad).
  const settledAt = (i: number) => {
    if (i === 0) return 0;
    const lastBeat = Math.max(...beats[i].map((b) => b.order));
    const m = timeline.moments[i];
    return Math.min(Math.max(m, m - LEAD[i] + lastBeat * BEAT_GAP + FADE), timeline.total);
  };
  railButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.stop);
      if (reduced) panels[i].scrollIntoView();
      else scrollToS(settledAt(i));
    }),
  );

  let active = -1;
  const setActive = (now: number) => {
    if (now === active) return;
    railButtons.forEach((btn, i) => {
      btn.classList.toggle('is-active', i === now);
      btn.querySelector('img')!.src = `./assets/${i === now ? 'rail-dot-active' : 'rail-dot'}.svg`;
    });
    active = now;
  };

  // Video placeholder: the page (and so the camera) holds still while it's open.
  const overlay = document.querySelector<HTMLElement>('#video-overlay')!;
  const setVideo = (open: boolean) => {
    overlay.hidden = !open;
    document.querySelector<HTMLElement>('#scroller')!.style.overflow = open ? 'hidden' : '';
  };
  document.querySelector('.video')!.addEventListener('click', () => setVideo(true));
  overlay.querySelector('.video-overlay__close')!.addEventListener('click', () => setVideo(false));
  overlay.addEventListener('click', (e) => e.target === overlay && setVideo(false));
  addEventListener('keydown', (e) => e.key === 'Escape' && !overlay.hidden && setVideo(false));

  if (reduced) {
    // Static sections: the rail follows whichever one fills most of the screen.
    const seen = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(panels.indexOf(e.target as HTMLElement))),
      { threshold: 0.5 },
    );
    panels.forEach((p) => seen.observe(p));
    setActive(0);
    return { update: (_s: number) => 0 };
  }

  function update(s: number) {
    const { moments } = timeline;
    let veiled = 0;
    let settled = 0;
    panels.forEach((panel, i) => {
      const m = moments[i];
      const outStart = m + EXIT[i];
      const out = ease(clamp01((s - outStart) / FADE));
      let shown = 0;
      let all = 1; // how fully every beat is in: 1 once the whole stop's copy has settled
      for (const { el, order } of beats[i]) {
        const inStart = m - LEAD[i] + order * BEAT_GAP;
        // The Tower's copy is up on load; everything else rises in.
        const inn = i === 0 ? 1 : ease(clamp01((s - inStart) / FADE));
        const o = inn * (1 - out);
        el.style.opacity = String(o);
        el.style.transform = `translateY(${((1 - inn) + out * EXIT_DRIFT[i]) * RISE}px)`;
        shown = Math.max(shown, o);
        all = Math.min(all, o);
      }
      // The hero sits on the photo's own cream sky, so only the 3D stops raise the veil.
      if (i > 0) {
        veiled = Math.max(veiled, shown);
        settled = Math.max(settled, all);
      }
      panel.classList.toggle('is-shown', shown > 0.001);
      panel.classList.toggle('is-live', shown > 0.6);
    });

    // Oats as a translucent fill over a blurred backdrop (the element itself stays opaque, or its
    // opacity would fade the blur out along with it).
    const strength = veiled * (VEIL + (VEIL_SETTLED - VEIL) * settled);
    veil.style.backgroundColor = `rgba(244, 239, 230, ${strength.toFixed(3)})`;
    // No blur on phones: a full-screen backdrop blur every frame is costly there, and the veil carries it.
    const blurPx = innerWidth < 768 ? 0 : BLUR * veiled;
    const blur = blurPx > 0.01 ? `blur(${blurPx.toFixed(2)}px)` : 'none';
    veil.style.backdropFilter = blur;
    veil.style.setProperty('-webkit-backdrop-filter', blur);

    // "Scroll to discover" goes on the first scroll.
    cue.style.opacity = String(1 - ease(clamp01(s / 10)));

    setActive(timeline.rangeAt(s));
    return strength; // veil strength, for matching the phone's status bar colour
  }

  return { update };
}
