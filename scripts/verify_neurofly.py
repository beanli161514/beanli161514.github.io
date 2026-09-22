#!/usr/bin/env python3
"""Verify NeuroFly volume orientation, quantization, provenance and graph replay."""
import argparse
import ast
import gzip
import json
from pathlib import Path
import sqlite3

import numpy as np
import tifffile

from export_neurofly import (
    DEFAULT_OUT, NAME, PUBLISHED_IMAGE_MD5, PUBLISHED_GEOMETRY_SHA256,
    checksum, geometry_checksum,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True,
                        help='Directory containing RM009_axons_2.tif and RM009_axons_2.db')
    parser.add_argument('--data', type=Path, default=DEFAULT_OUT,
                        help='Runtime data directory (default: public/neurofly/data)')
    args = parser.parse_args()
    root, source_dir = args.data.resolve(), args.source.resolve()
    manifest = json.loads((root / 'manifest.json').read_text())
    image_path = source_dir / (NAME + '.tif')
    assert checksum(image_path) == PUBLISHED_IMAGE_MD5, 'Source image differs from published TIFF'
    source = tifffile.memmap(image_path, mode='r')
    db = sqlite3.connect((source_dir / (NAME + '.db')).as_uri() + '?mode=ro', uri=True)
    assert geometry_checksum(db) == PUBLISHED_GEOMETRY_SHA256, 'Graph differs from published reference'
    for task in manifest['tasks']:
        size, origin = task['shape'], np.array(task['origin'])
        payload_path = root / task['volume']
        payload = gzip.decompress(payload_path.read_bytes())
        assert len(payload) == task['decodedBytes'] == int(np.prod(size))
        assert payload_path.stat().st_size == task['compressedBytes']
        xyz = np.frombuffer(payload, dtype=np.uint8).reshape(size[2], size[1], size[0]).transpose(2, 1, 0)
        raw = np.asarray(source[tuple(slice(int(o), int(o+s)) for o, s in zip(origin, size))])
        info = task['intensityMapping']
        reference = np.rint(np.clip((raw.astype(np.float32)-info['low']) /
                                   (info['high']-info['low']), 0, 1)*255).astype(np.uint8)
        np.testing.assert_array_equal(xyz, reference)
        nodes = {node['id']: node for node in task['nodes']}
        assert all(a in nodes and b in nodes for a, b in task['edges'])
        held = sorted([task['sourceId'], task['targetId']])
        assert held not in task['edges'], 'Proposed edge must be withheld'
        assert db.execute('SELECT 1 FROM edges WHERE src=? AND des=?',
                          (task['sourceId'], task['targetId'])).fetchone()
        for nid, node in nodes.items():
            value = db.execute('SELECT coord FROM nodes WHERE nid=?', (nid,)).fetchone()[0]
            coordinate = ast.literal_eval(value.decode() if isinstance(value, bytes) else value)
            np.testing.assert_array_equal(np.array(node['position']) + origin, coordinate)
        print(f"{task['id']}: voxels, xyz orientation, {len(nodes)} node positions and held-out edge verified")
    assert next(t for t in manifest['tasks'] if t['id'] == 'crossing')['referenceDecision'] is None
    overview = manifest['overview']
    shape = overview['shape']
    decoded = np.frombuffer(gzip.decompress((root / overview['volume']).read_bytes()), dtype=np.uint8)
    xyz = decoded.reshape(shape[2], shape[1], shape[0]).transpose(2, 1, 0)
    pooled = np.asarray(source).reshape(100, 10, 100, 10, 30, 10).max(axis=(1, 3, 5))
    info = overview['intensityMapping']
    expected = np.rint(np.clip((pooled.astype(np.float32)-info['low']) /
                              (info['high']-info['low']), 0, 1)*255).astype(np.uint8)
    np.testing.assert_array_equal(xyz, expected)
    db.close()
    print('All tasks and whole-block overview verified; crossing remains explicitly unresolved.')


if __name__ == '__main__':
    main()
