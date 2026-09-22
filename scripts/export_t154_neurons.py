#!/usr/bin/env python3
"""Export the six soma-bearing T154 reconstructions without changing the DB.

Python standard library only. Example:
  python scripts/export_t154_neurons.py \
    --source /Volumes/T9/neurofly_datasets/T154/T154_1um.db

Coordinates retain the original full-resolution image XYZ convention. Degree-2
trajectories alone are simplified; every soma, branch and terminal is retained.
The export records annotation evidence, not a claim of biological completeness.
"""

import argparse
from collections import Counter
import gzip
import hashlib
import json
import math
from pathlib import Path
import sqlite3


COLORS = ['#53d9e8', '#fa8ac0', '#b69aff', '#49c9a2', '#f48d4e', '#54a3ff']
NATIVE_SHAPE = [12000, 8000, 13200]


def load_graph(source):
    """Read the source snapshot in SQLite read-only/query-only mode."""
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        nodes = {
            nid: dict(position=json.loads(coord), creator=creator, status=status,
                      type=kind, date=date, checked=checked)
            for nid, coord, creator, status, kind, date, checked in db.execute(
                'SELECT nid,coord,creator,status,type,date,checked FROM nodes ORDER BY nid')
        }
        rows = list(db.execute('SELECT src,des,creator,date FROM edges ORDER BY src,des'))
        segment_count = db.execute('SELECT COUNT(*) FROM segs').fetchone()[0]
    visible = {nid: n for nid, n in nodes.items() if n['status'] == 1}
    graph = {nid: set() for nid in visible}
    edges, loops, excluded = {}, [], []
    for a, b, creator, date in rows:
        if a not in visible or b not in visible:
            excluded.append([a, b])
            continue
        if a == b:
            loops.append(a)
            continue
        key = tuple(sorted((a, b)))
        edges.setdefault(key, {'creators': set(), 'dates': set()})
        edges[key]['creators'].add(creator)
        edges[key]['dates'].add(date)
        graph[a].add(b)
        graph[b].add(a)
    unseen, components = set(graph), []
    for start in sorted(graph):
        if start not in unseen:
            continue
        unseen.remove(start)
        stack, component = [start], []
        while stack:
            nid = stack.pop()
            component.append(nid)
            for neighbor in graph[nid]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    stack.append(neighbor)
        components.append(sorted(component))
    components.sort(key=lambda cc: (-len(cc), cc[0]))
    summary = {
        'nodeCount': len(nodes), 'visibleNodeCount': len(visible),
        'directedEdgeRowCount': len(rows), 'uniqueUndirectedEdgeCount': len(edges),
        'componentCount': len(components), 'sourceSegmentCount': segment_count,
        'somaCount': sum(n['type'] == 1 for n in visible.values()),
        'nodeCreatorCounts': dict(sorted(Counter(n['creator'] for n in nodes.values()).items())),
        'nodeCheckedCounts': dict(sorted(Counter(n['checked'] for n in nodes.values()).items())),
        'ignoredSelfLoopNodeIds': sorted(loops), 'excludedHiddenOrMissingEdges': excluded,
    }
    return visible, graph, edges, components, summary


def segment_distance_squared(point, a, b):
    delta = [b[i] - a[i] for i in range(3)]
    length2 = sum(v * v for v in delta)
    t = max(0, min(1, sum((point[i] - a[i]) * delta[i] for i in range(3)) / length2)) if length2 else 0
    return sum((point[i] - (a[i] + t * delta[i])) ** 2 for i in range(3))


def simplify_path(path, nodes, tolerance):
    """Ramer-Douglas-Peucker on a single degree-2 chain, using existing IDs."""
    keep = {0, len(path) - 1}
    pending = [(0, len(path) - 1)]
    while pending:
        lo, hi = pending.pop()
        if hi <= lo + 1:
            continue
        a, b = nodes[path[lo]]['position'], nodes[path[hi]]['position']
        distance, middle = max(
            (segment_distance_squared(nodes[path[i]]['position'], a, b), i)
            for i in range(lo + 1, hi)
        )
        if distance > tolerance * tolerance:
            keep.add(middle)
            pending.extend([(lo, middle), (middle, hi)])
    indices = sorted(keep)
    return [path[a:b + 1] for a, b in zip(indices, indices[1:])]


