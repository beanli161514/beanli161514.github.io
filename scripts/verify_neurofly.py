#!/usr/bin/env python3
"""Validate 32³ microscopy alignment, graph provenance and three task generators."""
import argparse
import gzip
import json
from pathlib import Path
import sqlite3

import numpy as np
from scipy.ndimage import maximum_filter
import tifffile

from export_neurofly import (
    DEFAULT_OUT, NAME, REVISION, PUBLISHED_IMAGE_MD5, PUBLISHED_GEOMETRY_SHA256,
    checksum, geometry_checksum, original_graph, nearby_endpoints, source_history,
    propose_image_points,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--data', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    root, source_dir = args.data.resolve(), args.source.resolve()
    manifest = json.loads((root/'manifest.json').read_text())
    image_path = source_dir/(NAME+'.tif')
    assert checksum(image_path) == PUBLISHED_IMAGE_MD5
    db = sqlite3.connect((source_dir/(NAME+'.db')).as_uri()+'?mode=ro', uri=True)
    assert geometry_checksum(db) == PUBLISHED_GEOMETRY_SHA256
    source = tifffile.memmap(image_path, mode='r')
    nodes, all_edges, original_edges, adjacency, fragments = original_graph(db)
    assert manifest['schemaVersion'] == manifest['dataRevision'] == 3
    assert manifest['revision'] == REVISION
    assert [task['taskType'] for task in manifest['tasks']] == [
        'fragment-connection', 'endpoint-selection', 'point-proposal']
    for task in manifest['tasks']:
        sid = task['sourceId']
        assert task['shape'] == [32, 32, 32]
        assert task['volume'] == task['id']+'-32-v3.u8.gz'
        assert len(adjacency[sid]) == task['sourceDegree'] == 1
        assert fragments[sid] == task['sourceFragmentId']
        assert task['centerReviewStatus'] == 'unchecked'
        assert task['replayState']['sourceChecked'] == 0
        assert task['replayState']['basis'] == 'simulated-pre-review'
        origin = np.array(task['origin'])
        np.testing.assert_array_equal(origin, np.floor(nodes[sid]['position']).astype(int)-16)
        np.testing.assert_array_equal(task['sourcePosition'], [16, 16, 16])
        assert np.all(origin >= 0) and np.all(origin+32 <= source.shape)
        raw = np.asarray(source[tuple(slice(int(x), int(x+32)) for x in origin)])
        payload_path = root/task['volume']
        assert payload_path.stat().st_size == task['compressedBytes']
        payload = gzip.decompress(payload_path.read_bytes())
        assert len(payload) == task['decodedBytes'] == 32768
        xyz = np.frombuffer(payload, dtype=np.uint8).reshape(32, 32, 32).transpose(2, 1, 0)
        info = task['intensityMapping']
        encoded = np.rint(np.clip((raw.astype(np.float32)-info['low']) /
                                 (info['high']-info['low']), 0, 1)*255).astype(np.uint8)
        np.testing.assert_array_equal(xyz, encoded)
        task_nodes = {node['id']: node for node in task['nodes']}
        for nid, node in task_nodes.items():
            assert nid in adjacency, 'No reviewer-added or synthetic nodes in the initial graph'
            np.testing.assert_array_equal(np.array(node['position'])+origin, nodes[nid]['position'])
            assert np.all(np.array(node['position']) >= 0) and np.all(np.array(node['position']) < 32)
            assert node['component'] == fragments[nid]
        assert sum(sid in edge for edge in task['edges']) == 1
        for a, b in task['edges']:
            assert a in task_nodes and b in task_nodes and tuple(sorted((a, b))) in original_edges
        for a, b in task['heldOutReviewerEdges']:
            assert all_edges[tuple(sorted((a, b)))] != 'seger'
            assert [a, b] not in task['edges']
        history, direction = source_history(sid, nodes, adjacency, set(task_nodes))
        assert history == task['historyNodeIds']
        np.testing.assert_allclose(direction, task['incomingVector'])
        for nid, position in zip(history, task['history']):
            np.testing.assert_array_equal(position, task_nodes[nid]['position'])
        nearby = nearby_endpoints(sid, nodes, adjacency, fragments, task['candidateGeneration']['nearbyRadiusVoxels'])
        assert nearby == task['nearbyEndpointIds']
        assert len(nearby) == task['nearbyEndpointCount']
        assert len({candidate['id'] for candidate in task['candidates']}) == len(task['candidates'])
        for index, candidate in enumerate(task['candidates']):
            position = np.array(candidate['position'])
            delta = position-16
            distance = float(np.linalg.norm(delta))
            assert np.all(position >= 0) and np.all(position < 32)
            assert candidate['id'] == chr(ord('b')+index)
            assert candidate['label'] == chr(ord('B')+index)
            np.testing.assert_array_equal(position+origin, candidate['sourceVolumePosition'])
            np.testing.assert_allclose(distance, candidate['distanceVoxels'])
            np.testing.assert_allclose(float(np.dot(delta, direction)/distance), candidate['directionCosine'])
            assert int(raw[tuple(position.astype(int))]) == candidate['intensity']
            if candidate['kind'] == 'fragment-endpoint':
                nid = candidate['nodeId']
                assert nid in nearby and nid in task_nodes and len(adjacency[nid]) == 1
                assert fragments[nid] == candidate['fragmentId'] != fragments[sid]
                np.testing.assert_array_equal(position, task_nodes[nid]['position'])
            else:
                assert candidate['kind'] == 'image-point' and candidate['nodeId'] is None
                assert candidate['isLocalMaximum']
                assert int(maximum_filter(raw, size=3, mode='nearest')[tuple(position.astype(int))]) == candidate['intensity']
        if task['taskType'] == 'fragment-connection':
            assert len(task['candidates']) == 1 and not task['allowsNone']
            assert task['referenceDecision'] == 'accept' and task['referenceCandidateId'] == 'b'
            assert task['reviewerPath'] == [sid, task['candidates'][0]['nodeId']]
            for edge in task['reviewerPathEdges']:
                assert all_edges[tuple(sorted((edge['sourceId'], edge['targetId'])))] == edge['creator'] == 'tester'
        elif task['taskType'] == 'endpoint-selection':
            assert len(task['candidates']) >= 2 and not task['allowsNone']
            assert len({candidate['fragmentId'] for candidate in task['candidates']}) == len(task['candidates'])
            assert task['referenceDecision'] is None and task['referenceCandidateId'] is None
        else:
            assert nearby == [] and task['nearbyEndpointCount'] == 0
            assert len(task['candidates']) >= 2 and task['allowsNone'] and task['noneMeaning'] == 'true-ending'
            assert task['referenceDecision'] is None and task['referenceCandidateId'] is None
            measured, generation = propose_image_points(raw, np.array([16, 16, 16]), direction)
            assert task['candidateGeneration'] == generation
            for candidate, expected in zip(task['candidates'], measured):
                for key, value in expected.items():
                    np.testing.assert_allclose(candidate[key], value)
            assert len(measured) == len(task['candidates'])
            for index, candidate in enumerate(task['candidates']):
                assert 5 <= candidate['distanceVoxels'] <= 10
                assert candidate['intensity'] >= np.percentile(raw, 95)
                assert candidate['directionCosine'] >= np.cos(np.deg2rad(75))
                ray = (np.array(candidate['position'])-16)/candidate['distanceVoxels']
                for earlier in task['candidates'][:index]:
                    other = (np.array(earlier['position'])-16)/earlier['distanceVoxels']
                    angle = np.degrees(np.arccos(np.clip(np.dot(ray, other), -1, 1)))
                    assert angle >= 20
        assert task['allowsUncertain']
        print(f"{task['taskType']}: source alignment, original fragments and {len(task['candidates'])} measured candidates verified")
    overview = manifest['overview']
    decoded = np.frombuffer(gzip.decompress((root/overview['volume']).read_bytes()), dtype=np.uint8)
    xyz = decoded.reshape(30, 100, 100).transpose(2, 1, 0)
    pooled = np.asarray(source).reshape(100, 10, 100, 10, 30, 10).max(axis=(1, 3, 5))
    info = overview['intensityMapping']
    expected = np.rint(np.clip((pooled.astype(np.float32)-info['low']) /
                              (info['high']-info['low']), 0, 1)*255).astype(np.uint8)
    np.testing.assert_array_equal(xyz, expected)
    db.close()
    print('All three distinct task types and overview verified against the published source data.')


if __name__ == '__main__':
    main()
