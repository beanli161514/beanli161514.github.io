# NeuroFly interactive demo data

The page presents real 3D fluorescence crops and graph annotations through a **curated decision replay**. It demonstrates the structured graph-review workflow. It does not run model inference, change the source dataset, or train a model in the browser. Visitor choices are **unverified demo reviews**, never automatically validated training ground truth.

## Source and attribution

**NeuroFly Neuron Reconstruction Dataset**, Zenodo, DOI [10.5281/zenodo.13328867](https://doi.org/10.5281/zenodo.13328867), August 15, 2024. The deposited creators are `Anonymous, Anonymous`; its public metadata specifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). These data are cropped, downsampled and quantized derivatives. Source software and annotation documentation: [NeuroFly](https://github.com/beanli161514/neurofly).

The source is `RM009_axons_2.tif`: a **1000 × 1000 × 300 uint16** macaque VISoR image block, with 300 million voxels and 600,166,090 file bytes. It is a public sample block, not a whole brain or a terabyte dataset. The overview is this same complete block downsampled; larger-scale workflow statements describe the intended system context.

The source TIFF MD5 is `21e734a367969d84b93b7613d7a5f729`, matching the Zenodo file. The public annotation database MD5 is `df076171651054f04026a6e360fba765`. The bundled export is also compatible with a local annotation copy whose review flags differ, because all node coordinates, directed edges with provenance, and segment geometry match the public reference. The exporter verifies those fields against the independently recorded SHA256 fingerprint `7f194483dbb7ac8052e5b54542eac9c15c7b903dc7b447be970e0adcfabf385a`. It rejects other images or graphs rather than assigning these curated outcomes to arbitrary data.

The dataset is the source of image values and graph geometry. The standalone export code does not copy NeuroFly GPL-3.0 implementation modules into the browser renderer.

## Runtime files

| File | Dimensions xyz | Compressed bytes | Purpose |
| --- | --- | ---: | --- |
| `data/continuation-32.u8.gz` | 32 × 32 × 32 | 13,080 | Endpoint 2667, candidate 2769 |
| `data/extension-32.u8.gz` | 32 × 32 × 32 | 13,792 | Endpoint 3814, candidate 3867 |
| `data/crossing-32.u8.gz` | 32 × 32 × 32 | 10,804 | Endpoint 4583, candidate 4606 |
| `data/overview.u8.gz` | 100 × 100 × 30 | 66,734 | Complete source block, max pooled 10× per axis |

The four volume files total **104,410 compressed bytes**; the three task crops account for 37,676 bytes. A task crop expands to 32,768 uint8 bytes. `data/manifest.json` supplies source provenance, transforms, task prompts, graph geometry, and reference notes. Cases can be fetched independently and cached for later visits.

## Coordinates and rendering

Source graph coordinates and source TIFF arrays both use xyz, as documented in NeuroFly's annotation guide, despite the TIFF's generic `QYX` tag. Exported binary arrays use **uint8, C-order zyx**, with x varying fastest. Construct a WebGL volume texture with dimensions `shape[0], shape[1], shape[2]`. Local point coordinates satisfy `localXYZ = sourceXYZ − originXYZ`. Each task has a true 32³ source crop, with `origin = floor(sourceEndpointXYZ) − 16` (clamped only at source-volume boundaries). All three selected endpoints therefore lie at local `[16, 16, 16]`, and every candidate lies inside the crop.

The TIFF does not contain physical spacing calibration. `spacing: [1, 1, 1]` means voxel coordinates, not micrometers. Overview spacing is `[10, 10, 10]` source voxels. A source ROI therefore maps onto the overview by division by ten.

Display intensities use **8-bit display quantization**. Each crop maps its original uint16 30th and 99.95th intensity percentiles linearly to 0–255, clipping outside that range. The manifest retains the thresholds and original min/max. The overview first takes maxima over 10×10×10 source voxels, then maps its 30th and 99.7th percentiles to 0–255. These operations add no signal and perform no deconvolution.

## Manifest schema

`schemaVersion: 2`, `dataRevision: 2`, and `revision: "endpoint-fragments-32-v2"` identify this format. The manifest uses `kind: "curated-decision-replay"`; top-level fields include `provenance`, `sourceVolume`, `axes`, `taskDesign`, `overview`, and `tasks`. Cached visitor reviews must be namespaced by this revision so votes on an earlier candidate are not transferred to a new one.

Each task contains:

- `id`, `title`, `prompt`, `context`: concise presentation content.
- `volume`, `shape`, `origin`, `spacing`, `compressedBytes`, `decodedBytes`, `intensityMapping`: volume decoding and display transform.
- `nodes`: `{id, position: [x,y,z], component}` entries, with component IDs computed on the full original segmentation graph (before cropping).
- `edges`: undirected `[sourceId, targetId]` pairs, listed once.
- `sourceId`, `targetId`, `sourcePosition`, `targetPosition`: proposed connection endpoints.
- `historyNodeIds`, `history`, `incomingVector`: previous segmentation nodes ordered toward the source endpoint, and a unit vector toward that endpoint.
- `sourceDegree`, `sourceFragmentId`, `targetFragmentId`: source endpoint degree and two distinct original fragment identities.
- `centerReviewStatus: "unchecked"`, `taskType: "endpoint-fragment-connection"`, `taskProvenance: "curated-segmentation-fragment-replay"`, and `replayState`: explicit task/review semantics. The unchecked state is simulated; `savedSourceChecked` retains the source DB flag.
- `originalEdgePresent`, `heldOutEdges`, `heldOutReviewerEdges`, `replayNote`: proposed connection and reviewer edges excluded from the initial graph.
- `reviewerPath`, `reviewerPathEdges`: saved reviewer connection path and edge creator provenance, retained for reference only.
- `referenceDecision`, `referenceNote`: documented reference evidence, with `null` when unresolved.

## Task construction

Every task starts from an **unchecked neuron endpoint** and proposes a connection to a node in another original segmentation fragment. The fixed actions are **accept**, **reject**, and **uncertain**. The same neutral prompt is used throughout: “Should this candidate connection be accepted?” A visitor inspects the local 3D fluorescence and trajectory continuity, then records one structured decision.

The initial graph contains **only `seger` edges and their original nodes**. All reviewer (`tester`) joins and interpolated (`astar`) paths are removed from the initial task context. Reviewer-added isolated nodes are not presented as candidate fragments. Each source has degree one in the full original segmentation graph and in the displayed crop; the candidate belongs to a different full-graph connected component. These conditions are verified during export and validation. The endpoint's unchecked status is a simulated pre-review condition, not a claim about its saved database flag. Original databases stay unchanged.

Example 01 uses source 2667 and candidate 2769; the recorded reference is the saved `tester` edge. Example 02 uses source 3814 and original-fragment candidate 3867. Its saved reviewer path is `[3814, 6740, 7473, 3867]`, with creators `tester`, `astar`, and `astar`. There is **no saved direct 3814–3867 edge** (`originalEdgePresent: false`). That path supports the same-fiber fragment-level acceptance reference; it does not establish a straight candidate line as a ground-truth geometric trace.

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

Source images are memory-mapped with `mode="r"`; SQLite databases are opened with `mode=ro`. Verification checks the complete encoded crop transforms, every exported graph coordinate, 32³ dimensions and endpoint centering, distinct source/candidate fragments, degree-one source topology, recorded reviewer-path provenance, published source fingerprints, and complete overview downsampling.