def export_component(component, nodes, graph, source_edges, rank, tolerance):
    original_edges = {tuple(sorted((a, b))) for a in component for b in graph[a]}
    # A soma-bearing connected component is selected only when it is a tree.
    # Rejecting cycles avoids silently converting a graph to a guessed neuron.
    assert len(original_edges) == len(component) - 1, 'Selected neuron is not a tree.'
    critical = {n for n in component if len(graph[n]) != 2 or nodes[n]['type'] != 0 or nodes[n]['checked'] == -1}
    visited, segments = set(), []
    for start in sorted(critical):
        for neighbor in sorted(graph[start]):
            first = tuple(sorted((start, neighbor)))
            if first in visited:
                continue
            path = [start, neighbor]
            visited.add(first)
            while path[-1] not in critical:
                nxt, = graph[path[-1]] - {path[-2]}
                visited.add(tuple(sorted((path[-1], nxt))))
                path.append(nxt)
            segments.extend(simplify_path(path, nodes, tolerance))
    assert visited == original_edges, 'Every original edge must be accounted for.'
    retained = sorted({n for path in segments for n in (path[0], path[-1])})
    index = {nid: i for i, nid in enumerate(retained)}
    edges = [[index[path[0]], index[path[-1]]] for path in segments]
    degree = Counter(i for edge in edges for i in edge)
    assert len(edges) == len(retained) - 1
    assert all(degree[index[n]] == len(graph[n]) for n in critical)
    max_error = 0
    for path in segments:
        a, b = nodes[path[0]]['position'], nodes[path[-1]]['position']
        max_error = max(max_error, *(math.sqrt(segment_distance_squared(nodes[n]['position'], a, b)) for n in path))
    assert max_error <= tolerance + 1e-9
    somas = [n for n in component if nodes[n]['type'] == 1]
    terminals = [n for n in component if len(graph[n]) == 1]
    dates = sorted({nodes[n]['date'] for n in component} | {date for e in original_edges for date in source_edges[e]['dates']})
    return {
        'id': f't154-soma-{somas[0]}', 'label': f'Neuron {rank}', 'color': COLORS[(rank - 1) % len(COLORS)],
        'sourceComponentId': min(component), 'somaNodeIds': somas,
        'somaPositionsXYZ': [nodes[n]['position'] for n in somas],
        'positionsXYZ': [nodes[n]['position'] for n in retained],
        'sourceNodeIds': retained, 'edges': edges,
        'nodeTypes': [nodes[n]['type'] for n in retained],
        'nodeChecked': [nodes[n]['checked'] for n in retained],
        'nodeCreators': [nodes[n]['creator'] for n in retained],
        # Each displayed edge is a simplification of this exact original path.
        # This preserves a trace back to all source edges, including those whose
        # intervening degree-2 positions are omitted from the display geometry.
        'edgeSourceNodeIds': segments,
        'sourceStatistics': {
            'nodeCount': len(component), 'edgeCount': len(original_edges),
            'branchCount': sum(len(graph[n]) > 2 for n in component),
            'terminalCount': len(terminals),
            'terminalCheckedCounts': dict(sorted(Counter(nodes[n]['checked'] for n in terminals).items())),
            'nodeCheckedCounts': dict(sorted(Counter(nodes[n]['checked'] for n in component).items())),
            'nodeCreatorCounts': dict(sorted(Counter(nodes[n]['creator'] for n in component).items())),
            'edgeCreatorCounts': dict(sorted(Counter(c for edge in original_edges for c in source_edges[edge]['creators']).items())),
            'pathLengthUM': sum(math.dist(nodes[a]['position'], nodes[b]['position']) for a, b in sorted(original_edges)),
            'boundsXYZ': {'min': [min(nodes[n]['position'][axis] for n in component) for axis in range(3)],
                          'max': [max(nodes[n]['position'][axis] for n in component) for axis in range(3)]},
            'firstRecordedDate': dates[0], 'lastRecordedDate': dates[-1],
        },
        'displayStatistics': {'nodeCount': len(retained), 'edgeCount': len(edges), 'maxDeviationUM': max_error},
        'annotationEvidence': 'One explicitly labeled soma, user-account edits, and checked terminal nodes in the original database.',
        'completeness': 'not-asserted',
    }


