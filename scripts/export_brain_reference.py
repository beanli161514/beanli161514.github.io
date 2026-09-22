#!/usr/bin/env python3
"""Create the calibrated INIA19 MRI context volume used by the web demo.

Dependencies: numpy scipy nibabel; Pillow only with --qa.
Download INIA19 1.0.1 (CC BY 3.0) from https://www.nitrc.org/projects/inia19/
and extract inia19-t1-brain.nii. No microscopy registration is performed.

python scripts/export_brain_reference.py --source /path/to/inia19-t1-brain.nii
"""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage


SOURCE_SHA256 = '4858a08ff3f3246a15515d7c2f83694a6639f84c5ce90d922953f24ce31b0a64'
SOURCE_AFFINE_MM = np.array([[.5, 0, 0, -42], [0, .5, 0, -57.5], [0, 0, .5, -30], [0, 0, 0, 1]])
PAPER_URL = 'https://www.frontiersin.org/journals/neuroinformatics/articles/10.3389/fninf.2012.00027/full'


def export(source, out, spacing_mm=1.0, qa=None):
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if source_hash != SOURCE_SHA256:
        raise ValueError('Expected the released INIA19 1.0.1 inia19-t1-brain.nii; source checksum differs.')
    image = nib.load(source)
    volume = np.squeeze(image.get_fdata(dtype=np.float32))
    source_spacing = np.array(image.header.get_zooms()[:3], dtype=float)
    if volume.shape != (168, 206, 128) or not np.allclose(image.affine, SOURCE_AFFINE_MM):
        raise ValueError('Unexpected INIA19 dimensions or affine.')
    if spacing_mm < .5 or spacing_mm > 2:
        raise ValueError('Use isotropic output spacing between 0.5 and 2 mm.')

    # The released brain-only template is zero outside the brain. Keep every
    # nonzero source voxel, with two source voxels of margin on every side.
    mask = volume > 0
    occupied = np.argwhere(mask)
    low, high = occupied.min(axis=0), occupied.max(axis=0) + 1
    crop_low, crop_high = low - 2, high + 2
    crop_extent_mm = (crop_high - crop_low) * source_spacing
    shape = np.ceil(crop_extent_mm / spacing_mm).astype(int)
    # This released template is axis-aligned RAS (checked above), so physical
    # coordinates are a per-axis scale and translation without reorientation.
    low_corner_mm = (crop_low - .5) * source_spacing + image.affine[:3, 3]
    affine = np.diag([spacing_mm, spacing_mm, spacing_mm, 1.0])
    affine[:3, 3] = low_corner_mm + spacing_mm / 2
    output_to_source = np.linalg.inv(image.affine) @ affine
    sigma = np.maximum(0, (spacing_mm / source_spacing - 1) / 2)
    filtered = ndimage.gaussian_filter(volume, sigma=sigma, mode='constant', cval=0)
    resampled = ndimage.affine_transform(
        filtered, output_to_source[:3, :3], offset=output_to_source[:3, 3],
        output_shape=tuple(shape), order=1, mode='constant', cval=0, prefilter=False,
    )
    display_high = float(np.percentile(volume[mask], 99.8))
    encoded_xyz = np.rint(np.clip(resampled / display_high, 0, 1) * 255).astype(np.uint8)
    raw = encoded_xyz.transpose(2, 1, 0).copy().tobytes()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    filename = 'brain-overview-v1.u8.gz'

    # A reproducible point a few millimeters inside the right lateral surface.
    # It locates the illustrative scale box only, never the actual VISoR sample.
    distance_inside = ndimage.distance_transform_edt(mask, sampling=source_spacing)
    possible = np.argwhere((distance_inside >= 1.5) & (distance_inside <= 3.0))
    possible_mm = possible * source_spacing + image.affine[:3, 3]
    preferred_mm = np.array([24.0, 0.0, 8.0])
    choice = int(np.argmin(np.sum((possible_mm - preferred_mm) ** 2, axis=1)))
    block_center_mm = possible_mm[choice]
    block_center_xyz = (block_center_mm - affine[:3, 3]) / spacing_mm

    metadata = {
        'schemaVersion': 1,
        'kind': 'anatomical-scale-reference',
        'title': 'INIA19 rhesus macaque brain MRI reference',
        'volume': filename,
        'shape': shape.tolist(),
        'shapeXYZ': shape.tolist(),
        'spacingMM': [spacing_mm] * 3,
        'physicalExtentMM': (shape * spacing_mm).tolist(),
        'affineVoxelToRASMM': affine.tolist(),
        'voxelLayout': 'uint8, C-order zyx, x varies fastest',
        'axes': ['R', 'A', 'S'],
        'sourceFilename': source.name,
        'sourceDistribution': 'INIA19 1.0.1',
        'sourceSHA256': source_hash,
        'sourceShapeXYZ': list(volume.shape),
        'sourceVoxelSpacingMM': source_spacing.tolist(),
        'sourceAffineVoxelToRASMM': image.affine.tolist(),
        'sourceNiftiSpatialUnit': image.header.get_xyzt_units()[0],
        'physicalUnitEvidence': {
            'url': PAPER_URL,
            'section': '3.1 Image file format and coordinates',
            'note': 'The source NIfTI unit code is unset. The authors explicitly document this exact grid as 0.5 mm isotropic, RAS, with AC-origin physical coordinates; these establish the millimeter units of its affine.',
        },
        'sourceBrainBoundsVoxelXYZ': {'min': low.tolist(), 'maxExclusive': high.tolist()},
        'sourceBrainExtentMM': ((high - low) * source_spacing).tolist(),
        'compressedBytes': len(compressed),
        'decodedBytes': len(raw),
        'volumeSHA256': hashlib.sha256(compressed).hexdigest(),
        'transform': {
            'sourceCropMinXYZ': crop_low.tolist(),
            'sourceCropMaxExclusiveXYZ': crop_high.tolist(),
            'marginSourceVoxels': 2,
            'boundaryPolicy': 'Zero outside the source image; output grid encloses the full brain bounding box and margin.',
            'outputToSourceVoxelAffine': output_to_source.tolist(),
            'resampling': 'Gaussian anti-alias filter followed by linear interpolation on an isotropic physical grid.',
            'gaussianSigmaSourceVoxels': sigma.tolist(),
            'intensityMapping': {'low': 0, 'high': display_high, 'highPercentileOfNonzeroSource': 99.8, 'outputType': 'uint8'},
        },
        'illustrativeBlockCenterXYZ': block_center_xyz.tolist(),
        'illustrativeBlockCenterRASMM': block_center_mm.tolist(),
        'illustrativeBlockSizeMM': [1, 1, .3],
        'registration': {
            'registeredToMicroscopy': False,
            'location': 'Illustrative only; not the anatomical location of the RM009 microscopy sample.',
            'scale': 'Reference anatomy retains physical millimeter spacing. Microscopy block dimensions use the user-confirmed 1 micrometer isotropic sampling.',
        },
        'attribution': {
            'title': 'The INIA19 Template and NeuroMaps Atlas for Primate Brain Image Parcellation and Spatial Normalization',
            'authors': ['Torsten Rohlfing', 'Christopher D. Kroenke', 'Edith V. Sullivan', 'Mark F. Dubach', 'Douglas M. Bowden', 'Kathleen A. Grant', 'Adolf Pfefferbaum'],
            'citation': 'Rohlfing T, Kroenke CD, Sullivan EV, Dubach MF, Bowden DM, Grant KA, Pfefferbaum A (2012). Frontiers in Neuroinformatics 6:27. doi:10.3389/fninf.2012.00027.',
            'doi': '10.3389/fninf.2012.00027',
            'url': 'https://www.nitrc.org/projects/inia19/',
            'paperUrl': PAPER_URL,
            'downloadUrl': 'https://www.nitrc.org/frs/download.php/6246/inia19.zip',
            'license': 'CC-BY-3.0',
            'licenseUrl': 'https://creativecommons.org/licenses/by/3.0/',
            'licenseEvidence': 'The authors explicitly license the template and atlas as CC BY 3.0 in section 5 of the paper; the NITRC download also specifies Creative Commons Attribution.',
            'modifications': 'Brain-only MRI cropped around its nonzero mask, anti-aliased, resampled to an isotropic lower-resolution physical grid, intensity-normalized and quantized to 8 bits.',
        },
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / filename).write_bytes(compressed)
    (out / 'brain-reference.json').write_text(json.dumps(metadata, indent=2) + '\n')
    if qa:
        from PIL import Image, ImageDraw
        qa.mkdir(parents=True, exist_ok=True)
        for name, axis, axes in [('xy', 2, (0, 1)), ('xz', 1, (0, 2)), ('yz', 0, (1, 2))]:
            projection = encoded_xyz.max(axis=axis).T[::-1]
            picture = Image.fromarray(projection).convert('RGB').resize((projection.shape[1] * 6, projection.shape[0] * 6))
            draw = ImageDraw.Draw(picture)
            x = (block_center_xyz[axes[0]] + .5) * 6
            y = (projection.shape[0] - block_center_xyz[axes[1]] - .5) * 6
            draw.ellipse((x - 5, y - 5, x + 5, y + 5), outline='#ffbf55', width=2)
            draw.line((18, picture.height - 22, 18 + 10 / spacing_mm * 6, picture.height - 22), fill='white', width=3)
            draw.text((18, picture.height - 40), '10 mm', fill='white')
            picture.save(qa / f'brain-reference-{name}-mip.png')
    print(json.dumps({'shape': shape.tolist(), 'spacingMM': spacing_mm, 'physicalExtentMM': metadata['physicalExtentMM'], 'compressedBytes': len(compressed), 'blockCenterXYZ': block_center_xyz.tolist()}, indent=2))
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1] / 'public/neurofly/data')
    parser.add_argument('--spacing-mm', type=float, default=1.0)
    parser.add_argument('--qa', type=Path)
    args = parser.parse_args()
    export(args.source, args.out, args.spacing_mm, args.qa)
