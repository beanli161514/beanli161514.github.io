# Ear, in motion

Interactive GitHub Pages demo for Rubin Zhao's multiview mouse-ear reconstruction project.

The same site also includes **[NeuroFly](neurofly/index.html)** at `/neurofly/`: WebGL 2 volume MIP views, annotated neurons in a T154 whole mouse brain, and three task types for local graph review. The root remains the ear project.

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

NeuroFly's [data contract and provenance](public/neurofly/DATA_FORMAT.md) document two separate acquisitions: the T154 mouse whole-brain fluorescence image with six annotated neurons, and the public RM009 macaque microscopy block used for local tasks. The whole-brain box shows the RM009 block's **1 × 1 × 0.3 mm** physical size at an illustrative position; the datasets are not registered to one another.

The three local tasks use **32³ endpoint-centered crops** and cover a connection decision between two fragments, selection among nearby fragment endpoints, and point proposals when no other fragment endpoints are nearby. Point proposals use the endpoint direction and local intensity maxima within a declared distance range. Choosing **None** in that task labels the source as a **true ending**; choosing **Uncertain** defers it without assigning a training target.

The browser fetches compact whole-brain and block overviews, six neuron skeletons, and the requested task crops. The renderer combines maximum intensity ray casting with 3D graph annotations, reducing volume sampling while dragging. The whole-brain view keeps all six neuron traces visible, with drag-to-rotate, scroll-to-zoom, and reset controls. Both overviews rotate slowly while idle (one turn per five minutes), pause during interaction, and resume after five seconds. Offscreen, hidden-tab, and reduced-motion views stay still. Candidate points join the local graph only when selected. Review state stays in browser storage and can be cleared with **Reset session**; the page has no review-export control. No model training or annotation upload runs in the demo.

The training illustration reveals a real annotated fiber node by node inside an interactive microscopy volume. Readers can rotate, zoom, pause, restart, and scrub through the saved annotation. The model figure follows the research slide: a volume and trajectory feed tokenizers, blue trajectory and yellow image tokens enter the TwoWay Transformer, and a red learnable query feeds the action head. Local decisions update an observation–action example: connect or reject a fragment edge, select an endpoint, extend to a proposed point, or stop at a true ending. Inputs retain the pre-review context; uncertain cases have no supervised target. Visitor labels still require curation. The fiber replay uses saved geometry; the broader action head illustrates a proposed extension of the existing next-displacement model.

Rebuild the T154 assets with [`export_t154_brain.py`](scripts/export_t154_brain.py) and [`export_t154_neurons.py`](scripts/export_t154_neurons.py). The NeuroFly data contract includes source requirements, commands, physical-coordinate transforms, component selection, and simplification details. T154 provenance is separate from the RM009 dataset's CC BY 4.0 license.

## Publish

`npm run build` produces the site. The `gh-pages` branch contains only the built site and `.nojekyll`; GitHub Pages publishes that branch's root. The `main` branch contains this source, exporter, tests, and assets. Update the build and push `gh-pages` when changing the published demo.