def export(source, out, tolerance=4, overview_spacing=64):
    if tolerance < 0 or not math.isfinite(tolerance):
        raise ValueError('Tolerance must be a finite non-negative distance in micrometers.')
    if overview_spacing <= 0 or not math.isfinite(overview_spacing):
        raise ValueError('Overview spacing must be finite and positive.')
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    nodes, graph, edges, components, summary = load_graph(source)
    selected = [cc for cc in components if sum(nodes[n]['type'] == 1 for n in cc) == 1
                and any(nodes[n]['creator'] == 'tester' for n in cc)]
    assert len(selected) == 6, f'Expected six soma-bearing T154 annotations, found {len(selected)}.'
    assert all(0 <= coord < NATIVE_SHAPE[axis] for n in nodes.values() for axis, coord in enumerate(n['position']))
    neurons = [export_component(cc, nodes, graph, edges, i + 1, tolerance) for i, cc in enumerate(selected)]
    metadata = {
        'schemaVersion': 1, 'kind': 'annotated-neuron-components', 'dataset': 'T154',
        'source': {
            'databaseFilename': source.name, 'databaseSHA256': checksum, 'databaseBytes': source.stat().st_size,
            'imageFilename': 'T154_1um.ims', 'shapeXYZ': NATIVE_SHAPE,
            'voxelSpacingUM': [1, 1, 1], 'physicalExtentMM': [12, 8, 13.2],
            'coordinateAxes': ['x', 'y', 'z'], 'coordinateUnit': 'native-image-voxel',
            'coordinateConvention': 'Native image voxel-center index. Physical XYZ micrometers = (index + 0.5) × 1, relative to IMS ExtMin=[0,0,0].',
            'coordinateEvidence': 'NeuroFly nodes.coord is XYZ; matching T154_1um.ims ImageSize XYZ=12000,8000,13200 and ExtMax XYZ=12000,8000,13200 micrometers.',
        },
        'overviewTransform': {
            'spacingUM': [overview_spacing] * 3,
            'nativeXYZToOverviewXYZScale': [1 / overview_spacing] * 3,
            'nativeXYZToOverviewXYZOffset': [.5 / overview_spacing - .5] * 3,
            'formula': '(nativeXYZ + 0.5) / overviewSpacingUM - 0.5',
            'axisPermutation': [0, 1, 2], 'axisFlips': [False, False, False],
        },
        'provenance': {
            'selection': 'All six visible connected components with exactly one type=1 soma and tester-created nodes; sorted by descending source node count.',
            'creatorSemantics': {'seger': 'Automatic segment extraction', 'tester': 'Default user account in the NeuroFly annotation GUI; not a named or independently verified reviewer.'},
            'checkedSemantics': {'0': 'Unchecked', '1': 'Checked', '-1': 'Explicit review queue'},
            'proofreading': 'Every terminal of these six components is checked=1. Many automatically extracted interior nodes remain checked=0. This is endpoint-review evidence, not certification that the full neuron is complete or error-free.',
            'graphNormalization': 'Visible nodes only. Reciprocal edge rows deduplicated as undirected edges. Self loops omitted and reported in databaseStatistics. No new graph connections are inferred.',
            'simplification': {'method': 'Ramer-Douglas-Peucker along degree-2 chains only', 'toleranceUM': tolerance,
                               'preserves': ['soma IDs', 'branch IDs and degrees', 'terminal IDs', 'full branch topology', 'exact retained source coordinates', 'source node-ID path for every displayed edge']},
            'implementationEvidence': ['neurofly/dbio.py: segs2db schema', 'neurofly/segs_annotator.py: user_name, label_soma, export_swc', 'neurofly/agent_annotator.py: checked terminal selection'],
            'recordedTimestampsTimezone': 'Not specified by source database',
        },
        'databaseStatistics': summary, 'neuronCount': len(neurons),
    }
    payload = {**metadata, 'neurons': neurons}
    encoded = json.dumps(payload, separators=(',', ':'), allow_nan=False).encode()
    compressed = gzip.compress(encoded, compresslevel=9, mtime=0)
    out.mkdir(parents=True, exist_ok=True)
    asset = out / 't154-neurons-v1.json.gz'
    asset.write_bytes(compressed)
    manifest = {**metadata, 'skeleton': asset.name, 'compressedBytes': len(compressed),
                'decodedBytes': len(encoded), 'skeletonSHA256': hashlib.sha256(compressed).hexdigest(),
                'neurons': [{key: value for key, value in neuron.items() if key not in {
                    'positionsXYZ', 'sourceNodeIds', 'edges', 'nodeTypes', 'nodeChecked', 'nodeCreators', 'edgeSourceNodeIds'
                }} for neuron in neurons]}
    (out / 't154-neurons.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == checksum, 'Source DB changed during export.'
    print(json.dumps({'neurons': len(neurons), 'sourceNodes': sum(n['sourceStatistics']['nodeCount'] for n in neurons),
                      'displayNodes': sum(n['displayStatistics']['nodeCount'] for n in neurons),
                      'compressedBytes': len(compressed), 'asset': str(asset)}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1] / 'public/neurofly/data')
    parser.add_argument('--tolerance-um', type=float, default=4)
    parser.add_argument('--overview-spacing-um', type=float, default=64)
    args = parser.parse_args()
    export(args.source, args.out, args.tolerance_um, args.overview_spacing_um)
