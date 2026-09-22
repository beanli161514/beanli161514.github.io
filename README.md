# Ear, in motion

Interactive GitHub Pages demo for Rubin Zhao's multiview mouse-ear reconstruction project.

The same site also includes **[NeuroFly](neurofly/index.html)** at `/neurofly/`: a real WebGL 2 volume MIP, three local graph-review cases, and exportable attributed decisions demonstrating the data-engine workflow. The root remains the ear project.

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

NeuroFly's [data contract and provenance](public/neurofly/DATA_FORMAT.md) document the public 600 MB microscopy block, derived 32³ endpoint-centered crops, original segmentation fragments, coordinate layout, and the unresolved crossing example. The overview plus all three volumes total 104,410 bytes compressed; only requested crops are fetched. The 3D renderer combines maximum intensity ray casting with smooth, shaded sphere annotations at display resolution. It reduces volume sampling while dragging and renders only on interaction. Tasks use accept / reject / uncertain decisions, and exported records retain graph context, reviewer attribution, replay state, and dataset revision. No model inference, training, or annotation upload happens in the demo. Visitor labels stay in local browser storage and exported labels remain marked unverified.

## Publish

`npm run build` produces the site. The `gh-pages` branch contains only the built site and `.nojekyll`; GitHub Pages publishes that branch's root. The `main` branch contains this source, exporter, tests, and assets. Update the build and push `gh-pages` when changing the published demo.
