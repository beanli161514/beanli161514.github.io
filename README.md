# Ear, in motion

Interactive GitHub Pages demo for Rubin Zhao's multiview mouse-ear reconstruction project.

- Three selected B41 trials, six synchronized camera views, distortion-aware ear and face overlays.
- Interactive 3D ear rims and facial landmarks, with calibrated camera frustums.
- Shared frame slider, play/pause, and playback speed.
- Left/right statistical shape model with 15 PCA sliders in standard deviations.

## Develop

```
npm ci
npm run dev
npm test
npm run build
```

The output in `dist/` is a complete static site. Fonts, renderer, data, and media are hosted together; no runtime CDN or server is required. A recent browser with WebGL2 is recommended. A slower display can skip presented frames; all views use one video clock.

## Data

See [the versioned data contract](public/DATA_FORMAT.md). Source ranges are zero-based, end-exclusive, and retain all 100 fps source frames. These assets are specific selected recording excerpts, not the complete dataset. The reconstruction code lives in [ear_recon](https://github.com/beanli161514/ear_recon).

## Publish

`npm run build` produces the site. The `gh-pages` branch contains only the built site and `.nojekyll`; GitHub Pages publishes that branch's root. The `main` branch contains this source, exporter, tests, and assets. Update the build and push `gh-pages` when changing the published demo.
