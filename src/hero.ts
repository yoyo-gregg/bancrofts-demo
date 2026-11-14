import { HANDOVER as H } from './scene/timeline';

// Arch centre within the hero photo, as fractions of its width and height.
const ARCH = { x: 0.509, y: 0.821 };
const SKY_TOP = '#f2eee6';
const SKY_BOTTOM = '#aec0da';
const GROUND = '#3a3934';

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * Stop 1 photo layer and the cut to 3D. Draws the hero onto a 2D canvas each frame, scaled about
 * the arch, darkens it to black, then hides it and lifts the black off the 3D scene (already inside
 * the passage). Drawing per frame, rather than CSS-scaling a large layer up to 7x, keeps only the
 * visible part of the photo in play, so nothing drops out when scrolling back.
 */
export function initHero() {
  const canvas = document.querySelector<HTMLCanvasElement>('#hero')!;
  const fade = document.querySelector<HTMLElement>('#fade')!;
  const ctx = canvas.getContext('2d')!;
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}hero-tower.webp`;
  let ready = false;
  /** Key of the last frame drawn, so an unchanged frame isn't redrawn. */
  let drawn = '';
  img.decode().then(() => {
    ready = true;
    drawn = '';
  });

  let w = 0;
  let h = 0;
  let dpr = 1;
  function resize() {
    dpr = Math.min(devicePixelRatio, innerWidth < 768 || matchMedia('(pointer: coarse)').matches ? 1.5 : 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    drawn = '';
  }
  addEventListener('resize', resize);
  resize();

  /**
   * Photo rect in screen space before any push: full width, centred on the arch, set 5% lower than
   * Figma (cropping a little road) so there's more sky above the tower for the copy. It can't simply
   * be scaled down: the panorama is ~3:1, so any smaller and it stops spanning wide screens.
   */
  function layout() {
    // Mobile (Figma Mobile Scene 1): the photo fills the bottom ~44% of the screen, cropped at the sides.
    const mobile = w < 768;
    const ph = mobile ? Math.max(0.435 * h, w / 2.985) : Math.max(0.628 * h, 0.353 * w);
    const pw = ph * (img.naturalWidth / img.naturalHeight || 2.985);
    const px = w / 2 - pw * ARCH.x;
    const py = mobile ? h - ph : h * 1.075 - ph;
    return { px, py, pw, ph, ax: px + pw * ARCH.x, ay: py + ph * ARCH.y };
  }

  function draw(scale: number, centre: number) {
    const key = `${scale.toFixed(4)}|${centre.toFixed(4)}|${w}|${h}|${ready}`;
    if (key === drawn) return;
    drawn = key;

    const { px, py, pw, ph, ax, ay } = layout();
    // Scale about the arch, and draw the arch up towards centre screen as we dive in.
    const tx = (w / 2 - ax) * centre;
    const ty = (h / 2 - ay) * centre;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, dpr * (ax * (1 - scale) + tx), dpr * (ay * (1 - scale) + ty));
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0.23, SKY_TOP);
    sky.addColorStop(0.68, SKY_BOTTOM);
    ctx.fillStyle = sky;
    ctx.fillRect(-w, -h, w * 3, py + ph * 0.5 + h);
    if (ready) ctx.drawImage(img, px, py, pw, ph);
  }

  /** Returns true while the photo still covers the frame (3D render can be skipped). */
  function update(s: number) {
    // One continuous zoom, eased in log scale (how zoom is perceived), slightly weighted towards the
    // later part; the arch drifts up to centre screen at the same rate.
    const progress = Math.pow(smooth(clamp01(s / H.cut)), 1.25);
    const scale = Math.pow(H.zoomScale, progress);
    const showPhoto = s < H.cut;
    canvas.style.visibility = showPhoto ? 'visible' : 'hidden';
    if (showPhoto) draw(scale, progress);

    const dark = showPhoto
      ? clamp01((s - H.darkStart) / (H.cut - H.darkStart))
      : 1 - clamp01((s - H.cut) / (H.revealEnd - H.cut));
    fade.style.opacity = String(smooth(dark));
    return showPhoto && dark < 1;
  }

  return { update };
}
