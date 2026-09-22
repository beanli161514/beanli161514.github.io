# NeuroFly interactive demo data

The page combines T154 mouse whole-brain fluorescence and annotated neurons with RM009 macaque image-block context and local graph-review tasks. The local tasks present real 3D fluorescence crops and graph annotations through a **curated decision replay**. It demonstrates the structured graph-review workflow. It does not run model inference, change the source dataset, or train a model in the browser. Visitor choices are **unverified demo reviews**, never automatically validated training ground truth.

## RM009 source and attribution

**NeuroFly Neuron Reconstruction Dataset**, Zenodo, DOI [10.5281/zenodo.13328867](https://doi.org/10.5281/zenodo.13328867), August 15, 2024. The deposited creators are `Anonymous, Anonymous`; its public metadata specifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). These data are cropped, downsampled and quantized derivatives. Source software and annotation documentation: [NeuroFly](https://github.com/beanli161514/neurofly).

The source is `RM009_axons_2.tif`: a **1000 × 1000 × 300 uint16** macaque VISoR image block, with 300 million voxels and 600,166,090 file bytes. At the dataset owner's confirmed **1 µm per voxel** spacing, its physical extent is **1 × 1 × 0.3 mm**. It is a public sample block, not a whole brain or a terabyte dataset. The block overview is this same complete image downsampled. The T154 whole-brain context described below is a separate acquisition.

The source TIFF MD5 is `21e734a367969d84b93b7613d7a5f729`, matching the Zenodo file. The public annotation database MD5 is `df076171651054f04026a6e360fba765`. The bundled export is also compatible with a local annotation copy whose review flags differ, because all node coordinates, directed edges with provenance, and segment geometry match the public reference. The exporter verifies those fields against the independently recorded SHA256 fingerprint `7f194483dbb7ac8052e5b54542eac9c15c7b903dc7b447be970e0adcfabf385a`. It rejects other images or graphs rather than assigning these curated outcomes to arbitrary data.

The dataset is the source of image values and graph geometry. The standalone export code does not copy NeuroFly GPL-3.0 implementation modules into the browser renderer.

## RM009 runtime files

| File | Dimensions xyz | Compressed bytes | Purpose |
| --- | --- | ---: | --- |
| `data/fragment-connection-32-v3.u8.gz` | 32 × 32 × 32 | 13,080 | Fragment connection, source 2667 |
| `data/endpoint-selection-32-v3.u8.gz` | 32 × 32 × 32 | 8,330 | Endpoint selection, source 1194 |
| `data/point-proposal-32-v3.u8.gz` | 32 × 32 × 32 | 12,139 | Point proposal, source 4578 |
| `data/overview.u8.gz` | 100 × 100 × 30 | 66,734 | Complete source block, max pooled 10× per axis |

The four RM009 volume files total **100,283 compressed bytes**; the three task crops account for 33,549 bytes. A task crop expands to 32,768 uint8 bytes. `data/manifest.json` supplies source provenance, transforms, task prompts, graph geometry, and reference notes. Cases can be fetched independently and cached for later visits.

## Coordinates and rendering

Source graph coordinates and source TIFF arrays both use xyz, as documented in NeuroFly's annotation guide, despite the TIFF's generic `QYX` tag. Exported binary arrays use **uint8, C-order zyx**, with x varying fastest. Construct a WebGL volume texture with dimensions `shape[0], shape[1], shape[2]`. Local point coordinates satisfy `localXYZ = sourceXYZ − originXYZ`. Each task has a true 32³ source crop, with `origin = floor(sourceEndpointXYZ) − 16` (clamped only at source-volume boundaries). All three selected endpoints therefore lie at local `[16, 16, 16]`, and every candidate lies inside the crop.

The dataset owner confirmed **1 µm per voxel on all three axes**, consistent with [NeuroFly §5.1](https://arxiv.org/html/2411.04715v1#S5.SS1). The TIFF itself does not encode this calibration, so the manifest records it explicitly in `sourceVolume.voxelSizeUM: [1, 1, 1]`, `spacingCalibrated: true`, and `calibrationSource`. Each 32³ task is therefore a **32 × 32 × 32 µm** cube. Graph coordinates and `axes.spacing: [1, 1, 1]` remain in original voxel units; `axes.physicalSpacingUM` supplies the physical conversion. Overview spacing is `[10, 10, 10]` source voxels, equivalent to 10 µm per overview voxel. A source ROI maps onto the overview by division by ten.

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

The page stores a structured local record containing the task type, source, candidate set, selected candidate ID (if any), decision, review status and graph operation. Candidate endpoint selection and image-point proposal remain distinct operations. Records use `validation: "unverified-demo-review"`. An uncertain choice defers the case and leaves graph topology unchanged. The records remain in browser storage; **Reset session** clears them. The page does not expose a record-export button. This illustrates how standardized actions can support review and model-development queues; it is not online learning or automatic ingestion of public visitors' labels into training data.

## Training illustration

`src/neurofly-training.js` converts the selected task and a validated local review record into a candidate observation–action pair. Inputs reference the uint8 demo crop, its shape/origin/calibration, the ordered trajectory history, the initial fragment graph, and candidate IDs, kinds and coordinates. All coordinates are crop-local XYZ voxels. No reference answer, held-out reviewer edge, or post-decision graph is included in the observation.

The action space depends on the task: `[connect:B, reject-edge:B]` for binary connection; one `connect:<candidate>` class per endpoint; or one `extend:<candidate>` class per proposed point plus `stop` for None. The target stores the class index, stable action ID, operation, and candidate geometry where applicable. Rejecting an edge does not mark a true ending. Unselected candidates do not become permanent negative graph edges. Uncertain reviews retain no target. Task, candidate and revision mismatches are rejected before conversion, and decisive browser reviews retain `requires-validation` status.

The page shows these pairs as a supervision illustration, with no training or inference service. Its candidate tokens and structured action head are a proposed extension of NeuroFly's image/trajectory two-way attention model. The existing model predicts a 3D displacement from five trajectory positions and a rank/intensity image representation; the variable-length history and uint8 display crops here are not claimed to be its checkpoint-ready training tensors.

`media/autonomous-extension.mp4` is a 10.1-second, 101-frame recording converted from [NeuroFly's autonomous.gif](https://github.com/beanli161514/neurofly/blob/f32e7b3/assets/autonomous.gif). It shows recorded model-guided extension in desktop NeuroFly, not live browser inference. The 540 × 511 source is padded by one bottom pixel to 540 × 512 for H.264, at its original 10 fps. The 779,783-byte video has a fast-start header; its 24,982-byte WebP poster is shown before playback. The video loads when visible, loops with native playback/scrubbing controls, pauses offscreen or in a hidden tab, and respects reduced-motion preferences for automatic playback.

SHA256: source GIF `c176524aa6631ebfefee3a2658d37b013775bd96a59b018ee4d330829934977f`; MP4 `19194b81b1860699e80ba78429be775fb718938cd9944de0690b9179f123d70b`; poster `52812ff8b3edf56c5b8b9e8f8d36f2f9afae6f4663da69def592c7db8e63e66e`.

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

## T154 whole-brain microscopy and neurons

The whole-brain context is fluorescence microscopy from the user-provided **`T154_1um.ims`** and its corresponding **`T154_1um.db`** annotation database. It is a mouse acquisition, separate from the RM009 macaque block and local tasks. The yellow box shows a **1 × 1 × 0.3 mm** block at its physical scale in the T154 image; its position is illustrative, with no cross-acquisition registration claimed.

T154 source provenance is recorded separately from the public RM009 dataset. The RM009 Zenodo **CC BY 4.0** license is not asserted for the user-provided T154 image or annotation database. Metadata records the source filenames, the T154 database SHA256, the checksum of the valid low-resolution image data read from the IMS pyramid, and checksums of the generated assets. The full 279.9 GB IMS file is not hashed or read in full.

The displayed neurons are six genuine soma-bearing components from the T154 database. They are described as **annotated neurons**, not as complete or independently validated reconstructions. The whole-brain view shows all six together with a fixed display contrast; visitors can rotate, zoom, and reset the view.


### Image dimensions and browser assets

The IMS metadata calibrates the native grid to **12,000 × 8,000 × 13,200 voxels at 1 µm spacing**, covering **12 × 8 × 13.2 mm** with origin `[0, 0, 0]` µm. This is 1,267,200,000,000 native voxels, or **2,534,400,000,000 bytes (2.5344 TB)** as uncompressed uint16. The actual `T154_1um.ims` file is **279,897,933,302 bytes**. These are source-data dimensions; the browser does not load that native volume.

| Browser file | Contents | Compressed bytes | Decoded bytes |
| --- | --- | ---: | ---: |
| `data/t154-brain.json` | Image calibration, source pyramid metadata, transforms, checksums and block placement | — | JSON metadata |
| `data/t154-brain-v1.u8.gz` | 188 × 125 × 207 uint8 fluorescence overview | 2,092,344 | 4,864,500 |
| `data/t154-neurons-v1.json.gz` | Six annotated neuron skeletons with source provenance | 120,492 | 318,558 |
| `data/t154-neurons.json` | Readable skeleton metadata, per-neuron statistics and asset checksum | — | JSON metadata |

The brain volume is **uint8, C-order zyx, with x varying fastest**. Its isotropic spacing is **64 µm**, with an enclosing output extent of **12.032 × 8 × 13.248 mm**. The extra 32 µm in x and 48 µm in z are output-grid padding, not additional specimen extent.

The image exporter reads only the valid **187 × 125 × 206** voxels from `DataSet/ResolutionLevel 6/TimePoint 0/Channel 0/Data`: **9,630,500 bytes** of uint16. This channel is named `488`. The stored HDF5 array has padding; the export uses the level's `ImageSizeXYZ` attributes to exclude it. The level's calibrated spacing is approximately `[64.1711, 64, 64.0777]` µm, so linear interpolation resamples it onto the isotropic 64 µm output grid. Samples outside the valid grid are zero. Display quantization maps intensities from zero to the resampled image's 99.8th percentile (355.413818359375) into 0–255, clipping above that threshold. No fluorescence or neuron geometry is synthesized.

### Image and neuron coordinates

Native graph coordinates are voxel-center indices in xyz. The image, neuron positions, and block outline share the calibrated physical space:

```text
physicalXYZ_um = (nativeXYZ + 0.5) × 1
brainOverviewXYZ = (nativeXYZ + 0.5) / 64 − 0.5
physicalXYZ_um = (brainOverviewXYZ + 0.5) × 64
```

There is no axis permutation or reflection. The metadata records `affineSourceVoxelToOverview`, the source-pyramid resampling affine, native/output physical bounds, and the corresponding skeleton transform.

The yellow block is **15.625 × 15.625 × 4.6875 overview voxels**, exactly **1 × 1 × 0.3 mm** at 64 µm spacing. Its center is native `[8046, 1843, 4668]`, the soma of the largest displayed T154 component, equivalent to physical `[8.0465, 1.8435, 4.6685]` mm. The exporter verifies that an expanded box around this placement lies within the fluorescence image's tissue signal. This supplies an illustrative location inside T154; it does not establish any anatomical correspondence to RM009.

### Annotated neuron selection and simplification

The source database contains **217,524 visible nodes**, 178,887 unique undirected edges after normalizing reciprocal rows and removing three self-loops, and six explicitly marked somata. The export selects the six connected components with exactly one `type=1` soma and `tester`-created nodes, ordered by source node count. `tester` is the annotation GUI's default username, not a named or independently verified reviewer.

| Display label | Soma node ID | Source nodes | Display nodes | Checked terminals |
| --- | ---: | ---: | ---: | ---: |
| Neuron 1 | 211485 | 7,659 | 693 | 86 |
| Neuron 2 | 214856 | 4,960 | 443 | 37 |
| Neuron 3 | 214866 | 4,560 | 399 | 20 |
| Neuron 4 | 155119 | 3,401 | 325 | 21 |
| Neuron 5 | 216068 | 2,967 | 303 | 27 |
| Neuron 6 | 217410 | 1,941 | 161 | 11 |
| **Total** | | **25,488** | **2,324** | **202** |

All 202 terminal nodes have `checked=1`; many automatically extracted interior nodes have `checked=0`. This is evidence of endpoint review, not certification that each entire neuron is complete or error-free. The runtime metadata explicitly records `completeness: "not-asserted"`.

Display simplification uses **Ramer–Douglas–Peucker with a 4 µm tolerance on degree-two chains only**. Every soma, branch node, terminal node, and branch connection is retained, along with the exact native coordinates of every retained point. The displayed graph has 2,324 nodes and 2,318 edges; no new connection is inferred. Each neuron's `positionsXYZ` aligns with `sourceNodeIds`; `edgeSourceNodeIds` retains the original node-ID path represented by each display edge. `nodeTypes`, `nodeChecked`, `nodeCreators`, source/display statistics, and annotation evidence remain available in the compressed JSON.

The database SHA256 is `82bb10bc76be19f6cdb01251dca65d5c2dad3635861ef8b5acb291f85e0e6509`. Image and skeleton asset checksums are recorded in [t154-brain.json](data/t154-brain.json) and [t154-neurons.json](data/t154-neurons.json).

### Reproduce T154 assets

Use the matching `T154_1um.ims` and `T154_1um.db` sources. Both exporters open their source data read-only; the brain exporter reads the existing low-resolution pyramid without reading native-resolution image data.

```sh
python -m pip install h5py numpy scipy
python scripts/export_t154_brain.py --source /path/to/T154/T154_1um.ims
python scripts/export_t154_neurons.py --source /path/to/T154/T154_1um.db
```

Both default to `public/neurofly/data` and accept `--out /path/to/demo-data`. The skeleton exporter accepts `--tolerance-um 4` and `--overview-spacing-um 64`; the latter must match the brain overview's spacing. Optional brain QA projections require Pillow:

```sh
python -m pip install pillow
python scripts/export_t154_brain.py --source /path/to/T154/T154_1um.ims --qa /path/to/qa
```

The brain metadata records measured source extents, source-level/asset checksums, decoded byte counts, coordinate transforms, and the physical block placement. The skeleton metadata records source database counts and checksum, selected components, source-ID paths, retained topology, and measured simplification error.
