# Ear demo data, version 1

A trial consists of one synchronized MP4 and one compressed 3D array. A shared manifest stores calibration, point topology, and timing. The shape-model sandbox has its own small shared JSON file.

```
data/
  manifest.json           # timeline, cameras, point layout, trial list
  trial-1.mp4             # BC L R / TC TL TR, 1440 × 768, 100 fps
  trial-1.filled.f32.gz          # gzip-compressed float32 XYZ, little endian
  trial-1.jpg             # first-frame poster
  trial-2.{mp4,filled.f32.gz,jpg}
  trial-3.{mp4,filled.f32.gz,jpg}
  shape-model.json        # left/right mean curves and 15 PCA displacement modes
```

## Timing

Source: `20250110_B41_USV_awake_000_17-57-18`. Source frames are zero-based. Ranges are **start-inclusive, end-exclusive**:

| Trial | Source range | Frames | Duration |
|---|---:|---:|---:|
| 01 | [16300, 16800) | 500 | 5.00 s |
| 02 | [46700, 47000) | 300 | 3.00 s |
| 03 | [13400, 13650) | 250 | 2.50 s |

Every source frame is retained. Video frame `i`, geometry frame `i`, and source frame `start + i` are the same instant. The MP4 starts at time zero, at 100 fps, with no audio. `floor(mediaTime * fps + 1e-5)` selects a frame, clamped to `[0, frames-1]`. Seeking targets the interior of a frame interval. Playback uses `requestVideoFrameCallback` when supported. The video image and 2D overlays are painted together into one canvas; the same frame updates the 3D scene. Slower displays may skip presented frames, but the views share the same clock. A `requestAnimationFrame`/`currentTime` fallback is provided for older browsers and does not have decoded-frame timestamp precision.

## Track layout

After gzip decompression, interpret the buffer as little-endian Float32, shaped `[frames, 169, 3]` in C order. Each frame is 2,028 bytes:

- Points 0–18: face landmarks, in `manifest.face.names` order.
- Points 19–93: 75 samples of the left ear rim, an **open** curve.
- Points 94–168: 75 samples of the right ear rim, an **open** curve.

For point `p` in local frame `i`, XYZ starts at byte `4 * 3 * (169*i + p)`. Missing face landmarks are linearly interpolated in calibration-space XYZ between valid observations, using the full recording before extracting each trial. Gaps up to 50 frames (0.5 s) are filled; unbounded or longer gaps remain NaN and their segments are omitted. All missing face landmarks in these three trials were filled. Valid observations and ear curves are unchanged; no smoothing filter is applied. `face.interpolation` records this policy, and each trial’s `faceInterpolation` stores `filledPoints` and `[landmarkIndex, localStart, localEndExclusive]` runs for provenance. Face landmarks retain the desktop loader's minimum two cameras and score ≥ 0.5 filter. Their head-centered coordinates are restored to calibration coordinates with the recording's per-frame transform.

Example decode:

```js
const response = await fetch('data/trial-1.filled.f32.gz');
const bytes = new Uint8Array(await response.arrayBuffer());
// Some hosts send Content-Encoding: gzip, causing automatic HTTP decompression.
const raw = bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes) : bytes;
const xyz = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
```

## Calibration and overlays

`cameras` lists `BC, L, R, TC, TL, TR` in row-major video tile order. Each entry contains flat row-major 3×3 matrices `K` and `R`, 3-vector `t`, OpenCV distortion coefficients, camera center, and four visualization frustum corners. All 3D arrays remain in the source calibration coordinate system and its length units.

`X_camera = R * X_world + t`; camera center is `-Rᵀ * t`. Intrinsics are scaled from the calibration file to the source video's 1280 × 1024 pixels. Projection includes radial/tangential distortion, then scales the result to a 480 × 384 tile. Camera frustums use undistorted corner rays; their display depth is shortened for readability, not a measured near/far clipping range. They preserve physical camera positions and orientations.

There are no redundant 2D tracks: the browser projects the same 3D points it renders. Face connections and per-landmark colors are shared in the manifest. These are reconstructed projections, not independent ground-truth annotations. The face is a landmark skeleton, not a dense surface mesh.

## PCA sandbox

`shape-model.json` comes from `ear_pca_sim3_global_10mouse_pc15.npz`, the production model used by `vis_pca.py`. For each ear:

- `mean`: 225 floats, the 75 XYZ samples of the mean curve at reference physical scale.
- `modes`: 15 arrays of 225 floats; each array already includes its standard deviation and the same reference-scale factor.
- `variance`: explained-variance ratios; the first 15 entries correspond to the sliders.
- `points`: 75.

```
curve = mean + Σ coefficient[k] * modes[k]
```

Sliders range from −3 to +3 standard deviations. The export applies the exact desktop formula `(mu + pcs @ (alpha * sig)) * length_ref / arc_length(mu)`. There is no extra recentering, rotation, or per-deformation scale normalization. Left/right coefficients are independent; Reset all zeros both. This is an exploration of the learned prior, separate from recorded trial reconstructions.

## Rebuild

`python scripts/export_demo.py --repo /path/to/ear_recon --dataset /path/to/recording --out public/data`

Use the `mesh` conda environment with NumPy, OpenCV, the maintained repo's viewer dependencies, and ffmpeg on PATH. Export reads `ear_curves_global.json`, the face CSV, six source videos, calibration, and the production PCA checkpoint. It does not need inference checkpoints or source videos in the published website.
