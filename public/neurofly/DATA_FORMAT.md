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
| `data/fragment-connection-32-v3.u8.gz` | 32 × 32 × 32 | 13,080 | Fragment connection, source 2667 |
| `data/endpoint-selection-32-v3.u8.gz` | 32 × 32 × 32 | 8,330 | Endpoint selection, source 1194 |
| `data/point-proposal-32-v3.u8.gz` | 32 × 32 × 32 | 12,139 | Point proposal, source 4578 |
| `data/overview.u8.gz` | 100 × 100 × 30 | 66,734 | Complete source block, max pooled 10× per axis |

The four volume files total **100,283 compressed bytes**; the three task crops account for 33,549 bytes. A task crop expands to 32,768 uint8 bytes. `data/manifest.json` supplies source provenance, transforms, task prompts, graph geometry, and reference notes. Cases can be fetched independently and cached for later visits.

## Coordinates and rendering

Source graph coordinates and source TIFF arrays both use xyz, as documented in NeuroFly's annotation guide, despite the TIFF's generic `QYX` tag. Exported binary arrays use **uint8, C-order zyx**, with x varying fastest. Construct a WebGL volume texture with dimensions `shape[0], shape[1], shape[2]`. Local point coordinates satisfy `localXYZ = sourceXYZ − originXYZ`. Each task has a true 32³ source crop, with `origin = floor(sourceEndpointXYZ) − 16` (clamped only at source-volume boundaries). All three selected endpoints therefore lie at local `[16, 16, 16]`, and every candidate lies inside the crop.

The TIFF does not contain physical spacing calibration. `spacing: [1, 1, 1]` means voxel coordinates, not micrometers. Overview spacing is `[10, 10, 10]` source voxels. A source ROI therefore maps onto the overview by division by ten.

Display intensities use **8-bit display quantization**. Each crop maps its original uint16 30th and 99.95th intensity percentiles linearly to 0–255, clipping outside that range. The manifest retains the thresholds and original min/max. The overview first takes maxima over 10×10×10 source voxels, then maps its 30th and 99.7th percentiles to 0–255. These operations add no signal and perform no deconvolution.

## Manifest schema

`schemaVersion: 3`, `dataRevision: 3`, and `revision: "three-task-types-32-v3"` identify this format. The manifest uses `kind: "curated-decision-replay"`; top-level fields include `provenance`, `sourceVolume`, `axes`, `taskDesign`, `overview`, and `tasks`. Cached visitor reviews must be namespaced by this revision so votes on an earlier candidate are not transferred to a new one.

Each task contains the volume transform and provenance, original `nodes` and `edges`, source endpoint and trajectory history, and a **`candidates` array**. Runtime selection must use the selected candidate's stable string `id` (`b`, `c`, or `d`). Top-level `targetId` and `targetPosition` are transitional aliases for the first candidate only; `targetId` is null for an image-point proposal.

| Field | Meaning |
| --- | --- |
| `taskType` | `fragment-connection`, `endpoint-selection`, or `point-proposal` |
| `sourceId`, `sourcePosition`, `sourceDegree`, `sourceFragmentId` | Original degree-one source endpoint and its full-graph fragment |
| `historyNodeIds`, `history`, `incomingVector` | Up to five preceding original segmentation nodes, ordered toward the endpoint, and the incoming unit direction |
| `candidates` | Stable ID/label, `nodeId` or null, local xyz, `kind`, measured distance, direction cosine, original intensity, and provenance |
| `candidateGeneration` | Endpoint search radius or explicit image-maximum selection parameters |
| `nearbyEndpointCount`, `nearbyEndpointIds` | Other-fragment endpoints found in the full original graph within the declared radius |
| `allowsNone`, `noneMeaning`, `allowsUncertain` | None is available only for point proposal and means a true ending; uncertainty is independent |
| `centerReviewStatus`, `replayState` | Simulated unchecked state plus the actual saved source review flag |
| `heldOutReviewerEdges`, `reviewerPath`, `reviewerPathEdges` | Excluded reviewer edits and any documented reference path |
| `referenceDecision`, `referenceCandidateId`, `referenceNote` | Verified saved reference where available; null otherwise |

