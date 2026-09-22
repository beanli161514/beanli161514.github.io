#!/usr/bin/env python3
"""Export the real T154 whole mouse brain from its existing IMS pyramid.

Only valid voxels in ResolutionLevel 6 are read (about 10 MB of uint16 data).
No full-resolution image data are read or changed. Output is isotropic 64 µm.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import h5py
import numpy as np
from scipy.ndimage import affine_transform

DEFAULT_OUT = Path(__file__).resolve().parents[1]/'public'/'neurofly'/'data'


def text_attribute(value):
    return b''.join(value).decode() if hasattr(value, '__iter__') and not isinstance(value, str) else str(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Path to T154_1um.ims')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--qa', type=Path, help='Optional orthogonal MIP PNG output directory')
    args = parser.parse_args()
    with h5py.File(args.source, 'r') as source:
        image = {key: text_attribute(value) for key, value in source['DataSetInfo/Image'].attrs.items()}
        if image['Unit'] != 'um':
            raise ValueError('Expected explicitly calibrated micrometer image extents')
        minimum = np.array([float(image[f'ExtMin{i}']) for i in range(3)])
        maximum = np.array([float(image[f'ExtMax{i}']) for i in range(3)])
        extent = maximum-minimum
        native_shape = np.array([int(image[axis]) for axis in ('X', 'Y', 'Z')])
        native_spacing = extent/native_shape
        if not np.allclose(native_spacing, 1):
            raise ValueError('Expected T154 native 1 µm spacing')
        group_path = 'DataSet/ResolutionLevel 6/TimePoint 0/Channel 0'
        group = source[group_path]
        input_shape = np.array([int(text_attribute(group.attrs[f'ImageSize{axis}'])) for axis in ('X', 'Y', 'Z')])
        input_spacing = extent/input_shape
        stored_shape = list(group['Data'].shape)
        # IMS datasets include padding; valid ImageSizeXYZ attributes take precedence.
        raw = group['Data'][:input_shape[2], :input_shape[1], :input_shape[0]]
        channel = {key: text_attribute(value) for key, value in source['DataSetInfo/Channel 0'].attrs.items()}
    output_spacing = np.array([64.0]*3)
    output_shape = np.ceil(extent/output_spacing).astype(int)
    # Physical extents are voxel boundaries. Sample j has center origin+s*(j+.5).
    matrix_xyz = output_spacing/input_spacing
    offset_xyz = output_spacing*.5/input_spacing-.5
    resampled = affine_transform(
        raw.astype(np.float32), np.diag(matrix_xyz[::-1]), offset=offset_xyz[::-1],
        output_shape=tuple(output_shape[::-1]), order=1, mode='constant', cval=0, prefilter=False,
    )
    low, high = 0.0, float(np.percentile(resampled, 99.8))
    display = np.rint(np.clip((resampled-low)/(high-low), 0, 1)*255).astype(np.uint8)
    payload = display.tobytes(order='C')
    args.out.mkdir(parents=True, exist_ok=True)
    volume_path = args.out/'t154-brain-v1.u8.gz'
    with volume_path.open('wb') as output:
        with gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=0, compresslevel=9) as archive:
            archive.write(payload)
    # Largest soma-bearing component in the corresponding T154 graph; real specimen location.
    # The separate RM009 teaching block is only illustratively placed at this location.
    center_native = np.array([8046.0, 1843.0, 4668.0])
    center_overview = ((center_native+.5)*native_spacing)/output_spacing-.5
    block_size_mm = np.array([1.0, 1.0, .3])
    block_size_voxels = block_size_mm*1000/output_spacing
    lo = np.floor(center_overview-block_size_voxels/2).astype(int)
    hi = np.ceil(center_overview+block_size_voxels/2).astype(int)+1
    roi = resampled[lo[2]:hi[2], lo[1]:hi[1], lo[0]:hi[0]]
    if not np.all(lo >= 0) or not np.all(hi <= output_shape) or float(roi.min()) <= 130:
        raise ValueError('Proposed full 1 × 1 × .3 mm block is not in the expected tissue interior')
    graph_affine = np.eye(4)
    graph_affine[:3, :3] = np.diag(native_spacing/output_spacing)
    graph_affine[:3, 3] = .5*native_spacing/output_spacing-.5
    input_affine = np.eye(4)
    input_affine[:3, :3] = np.diag(matrix_xyz)
    input_affine[:3, 3] = offset_xyz
    native_bounds = {'minUM': minimum.tolist(), 'maxUM': maximum.tolist()}
    overview_bounds = {'minUM': minimum.tolist(), 'maxUM': (minimum+output_shape*output_spacing).tolist()}
    metadata = {
        'schemaVersion': 1, 'kind': 'whole-brain-fluorescence', 'specimen': 'T154',
        'title': 'T154 whole mouse brain fluorescence', 'volume': volume_path.name,
        'shape': output_shape.tolist(), 'shapeXYZ': output_shape.tolist(),
        'spacingMM': (output_spacing/1000).tolist(), 'spacingUM': output_spacing.tolist(),
        'physicalExtentMM': (output_shape*output_spacing/1000).tolist(),
        'nativePhysicalExtentMM': (extent/1000).tolist(), 'originUM': minimum.tolist(),
        'sourcePixelCenterOffset': .5, 'outputPixelCenterOffset': .5,
        'nativePhysicalBounds': native_bounds, 'overviewPhysicalBounds': overview_bounds,
        'voxelLayout': 'uint8, C-order zyx, x varies fastest', 'axes': ['X', 'Y', 'Z'],
        'sourceFilename': args.source.name, 'sourceFileBytes': args.source.stat().st_size,
        'sourceImageSizeXYZ': native_shape.tolist(), 'sourceVoxelSizeUM': native_spacing.tolist(),
        'sourceNativeVoxelCount': int(np.prod(native_shape)),
        'sourceNativeUncompressedBytes': int(np.prod(native_shape)*2),
        'sourceDataset': group_path+'/Data', 'sourceLevel': 6,
        'sourceLevelShapeXYZ': input_shape.tolist(), 'sourceLevelStoredShapeZYX': stored_shape,
        'sourceLevelSpacingUM': input_spacing.tolist(), 'sourceChannel': channel['Name'],
        'sourceEmissionWavelengthNM': int(channel['LSMEmissionWavelength']),
        'sourceLowResolutionReadBytes': int(raw.nbytes),
        'sourceLowResolutionSHA256': hashlib.sha256(raw.tobytes()).hexdigest(),
        'affineSourceVoxelToOverview': graph_affine.tolist(),
        'affineOverviewVoxelToSourceLevel': input_affine.tolist(),
        'coordinateTransform': {
            'nativeGraphToOverview': '(nativeXYZ + 0.5) / 64 - 0.5',
            'nativeGraphToPhysicalUM': 'originUM + (nativeXYZ + 0.5) * sourceVoxelSizeUM',
            'overviewIndexToPhysicalUM': 'originUM + (overviewXYZ + 0.5) * spacingUM',
            'axes': 'Native xyz preserved; source IMS array and exported bytes are zyx. No axis flips.',
            'boundaryConvention': 'IMS ExtMin/ExtMax are treated as voxel-grid physical boundaries.',
        },
        'compressedBytes': volume_path.stat().st_size, 'decodedBytes': len(payload),
        'volumeSHA256': hashlib.sha256(volume_path.read_bytes()).hexdigest(),
        'resampling': {
            'method': 'Linear interpolation from the existing calibrated ResolutionLevel 6 pyramid to isotropic 64 µm grid.',
            'padding': 'Zero outside the valid source-level grid; output grid encloses the native extents.',
            'intensityMapping': {'low': low, 'high': high, 'highPercentile': 99.8, 'outputType': 'uint8',
                                 'note': 'Linear display quantization; no synthetic fluorescence or image enhancement.'},
        },
        'illustrativeBlockCenterXYZ': center_overview.tolist(),
        'illustrativeBlockCenterNativeXYZ': center_native.tolist(),
        'illustrativeBlockCenterMM': ((minimum+(center_native+.5)*native_spacing)/1000).tolist(),
        'illustrativeBlockSizeMM': block_size_mm.tolist(),
        'illustrativeBlockSizeOverviewVoxels': block_size_voxels.tolist(),
        'insideTissueCheck': {'method': 'All samples in an expanded bounding box exceed raw intensity threshold 130.',
                              'minimumRawIntensity': float(roi.min()), 'fifthPercentileRawIntensity': float(np.percentile(roi, 5)),
                              'threshold': 130, 'expandedBoundsXYZ': [lo.tolist(), hi.tolist()]},
        'registration': {'registeredToMicroscopy': False,
                         'location': 'Block is centered at a real T154 soma inside tissue. Placement of the separate RM009 task sample is illustrative only.',
                         'scale': 'T154 image and neuron coordinates share native calibrated micrometer space. Yellow block has true physical dimensions 1 × 1 × 0.3 mm.'},
        'attribution': {'title': 'T154 whole mouse brain fluorescence volume', 'source': 'Dataset supplied by the user.',
                        'modifications': 'Existing low-resolution pyramid resampled to isotropic 64 µm and quantized for browser display.'},
        'preferredView': 'xz',
    }
    (args.out/'t154-brain.json').write_text(json.dumps(metadata, indent=2)+'\n')
    # Validate serialized data, shape, source transform, and the exact physical block size.
    assert len(gzip.decompress(volume_path.read_bytes())) == int(np.prod(output_shape))
    assert np.allclose(graph_affine@np.r_[center_native, 1], np.r_[center_overview, 1])
    assert np.allclose(block_size_voxels*output_spacing/1000, [1, 1, .3])
    if args.qa:
        from PIL import Image, ImageDraw
        args.qa.mkdir(parents=True, exist_ok=True)
        xyz = display.transpose(2, 1, 0)
        panels = []
        for name, axis, dimensions in [('xy', 2, (0, 1)), ('xz', 1, (0, 2)), ('yz', 0, (1, 2))]:
            panel = Image.fromarray(xyz.max(axis=axis).T).convert('RGB')
            draw = ImageDraw.Draw(panel)
            center = center_overview[list(dimensions)]
            half = block_size_voxels[list(dimensions)]/2
            draw.rectangle((center[0]-half[0], center[1]-half[1], center[0]+half[0], center[1]+half[1]), outline=(255, 204, 40), width=1)
            panel.resize((panel.width*4, panel.height*4)).save(args.qa/('t154-'+name+'.png'))
    print(json.dumps({key: metadata[key] for key in ['shape', 'spacingMM', 'physicalExtentMM', 'compressedBytes',
                                                    'sourceLowResolutionReadBytes', 'illustrativeBlockCenterXYZ', 'insideTissueCheck']}, indent=2))


if __name__ == '__main__':
    main()
