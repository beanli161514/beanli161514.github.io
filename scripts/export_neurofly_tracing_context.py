#!/usr/bin/env python3
"""Export every saved annotation intersecting the displayed tracing crop.

Python standard library only; the source SQLite database is strictly read-only.
  python scripts/export_neurofly_tracing_context.py \
    --source /Volumes/T9/neurofly_datasets/labeled_blocks/RM009_axons_2.db

Outside endpoints of crossing edges are retained at their exact coordinates.
The browser clips geometry to the volume; this exporter invents no boundary
nodes and does not infer connections or annotation completeness.
"""

import argparse
import ast
from collections import Counter, defaultdict
from contextlib import closing
import hashlib
import json
import math
from pathlib import Path
import sqlite3


DEFAULT_DATA = Path(__file__).resolve().parents[1] / 'public/neurofly/data'


def geometry_checksum(connection):
    """Match the published geometry fingerprint used by export_neurofly.py."""
    digest = hashlib.sha256()
    for table, sql in [
        ('nodes', 'SELECT nid,coord FROM nodes ORDER BY nid'),
        ('edges', 'SELECT src,des,date,creator FROM edges ORDER BY src,des'),
        ('segs', 'SELECT sid,points,sampled_points FROM segs ORDER BY sid'),
    ]:
        digest.update((table + '\n').encode())
        for row in connection.execute(sql):
            values = [value.decode() if isinstance(value, bytes) else value for value in row]
            digest.update((json.dumps(values, separators=(',', ':')) + '\n').encode())
    return digest.hexdigest()


def inside(point, low, high):
    return all(a <= value <= b for value, a, b in zip(point, low, high))


def segment_intersects_box(start, end, low, high):
    """Closed slab intersection, including segments with both endpoints outside."""
    enter, leave = 0.0, 1.0
    for a, b, minimum, maximum in zip(start, end, low, high):
        delta = b - a
        if delta == 0:
            if a < minimum or a > maximum:
                return False
            continue
        near, far = sorted(((minimum - a) / delta, (maximum - a) / delta))
        enter, leave = max(enter, near), min(leave, far)
        if enter > leave:
            return False
    return True


