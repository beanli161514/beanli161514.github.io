"""Fill short, bounded gaps in 3D face tracks without changing valid samples."""
import numpy as np

MAX_GAP_FRAMES = 50

def interpolate_landmarks(xyz, max_gap_frames=MAX_GAP_FRAMES):
    """Interpolate XYZ jointly; never extrapolate or bridge long missing runs.

    Pass the full recording before slicing trials so clip boundaries can use
    surrounding observations. Partially finite XYZ counts as a missing point.
    """
    result = np.asarray(xyz, dtype=np.float32).copy()
    if result.ndim != 3 or result.shape[2] != 3:
        raise ValueError('Expected [frames, landmarks, 3]')
    filled = np.zeros(result.shape[:2], dtype=bool)
    for point in range(result.shape[1]):
        valid = np.isfinite(result[:, point]).all(axis=1)
        changes = np.diff(np.r_[False, ~valid, False].astype(np.int8))
        for start, end in zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)):
            if start == 0 or end == len(result) or end - start > max_gap_frames:
                continue
            weight = np.arange(1, end-start+1, dtype=np.float64)[:, None] / (end-start+1)
            left = result[start-1, point].astype(np.float64)
            right = result[end, point].astype(np.float64)
            result[start:end, point] = left + weight * (right-left)
            filled[start:end, point] = True
    return result, filled

def interpolation_metadata(filled, start, end):
    """Compact provenance: [landmark index, local start, exclusive local end]."""
    mask = filled[start:end]
    runs = []
    for point in range(mask.shape[1]):
        changes = np.diff(np.r_[False, mask[:, point], False].astype(np.int8))
        runs.extend([point, int(a), int(b)] for a,b in zip(np.flatnonzero(changes==1),np.flatnonzero(changes==-1)))
    return dict(filledPoints=int(mask.sum()), runs=runs)
