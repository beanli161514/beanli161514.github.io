# Ear, in motion

Interactive GitHub Pages demo for Rubin Zhao's multiview mouse-ear reconstruction project.

The same site also includes **[NeuroFly](neurofly/index.html)** at `/neurofly/`: a real WebGL 2 volume MIP, three task types for local graph review, and exportable attributed decisions demonstrating the data-engine workflow. The root remains the ear project.

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

NeuroFly's [data contract and provenance](public/neurofly/DATA_FORMAT.md) document the public 600 MB microscopy block, 32³ endpoint-centered crops, original segmentation fragments, and reproducible candidate generation. The three tasks cover a connection decision between two fragments, selection among nearby fragment endpoints, and point proposals when no other fragment endpoints are nearby. Point proposals use the endpoint direction and local intensity maxima within a declared distance range. Choosing **None** in that task labels the source as a **true ending**; choosing **Uncertain** defers it without assigning a training target.

Only requested crops and a small overview are fetched. The 3D renderer combines maximum intensity ray casting with shaded sphere annotations at display resolution, reducing volume sampling while dragging. Exported records retain the task type, full candidate set, chosen candidate or terminal label, graph context, reviewer attribution, replay state, and dataset revision. Candidate points join the graph only when selected. Reviews remain local to the browser and exported labels are marked unverified; no training or annotation upload runs in the demo.

## Publish

`npm run build` produces the site. The `gh-pages` branch contains only the built site and `.nojekyll`; GitHub Pages publishes that branch's root. The `main` branch contains this source, exporter, tests, and assets. Update the build and push `gh-pages` when changing the published demo.