def export(source, tracing_path, output):
    source, tracing_path, output = source.resolve(), tracing_path.resolve(), output.resolve()
    if output in (source, tracing_path):
        raise ValueError('Write the context to a separate output file')
    tracing = json.loads(tracing_path.read_text())
    original_bytes = source.read_bytes()
    source_md5 = hashlib.md5(original_bytes).hexdigest()
    source_sha256 = hashlib.sha256(original_bytes).hexdigest()
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as connection:
        connection.execute('PRAGMA query_only=ON')
        fingerprint = geometry_checksum(connection)
        if fingerprint != tracing['source']['geometrySHA256']:
            raise ValueError('Source annotations do not match the tracing volume geometry fingerprint')
        coordinates = {}
        for nid, value in connection.execute('SELECT nid,coord FROM nodes ORDER BY nid'):
            point = ast.literal_eval(value.decode() if isinstance(value, bytes) else value)
            if len(point) != 3 or not all(math.isfinite(n) for n in point):
                raise ValueError(f'Invalid source coordinate at node {nid}')
            coordinates[nid] = list(point)
        rows = list(connection.execute('SELECT src,des,creator FROM edges ORDER BY src,des'))

    origin, shape = tracing['origin'], tracing['shape']
    low, high = [-.5] * 3, [size - .5 for size in shape]
    local = {nid: [value - origin[axis] for axis, value in enumerate(point)]
             for nid, point in coordinates.items()}
    all_edges, self_loops = defaultdict(set), []
    for a, b, creator in rows:
        if a not in local or b not in local:
            raise ValueError('An annotation edge references a missing source node')
        if a == b:
            self_loops.append(a)
            continue
        all_edges[tuple(sorted((a, b)))].add(creator.decode() if isinstance(creator, bytes) else creator)
    edges = [edge for edge in sorted(all_edges)
             if segment_intersects_box(local[edge[0]], local[edge[1]], low, high)]
    interior = {nid for nid, point in local.items() if inside(point, low, high)}
    endpoints = {nid for edge in edges for nid in edge}
    selected_nodes = interior | endpoints
    crossing = [edge for edge in edges if not all(nid in interior for nid in edge)]
    creator_counts = Counter(creator for edge in edges for creator in all_edges[edge])
    nodes = [{'id': nid, 'position': local[nid]} for nid in sorted(selected_nodes)]
    # The focal path must stay exactly registered with this complete context.
    for nid, position in zip(tracing['nodeIds'], tracing['pathXYZ']):
        assert nid in selected_nodes and local[nid] == position
    assert all(tuple(sorted(edge)) in edges for edge in tracing['edges'])
    metadata = {
        'schemaVersion': 1,
        'kind': 'saved-annotation-crop-context',
        'source': {
            'database': tracing['source']['database'],
            'databaseMD5': source_md5, 'databaseSHA256': source_sha256,
            'geometrySHA256': fingerprint,
            'imageFilename': tracing['source']['filename'],
            'imageMD5': tracing['source']['md5'],
            'sourceNodeCount': len(coordinates),
            'sourceDirectedEdgeRowCount': len(rows),
            'sourceUndirectedEdgeCount': len(all_edges),
        },
        'tracingRevision': tracing['revision'],
        'volume': tracing['volume'], 'volumeSHA256': tracing['sha256'],
        'origin': origin, 'shape': shape, 'voxelSizeUM': tracing['voxelSizeUM'],
        'clipBoundsXYZ': {'min': low, 'max': high},
        'coordinateConvention': 'Exact source voxel-index XYZ minus tracing origin. Clip to [-0.5, shape-0.5], the physical boundary of the rendered voxel grid; no axis flips.',
        'nodes': nodes, 'edges': [list(edge) for edge in edges],
        'edgeProvenance': [{'nodeIds': list(edge), 'creators': sorted(all_edges[edge], key=str)} for edge in edges],
        'nodeCount': len(nodes), 'edgeCount': len(edges),
        'interiorNodeCount': len(interior),
        'outsideEndpointCount': len(endpoints - interior),
        'boundaryCrossingEdgeCount': len(crossing),
        'bothOutsideCrossingEdgeCount': sum(all(nid not in interior for nid in edge) for edge in crossing),
        'interiorIsolatedNodeCount': len(interior - endpoints),
        'edgeCreatorCounts': dict(sorted(creator_counts.items(), key=lambda item: str(item[0]))),
        'provenance': {
            'sourceUrl': tracing['provenance']['url'],
            'license': tracing['provenance']['license'],
            'selection': 'Every original node inside the crop plus every saved non-self graph edge intersecting the crop, with its exact original endpoints. Segment-box intersection includes crossings whose endpoints are both outside.',
            'graph': 'All saved annotations, including seger, tester, and astar edges. Reciprocal records are deduplicated as undirected edges. Review/visibility flags do not filter this contextual view.',
            'outsideEndpoints': 'Required source endpoints retained without clipping or interpolation; the renderer clips edges at the voxel-grid boundary.',
            'focalPath': 'Included in full. The client may filter the focal path before rendering the illustrative fragment/action walkthrough.',
            'geometryVerification': 'Ordered source coordinates, directed edge provenance and segment geometry match the published fingerprint used by tracing.json.',
            'ignoredSourceSelfLoopNodeIds': sorted(set(self_loops)),
            'completeness': 'Stored annotations are shown; biological reconstruction completeness and proofread status are not asserted.',
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(metadata, separators=(',', ':'), allow_nan=False) + '\n')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_sha256, 'Source changed during export'
    print(json.dumps({'output': str(output), 'bytes': output.stat().st_size,
                      **{key: metadata[key] for key in ['nodeCount', 'edgeCount', 'interiorNodeCount', 'outsideEndpointCount', 'boundaryCrossingEdgeCount']}}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path, help='Read-only RM009_axons_2.db path')
    parser.add_argument('--tracing', type=Path, default=DEFAULT_DATA / 'tracing.json')
    parser.add_argument('--out', type=Path, default=DEFAULT_DATA / 'tracing-context.json')
    args = parser.parse_args()
    export(args.source, args.tracing, args.out)
