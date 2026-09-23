# Rubin Zhao · Projects

Two self-contained research pages and a physical-design page share a neutral project index and a consistent, readable layout. Research context is split into short explanations alongside each interactive section; the Double Helix page remains focused on the model and photographs.

| Page | Published URL | Source entry |
| --- | --- | --- |
| Projects | [beanli161514.github.io](https://beanli161514.github.io/) | [index.html](index.html) |
| 3D Ear Reconstruction | [/ear/](https://beanli161514.github.io/ear/) | [ear/index.html](ear/index.html) |
| Scalable Annotation for Connectome Construction · NeuroFly | [/neurofly/](https://beanli161514.github.io/neurofly/) | [neurofly/index.html](neurofly/index.html) |
| Double Helix | [/double-helix/](https://beanli161514.github.io/double-helix/) | [double-helix/index.html](double-helix/index.html) |

The ear page provides:

- Three selected B41 trials, six synchronized camera views, distortion-aware ear and face overlays.
- Interactive 3D ear rims and facial landmarks, with calibrated camera frustums.
- Shared frame slider, play/pause, and playback speed.
- Left/right statistical shape model with six PCA sliders shown initially and an option to show all 15 modes, in standard deviations.

The NeuroFly page provides WebGL 2 volume MIP views, annotated neurons in a T154 whole mouse brain, three task types for local graph review, and a structured-action tracing walkthrough. Its static introductory illustration is an AI-edited adaptation of the supplied paper figure with panel letters and the color scale removed; it is separate from the measured interactive volume assets.

The Double Helix page pairs five photographs with an interactive viewer for the original body and cap designs. Compact GLB files retain the source mesh geometry; STL downloads are fetched only when requested. Photo assets are resized, converted to sRGB, and stripped of metadata. The 3D view supports mouse, touch, and keyboard controls, with slow rotation that pauses during interaction, offscreen, and in hidden tabs; reduced-motion preferences disable automatic rotation initially.

## Develop

```
npm ci
npm run dev
npm test
npm run build
```

Open the development server's `/` project index, `/ear/`, `/neurofly/`, or `/double-helix/`. Vite builds all four HTML entries into the matching paths in `dist/`.

Use the local development server for design and content review. Keep edits local until publication is requested; do not push to GitHub or wait for a Pages deployment after each revision.

The output in `dist/` is a complete static site. Fonts, renderer, data, and media are hosted together; no runtime CDN or server is required. A recent browser with WebGL2 is recommended. In the ear demo, a slower display can skip presented frames; all views use one video clock.

## Data

The ear assets remain in `public/data/`, served at `/data/`; their [versioned data contract](public/DATA_FORMAT.md) is served at `/DATA_FORMAT.md`. Source ranges are zero-based, end-exclusive, and retain all 100 fps source frames. These assets are specific selected recording excerpts, not the complete dataset. The reconstruction code lives in [ear_recon](https://github.com/beanli161514/ear_recon).

NeuroFly's assets remain in `public/neurofly/data/`, served at `/neurofly/data/`. Its [data contract and provenance](public/neurofly/DATA_FORMAT.md), served at `/neurofly/DATA_FORMAT.md`, document two separate acquisitions: the T154 mouse whole-brain fluorescence image with six annotated neurons, and the public RM009 macaque microscopy block used for local tasks. The whole-brain box shows the RM009 block's **1 × 1 × 0.3 mm** physical size at an illustrative position; the datasets are not registered to one another.

The three local tasks use **32³ endpoint-centered crops** and cover a connection decision between two fragments, selection among nearby fragment endpoints, and point proposals when no other fragment endpoints are nearby. Point proposals use the endpoint direction and local intensity maxima within a declared distance range. Choosing **None** in that task labels the source as a **true ending**; choosing **Uncertain** defers it without assigning a training target.

The browser fetches compact whole-brain and block overviews, six neuron skeletons, and the requested task crops. The renderer combines maximum intensity ray casting with 3D graph annotations, reducing volume sampling while dragging. The whole-brain view keeps all six neuron traces visible, with drag-to-rotate, scroll-to-zoom, and reset controls. Both overviews rotate slowly while idle (one turn per 100 seconds), pause during interaction, and resume after five seconds. Offscreen, hidden-tab, and reduced-motion views stay still. Candidate points join the local graph only when selected. Review state stays in browser storage and can be cleared with **Reset session**; the page has no review-export control. No model training or annotation upload runs in the demo.

The structured-action tracing demo starts with five disjoint fragments of a real annotated fiber in a 96³ microscopy volume. All other annotated segments intersecting this crop remain visible as muted context. A deterministic 33-step sequence extends across missing portions and joins existing fragments, alternating direct connection decisions and selection between nearby endpoints. Playback, pause, restart, and scrubbing remain available; the architecture panel and its synchronized action head are retained as commented HTML for possible restoration. The source trajectory and volume are unchanged; the gaps and action sequence are illustrative, not model inference. Crop boundaries are not labeled as biological endings. The retained model figure follows the research slide: volume and trajectory tokenizers feed the TwoWay Transformer, and a learnable query feeds the structured action head. The pure observation–action conversion helper in `src/neurofly-training.js` preserves pre-review context and assigns no supervised target to uncertain cases. Visitor labels require curation; the broader action head illustrates a proposed extension of the existing next-displacement model.

Rebuild the T154 assets with [`export_t154_brain.py`](scripts/export_t154_brain.py) and [`export_t154_neurons.py`](scripts/export_t154_neurons.py). The NeuroFly data contract includes source requirements, commands, physical-coordinate transforms, component selection, and simplification details. T154 provenance is separate from the RM009 dataset's CC BY 4.0 license.

## Publish

`npm run build` produces the project index and all project pages. Publish the complete `dist/` tree so `/ear/`, `/neurofly/`, `/double-helix/`, and their asset directories stay available. The `gh-pages` branch contains only the built site and `.nojekyll`; GitHub Pages publishes that branch's root. The `main` branch contains this source, exporters, tests, and assets. Update the build and push `gh-pages` when changing the published site.