Graph nodes contain only original segmentation nodes, with `{id, position, component}`. Full original-graph component IDs are calculated before cropping. Edges are undirected ID pairs, listed once. A candidate `kind: "fragment-endpoint"` references an existing node in another component. An `"image-point"` has `nodeId: null` and is only a proposed measured location, never an existing node fabricated into the initial graph.

## Three task types

All three tasks begin at a degree-one endpoint of the full original segmentation graph. The local state treats that endpoint as unchecked for replay. This is explicitly simulated; it does not replace the actual `savedSourceChecked` database flag. Initial context contains only `seger` edges and their original nodes. All reviewer `tester` joins and interpolated `astar` paths are excluded.

1. **Fragment connection.** Source 2667 and candidate 2769 form one proposed connection between original fragments. The actions are accept, reject, or uncertain. The saved `tester` edge is the verified reference for this example. The pair is curated; other endpoints can exist nearby without being presented as additional options in this task type.
2. **Endpoint selection.** Source 1194 has three candidate endpoints in distinct other fragments: 1334 (B), 1193 (C), and 619 (D), at distances 3.74, 4.12, and 11.22 voxels. Candidates are degree-one nodes found within a **12-voxel Euclidean radius**, ordered by distance with at most one endpoint per other fragment. The action selects one candidate or records uncertainty. There is no None/true-ending choice for this type, and no validated target selection is assigned to the demo.
3. **Point proposal.** Source 4578 has **zero endpoints from other fragments within 12 voxels**, verified against all 474 original endpoints. Three measured image maxima are proposed because there is no nearby graph endpoint to select. A chosen point can extend the local trajectory. **None means a true ending**; uncertainty remains a separate response. None of the proposed points is asserted to be a ground-truth continuation.

Point proposals use the original uint16 image before display quantization. A candidate must be a maximum in its **3×3×3 voxel neighborhood**, at least as bright as the crop's 95th intensity percentile, **5–10 voxels** from the source, and inside a **75° forward cone** around the incoming direction. Candidates are ranked by `(intensity − crop median) × (0.3 + 0.7 × direction cosine)`, then separated by at least **3 voxels** and **20° of bearing**. No peak coordinates or fluorescence values are synthesized.

For the selected point-proposal crop, B/C/D are local `[8,18,14]`, `[12,20,14]`, and `[9,22,17]`. Distances are 8.49, 6.00, and 9.27 voxels; original intensities are 4944, 2720, and 2416. Pairwise bearings differ by approximately 26–33°. The manifest records the precise thresholds and measured metrics for reproducibility.

## Visitor review records

The page exports a structured local record containing the task type, source, candidate set, selected candidate ID (if any), decision, review status and graph operation. Candidate endpoint selection and image-point proposal remain distinct operations. Records use `validation: "unverified-demo-review"`. An uncertain choice defers the case and leaves graph topology unchanged. This illustrates how standardized actions could feed review and model-development queues; it is not online learning or automatic ingestion of public visitors' labels into training data.

## Reproduce

Run from the source repository. The source directory must contain the publicly released `RM009_axons_2.tif` and corresponding `RM009_axons_2.db` (or its verified geometry-equivalent working copy).

```sh
python -m pip install numpy scipy tifffile
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

Source images are memory-mapped with `mode="r"`; SQLite databases are opened with `mode=ro`. Verification checks the complete encoded crop transforms, every exported graph coordinate, 32³ dimensions and endpoint centering, distinct fragment endpoint candidates, degree-one source topology, exhaustive nearby-endpoint searches, source-voxel intensities and local maxima, radial/cone/separation constraints, saved reference provenance, published fingerprints, and complete overview downsampling.
