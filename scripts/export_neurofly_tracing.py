#!/usr/bin/env python3
"""Export a real annotated NeuroFly fiber for an incremental browser replay.

Usage: python scripts/export_neurofly_tracing.py --source /path/to/labeled_blocks
The source TIFF and graph are opened read-only. This curated export requires
the published RM009 sample fingerprint; it does not run a reconstruction model.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import sqlite3

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates
import tifffile

from export_neurofly import (
    DEFAULT_OUT, NAME, PUBLISHED_DB_MD5, PUBLISHED_GEOMETRY_SHA256,
    PUBLISHED_IMAGE_MD5, checksum, decode_coord, geometry_checksum, write_gzip,
)

SIZE = 96
# Curated after enumerating degree-two graph chains and measuring image signal.
# Coordinates and every consecutive edge are retained exactly as saved.
PATH_IDS = list(range(1242, 1187, -1))
HISTORY_INDICES = list(range(20, 25))
PROJECTIONS = {
    'xy': {'axis': 2, 'dimensions': [0, 1], 'horizontal': 'x', 'vertical': 'y'},
    'xz': {'axis': 1, 'dimensions': [0, 2], 'horizontal': 'x', 'vertical': 'z'},
    'yz': {'axis': 0, 'dimensions': [1, 2], 'horizontal': 'y', 'vertical': 'z'},
}


def oblique_mip(volume, output):
    """Raycast the actual volume using the model figure's affine projection."""
    matrix = np.array([[315., 0., -155.], [-26., 236., -54.]])
    offset = np.array([250., 560.])
    bounds = [95, 480, 565, 796]
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    yy, xx = np.mgrid[:height, :width]
    screen = np.stack((xx.ravel() + bounds[0] + .5,
                       yy.ravel() + bounds[1] + .5))
    base = np.einsum('ij,jk->ik', np.linalg.pinv(matrix), screen - offset[:, None])
    assert np.all(np.isfinite(base))
    assert np.allclose(np.einsum('ij,jk->ik', matrix, base) + offset[:, None], screen)
    direction = np.cross(matrix[0], matrix[1])
    direction /= np.linalg.norm(direction)
    slab0, slab1 = -base / direction[:, None], (1 - base) / direction[:, None]
    enter = np.minimum(slab0, slab1).max(axis=0)
    leave = np.maximum(slab0, slab1).min(axis=0)
    inside = leave >= enter
    valid = np.flatnonzero(inside)
    gray = np.zeros(width * height, dtype=np.uint8)
    samples = 64
    fractions = np.linspace(0, 1, samples)[None, :]
    source = volume.astype(np.float32)
    for start in range(0, len(valid), 2048):
        indices = valid[start:start + 2048]
        depth = enter[indices, None] + (leave[indices] - enter[indices])[:, None] * fractions
        normalized = base[:, indices, None] + direction[:, None, None] * depth[None, :, :]
        coordinates = normalized * np.array(volume.shape)[:, None, None] - .5
        values = map_coordinates(source, coordinates, order=1, mode='nearest', prefilter=False)
        gray[indices] = np.rint(values.max(axis=1)).astype(np.uint8)
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[:, :, :3] = gray.reshape(height, width, 1)
    rgba[:, :, 3] = inside.reshape(height, width) * 255
    path = output / 'tracing-context-oblique.png'
    Image.fromarray(rgba).save(path)
    return {
        'file': path.name, 'width': width, 'height': height,
        'matrix': matrix.tolist(), 'offset': offset.tolist(), 'bounds': bounds,
        'coordinateMapping': 'screen = offset + matrix @ ((localVoxelXYZ + 0.5) / shapeXYZ)',
        'pixelCenters': 'Output pixel (i,j) samples screen (bounds[0]+i+0.5, bounds[1]+j+0.5).',
        'method': 'Orthographic maximum-intensity raycast of the true 32³ uint8 context',
        'raySamples': samples, 'interpolation': 'trilinear',
        'boundaryMode': 'nearest (clamp to edge inside unit-cube voxel bounds)',
        'alpha': '255 inside the projected unit-cube hull; 0 outside',
        'bytes': path.stat().st_size, 'sha256': sha256(path),
    }


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True,
                        help='Directory containing RM009_axons_2.tif and .db')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--qa', type=Path, help='Optional directory for projection QA')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.out.resolve()
    if source == output:
        raise ValueError('Export into a separate output directory')
    image_path, db_path = source / (NAME + '.tif'), source / (NAME + '.db')
    if checksum(image_path) != PUBLISHED_IMAGE_MD5:
        raise ValueError('This curated path requires the published RM009 image')
    connection = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)
    if geometry_checksum(connection) != PUBLISHED_GEOMETRY_SHA256:
        raise ValueError('Graph differs from the verified published geometry')
    coordinates = {nid: decode_coord(coord)
                   for nid, coord in connection.execute('SELECT nid,coord FROM nodes')}
    adjacency = collections.defaultdict(set)
    records = collections.defaultdict(list)
    for a, b, date, creator in connection.execute('SELECT src,des,date,creator FROM edges'):
        if a == b:
            continue
        adjacency[a].add(b)
        adjacency[b].add(a)
        records[tuple(sorted((a, b)))].append({
            'sourceId': a, 'targetId': b,
            'date': date.decode() if isinstance(date, bytes) else date,
            'creator': creator.decode() if isinstance(creator, bytes) else creator,
        })
    path = np.array([coordinates[nid] for nid in PATH_IDS])
    edges = list(zip(PATH_IDS[:-1], PATH_IDS[1:]))
    assert len(set(PATH_IDS)) == len(PATH_IDS)
    assert all(tuple(sorted(edge)) in records for edge in edges)
    assert all(len(adjacency[nid]) == 2 for nid in PATH_IDS[1:-1]), 'Interior must be unbranched'
    image = tifffile.memmap(image_path, mode='r')
    assert image.shape == (1000, 1000, 300) and image.dtype == np.dtype('uint16')
    origin = np.clip(np.floor((path.max(axis=0) + path.min(axis=0)) / 2).astype(int) - SIZE // 2,
                     0, np.array(image.shape) - SIZE)
    local_path = path - origin
    assert np.all(local_path >= 0) and np.all(local_path < SIZE)
    raw = image[tuple(slice(int(start), int(start + SIZE)) for start in origin)]
    low, high = map(float, np.percentile(raw, [30, 99.95]))
    mapped = np.round(np.clip((raw.astype(np.float64) - low) / (high - low), 0, 1) * 255).astype(np.uint8)
    # The native sample array is XYZ; browser texture payloads are x-fastest ZYX.
    payload = np.ascontiguousarray(mapped.transpose(2, 1, 0)).tobytes()
    output.mkdir(parents=True, exist_ok=True)
    volume_path = output / 'tracing-volume.u8.gz'
    write_gzip(volume_path, payload)
    projections = {}
    for name, specification in PROJECTIONS.items():
        face_path = output / ('tracing-' + name + '.png')
        Image.fromarray(mapped.max(axis=specification['axis']).T).save(face_path)
        projections[name] = {
            'file': face_path.name, 'width': SIZE, 'height': SIZE,
            'horizontalAxis': specification['horizontal'],
            'verticalAxis': specification['vertical'],
            'maximumOverAxis': 'xyz'[specification['axis']],
            'flipHorizontal': False, 'flipVertical': False,
            'bytes': face_path.stat().st_size, 'sha256': sha256(face_path),
        }
    # The model schematic uses the actual 32³ neighborhood around five history
    # points. Slice the display volume to retain identical intensity mapping.
    history = local_path[HISTORY_INDICES]
    context_size = 32
    context_origin = np.clip(
        np.floor((history.max(axis=0) + history.min(axis=0)) / 2).astype(int) - context_size // 2,
        0, SIZE - context_size)
    context_history = history - context_origin
    assert np.all(context_history >= 0) and np.all(context_history < context_size)
    context_volume = mapped[tuple(slice(int(start), int(start + context_size)) for start in context_origin)]
    context_projections = {}
    for name, specification in PROJECTIONS.items():
        face_path = output / ('tracing-context-' + name + '.png')
        Image.fromarray(context_volume.max(axis=specification['axis']).T).save(face_path)
        context_projections[name] = {
            **projections[name], 'file': face_path.name,
            'width': context_size, 'height': context_size,
            'bytes': face_path.stat().st_size, 'sha256': sha256(face_path),
        }
    oblique_projection = oblique_mip(context_volume, output)
    node_intensities = image[tuple(np.rint(path).astype(int).T)]
    steps = np.diff(path, axis=0)
    edge_provenance = [{'nodeIds': [a, b], 'sourceRecords': records[tuple(sorted((a, b)))]}
                       for a, b in edges]
    creator_counts = collections.Counter(records[tuple(sorted(edge))][0]['creator'] for edge in edges)
    metadata = {
        'schemaVersion': 1, 'revision': 'annotated-fiber-replay-v1',
        'kind': 'saved-annotation-replay',
        'title': 'Annotated fiber extension',
        'description': 'Reveal an ordered, unbranched path from the saved annotation graph over its real fluorescence crop. No new model predictions are generated.',
        'volume': volume_path.name, 'shape': [SIZE, SIZE, SIZE],
        'origin': origin.tolist(), 'voxelSizeUM': [1, 1, 1],
        'physicalExtentUM': [SIZE, SIZE, SIZE],
        'format': {'dtype': 'uint8', 'arrayOrder': 'C', 'arrayAxes': ['z', 'y', 'x'],
                   'coordinateAxes': ['x', 'y', 'z'], 'compression': 'gzip'},
        'coordinateConvention': 'Path coordinates are exact source voxel-index XYZ minus origin. A voxel center p maps to normalized texture coordinates (p+0.5)/shape; no axis flips.',
        'decodedBytes': len(payload), 'compressedBytes': volume_path.stat().st_size,
        'sha256': sha256(volume_path), 'decodedSHA256': hashlib.sha256(payload).hexdigest(),
        'source': {
            'filename': image_path.name, 'shapeXYZ': list(image.shape), 'dtype': str(image.dtype),
            'md5': PUBLISHED_IMAGE_MD5, 'fileBytes': image_path.stat().st_size,
            'database': db_path.name, 'databaseMD5': checksum(db_path),
            'publishedDatabaseMD5': PUBLISHED_DB_MD5,
            'geometrySHA256': PUBLISHED_GEOMETRY_SHA256,
            'geometryVerification': 'All ordered node coordinates, edge records with provenance, and segment geometry match the published reference fingerprint. Review flags are excluded.',
            'voxelSizeUM': [1, 1, 1], 'calibrationSource': 'Dataset owner confirmed 1 micrometer per voxel on each axis.',
        },
        'provenance': {
            'title': 'NeuroFly Neuron Reconstruction Dataset',
            'url': 'https://zenodo.org/records/13328867', 'doi': '10.5281/zenodo.13328867',
            'license': 'CC-BY-4.0', 'creatorsAsDeposited': ['Anonymous, Anonymous'],
            'sourceCode': 'https://github.com/beanli161514/neurofly',
            'graphFilter': 'Saved graph: every non-self edge, ignoring edge orientation for connectivity. The replay is a contiguous subpath with degree-two interior nodes; it includes the recorded reviewer join 1194–1193.',
            'selection': 'Enumerated unbranched saved-graph chains; selected a 55-node subpath with high measured fluorescence and a visible bend. The displayed path is neither resampled nor smoothed.',
            'validation': 'All 54 consecutive edges exist in the source DB; all 55 positions are exact stored coordinates and lie inside the crop.',
        },
        'nodeIds': PATH_IDS, 'pathXYZ': local_path.tolist(),
        'sourcePathXYZ': path.tolist(), 'nodeCount': len(PATH_IDS),
        'edges': [list(edge) for edge in edges], 'edgeProvenance': edge_provenance,
        'edgeCreatorCounts': dict(creator_counts),
        'arcLengthUM': float(np.linalg.norm(steps, axis=1).sum()),
        'intensityMapping': {
            'method': 'linear-clipped-uint8', 'lowPercentile': 30, 'highPercentile': 99.95,
            'lowValue': low, 'highValue': high, 'inputDtype': 'uint16',
            'formula': 'round(255 * clip((value-lowValue)/(highValue-lowValue),0,1))',
            'note': '8-bit display quantization only; the source remains unchanged.',
        },
        'signalMetrics': {'nodeSampling': 'nearest original voxel',
                          'nodeMedian': float(np.median(node_intensities)),
                          'node10thPercentile': float(np.percentile(node_intensities, 10)),
                          'cropMedian': float(np.median(raw))},
        'historyIndices': HISTORY_INDICES,
        'historyNodeIds': [PATH_IDS[index] for index in HISTORY_INDICES],
        'historyXYZ': local_path[HISTORY_INDICES].tolist(),
        'historyNote': 'Five consecutive measured annotation points, provided for the model schematic.',
        'projections': projections,
        'diagramContext': {
            'shape': [context_size] * 3, 'voxelSizeUM': [1, 1, 1],
            'origin': context_origin.tolist(),
            'originCoordinateSystem': 'parent tracing-volume voxel-index XYZ',
            'absoluteSourceOrigin': (origin + context_origin).tolist(),
            'historyXYZ': context_history.tolist(),
            'historyNodeIds': [PATH_IDS[index] for index in HISTORY_INDICES],
            'projections': context_projections,
            'obliqueProjection': oblique_projection,
            'intensityMapping': 'Exact subcrop of the parent uint8 display volume; no additional normalization.',
            'coordinateConvention': 'History positions are local to this 32³ context. Normalize texture coordinates as (p+0.5)/32; no axis flips.',
        },
    }
    metadata_path = output / 'tracing.json'
    metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    # Verify the delivered bytes, projections, and coordinate mapping, not just the construction.
    import gzip
    delivered = np.frombuffer(gzip.decompress(volume_path.read_bytes()), dtype=np.uint8).reshape((SIZE, SIZE, SIZE)).transpose(2, 1, 0)
    assert np.array_equal(delivered, mapped)
    assert np.array_equal(np.array(metadata['pathXYZ']) + origin, path)
    for name, specification in PROJECTIONS.items():
        saved = np.array(Image.open(output / projections[name]['file']))
        assert np.array_equal(saved, delivered.max(axis=specification['axis']).T)
        context_saved = np.array(Image.open(output / context_projections[name]['file']))
        assert np.array_equal(context_saved, context_volume.max(axis=specification['axis']).T)
    assert np.array_equal(context_history + context_origin, history)
    if args.qa:
        args.qa.mkdir(parents=True, exist_ok=True)
        qa = Image.new('RGB', (3 * SIZE, 2 * SIZE))
        for panel, (name, specification) in enumerate(PROJECTIONS.items()):
            face = Image.open(output / projections[name]['file']).convert('RGB')
            qa.paste(face, (panel * SIZE, 0))
            qa.paste(face, (panel * SIZE, SIZE))
            d0, d1 = specification['dimensions']
            points = [(panel * SIZE + p[d0], SIZE + p[d1]) for p in local_path]
            draw = ImageDraw.Draw(qa)
            draw.line(points, fill=(20, 255, 190), width=1)
            for x, y in points:
                draw.ellipse((x-.6, y-.6, x+.6, y+.6), fill=(0, 180, 255))
        qa.resize((1152, 768)).save(args.qa / 'tracing-qa.png')
    connection.close()
    print(json.dumps({'metadata': str(metadata_path), 'shape': metadata['shape'],
                      'origin': origin.tolist(), 'nodeCount': len(PATH_IDS),
                      'compressedBytes': metadata['compressedBytes'],
                      'edgeCreators': dict(creator_counts), 'verified': True}, indent=2))


if __name__ == '__main__':
    main()
