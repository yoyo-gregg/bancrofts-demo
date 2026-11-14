# Bancroft's homepage fly-through

Scroll-driven prototype for the Bancroft's School homepage: a hero photo that zooms into the gatehouse arch, then a 3D ink-and-wash illustration of the quad with the homepage content at five stops.

Built with Vite, TypeScript, Three.js and GSAP ScrollTrigger.

## Run locally

```bash
npm install
npm run dev
```

## Useful URLs

- `?reduced` previews the reduced-motion version (static stills stacked down the page).
- `?debug` shows the debug panel on the published site (it's always on in local dev; press H to hide).

## Deploying

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`).
