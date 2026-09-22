# NeuroFly interactive demo data

The page presents real 3D fluorescence crops and graph annotations through a **curated decision replay**. It demonstrates a proposed data-engine workflow. It does not run model inference, change the source dataset, or train a model in the browser. Visitor choices are **unverified demo reviews**, never automatically validated training ground truth.

## Source and attribution

**NeuroFly Neuron Reconstruction Dataset**, Zenodo, DOI [10.5281/zenodo.13328867](https://doi.org/10.5281/zenodo.13328867), August 15, 2024. The deposited creators are `Anonymous, Anonymous`; its public metadata specifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). These data are cropped, downsampled and quantized derivatives. Source software and annotation documentation: [NeuroFly](https://github.com/beanli161514/neurofly).

The source is `RM009_axons_2.tif`: a **1000 × 1000 × 300 uint16** macaque VISoR image block, with 300 million voxels and 600,166,090 file bytes. It is a public sample block, not a whole brain or a terabyte dataset. The overview is this same complete block downsampled; larger-scale workflow statements describe the intended system context.

The source TIFF MD5 is `21e734a367969d84b93b7613d7a5f729`, matching the Zenodo file. The public annotation database MD5 is `df076171651054f04026a6e360fba765`. The bundled export is also compatible with a local annotation copy whose review flags differ, because all node coordinates, directed edges with provenance, and segment geometry match the public reference. The exporter verifies those fields against the independently recorded SHA256 fingerprint `7f194483dbb7ac8052e5b54542eac9c15c7b903dc7b447be970e0adcfabf385a`. It rejects other images or graphs rather than assigning these curated outcomes to arbitrary data.

The dataset is the source of image values and graph geometry. The standalone export code does not copy NeuroFly GPL-3.0 implementation modules into the browser renderer.

## Runtime files

| File | Dimensions xyz | Compressed bytes | Purpose |
| --- | --- | ---: | --- |
| `data/continuation.u8.gz` | 96 × 96 × 96 | 260,734 | Replay expert join 2667–2769 |
| `data/extension.u8.gz` | 96 × 96 × 96 | 204,056 | Replay expert join 3814–6740 |
| `data/crossing.u8.gz` | 96 × 96 × 96 | 238,792 | Explicitly unresolved crossing |
| `data/overview.u8.gz` | 100 × 100 × 30 | 66,734 | Complete source block, max pooled 10× per axis |

The four volume files total **770,316 compressed bytes**. A local crop expands to 884,736 uint8 bytes. `data/manifest.json` supplies source provenance, transforms, task prompts, graph geometry, and reference notes. Cases can be fetched independently and cached for later visits.

## Coordinates and rendering

Source graph coordinates and source TIFF arrays both use xyz, as documented in NeuroFly's annotation guide, despite the TIFF's generic `QYX` tag. Exported binary arrays use **uint8, C-order zyx**, with x varying fastest. Construct a WebGL volume texture with dimensions `shape[0], shape[1], shape[2]`. Local point coordinates satisfy `localXYZ = sourceXYZ − originXYZ`.

The TIFF does not contain physical spacing calibration. `spacing: [1, 1, 1]` means voxel coordinates, not micrometers. Overview spacing is `[10, 10, 10]` source voxels. A source ROI therefore maps onto the overview by division by ten.

Display intensities use **8-bit display quantization**. Each crop maps its original uint16 30th and 99.95th intensity percentiles linearly to 0–255, clipping outside that range. The manifest retains the thresholds and original min/max. The overview first takes maxima over 10×10×10 source voxels, then maps its 30th and 99.7th percentiles to 0–255. These operations add no signal and perform no deconvolution.

## Manifest schema

`schemaVersion: 1` and `kind: "curated-decision-replay"` identify this format. Top-level fields include `provenance`, `sourceVolume`, `axes`, `overview`, and `tasks`.

Each task contains:

- `id`, `title`, `prompt`, `context`: concise presentation content.
- `volume`, `shape`, `origin`, `spacing`, `compressedBytes`, `decodedBytes`, `intensityMapping`: volume decoding and display transform.
- `nodes`: `{id, position: [x,y,z], component}` entries, with component IDs computed on the displayed cropped graph.
- `edges`: undirected `[sourceId, targetId]` pairs, listed once.
- `sourceId`, `targetId`, `sourcePosition`, `targetPosition`: proposed connection endpoints.
- `historyNodeIds`, `history`, `incomingVector`: previous segmentation nodes ordered toward the source endpoint, and a unit vector toward that endpoint.
- `originalEdgePresent`, `heldOutEdges`, `replayNote`: the edge temporarily hidden for interactive review.
- `referenceDecision`, `referenceNote`: documented reference evidence, with `null` when unresolved.

The candidate edge is withheld from the displayed graph. All other in-crop edges remain present. Original databases stay unchanged. The first two examples are saved `tester` joins also listed in NeuroFly's documented completed trace.

The crossing has **no definitive reference outcome**. Its saved graph contains 4583–4606, while a later recorded model run favored candidate 6850 after a projected-tangent check. This disagreement is retained rather than treated as a ground-truth negative. Accept, reject and uncertainty are interface actions; none constitutes validated ground truth merely because a visitor selects it.

## Visitor review records

The page exports a structured local record containing the task/candidate, decision, review status and graph operation. Records use `validation: "unverified-demo-review"`. An uncertain choice defers the case and leaves graph topology unchanged. This illustrates how standardized actions could feed review and model-development queues; it is not online learning or automatic ingestion of public visitors' labels into training data.

## Reproduce

Run from the source repository. The source directory must contain the publicly released `RM009_axons_2.tif` and corresponding `RM009_axons_2.db` (or its verified geometry-equivalent working copy).

```sh
python -m pip install numpy tifffile
python scripts/export_neurofly.py --source /path/to/labeled_blocks
python scripts/verify_neurofly.py --source /path/to/labeled_blocks
```

The default output is `public/neurofly/data`. To use another directory:

```sh
python scripts/export_neurofly.py --source /path/to/labeled_blocks --out /path/to/demo-data
python scripts/verify_neurofly.py --source /path/to/labeled_blocks --data /path/to/demo-data
```

Optional QA projections require Pillow and are written only with `--qa`:

```sh
python -m pip install pillow
python scripts/export_neurofly.py --source /path/to/labeled_blocks --qa /path/to/qa
```

Source images are memory-mapped with `mode="r"`; SQLite databases are opened with `mode=ro`. Verification checks the complete encoded crop transforms, every exported graph coordinate, withheld edge provenance, published source fingerprints, and complete overview downsampling.
