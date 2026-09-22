#!/usr/bin/env python3
"""Export three real NeuroFly task types as read-only, source-centered 32³ crops.

Source TIFF and graph coordinates are xyz. Payloads are uint8 C-order zyx.
The selected examples come from the published RM009_axons_2 sample only.
"""
import argparse
import ast
import collections
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3

import numpy as np
from scipy.ndimage import maximum_filter
import tifffile

DEFAULT_OUT = Path(__file__).resolve().parents[1] / 'public' / 'neurofly' / 'data'
NAME = 'RM009_axons_2'
SIZE = 32
REVISION = 'three-task-types-32-v3'
NEARBY_RADIUS = 12.0
PUBLISHED_IMAGE_MD5 = '21e734a367969d84b93b7613d7a5f729'
PUBLISHED_DB_MD5 = 'df076171651054f04026a6e360fba765'
# Ordered coordinates, directed edges + provenance, segment geometry; review flags excluded.
PUBLISHED_GEOMETRY_SHA256 = '7f194483dbb7ac8052e5b54542eac9c15c7b903dc7b447be970e0adcfabf385a'


def decode_coord(value):
    return np.array(ast.literal_eval(value.decode() if isinstance(value, bytes) else value), dtype=float)


def checksum(path):
    digest = hashlib.md5()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(4*1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def geometry_checksum(connection):
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


def write_gzip(path, payload):
    with path.open('wb') as output:
        with gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=0, compresslevel=9) as archive:
            archive.write(payload)


def original_graph(connection):
    nodes = {row[0]: {'position': decode_coord(row[1]), 'status': row[3], 'checked': row[6]}
             for row in connection.execute('SELECT * FROM nodes')}
    all_edges = {tuple(sorted((a, b))): creator
                 for a, b, creator in connection.execute('SELECT src,des,creator FROM edges')
                 if a != b and a in nodes and b in nodes}
    edges = {edge for edge, creator in all_edges.items() if creator == 'seger'}
    adjacency = collections.defaultdict(set)
    for a, b in edges:
        adjacency[a].add(b)
        adjacency[b].add(a)
    fragments = {}
    for seed in sorted(adjacency):
        if seed in fragments:
            continue
        queue = [seed]
        fragments[seed] = seed
        while queue:
            a = queue.pop()
            for b in adjacency[a]:
                if b not in fragments:
                    fragments[b] = seed
                    queue.append(b)
    return nodes, all_edges, edges, adjacency, fragments


def source_history(source_id, nodes, adjacency, inside):
    path = [source_id]
    for _ in range(5):
        choices = [n for n in adjacency[path[-1]] if n not in path and n in inside]
        if len(choices) != 1:
            break
        path.append(choices[0])
    direction = nodes[source_id]['position'] - nodes[path[-1]]['position']
    length = float(np.linalg.norm(direction))
    if length == 0:
        raise ValueError('Endpoint must have a nondegenerate trajectory history')
    return list(reversed(path)), direction / length


def nearby_endpoints(source_id, nodes, adjacency, fragments, radius=NEARBY_RADIUS):
    source = nodes[source_id]['position']
    nearby = [nid for nid in adjacency if len(adjacency[nid]) == 1
              and fragments[nid] != fragments[source_id]
              and np.linalg.norm(nodes[nid]['position']-source) <= radius]
    return sorted(nearby, key=lambda nid: (float(np.linalg.norm(nodes[nid]['position']-source)), nid))


def propose_image_points(raw, source_local, direction):
    """Return actual voxel maxima; score/radius/cone are disclosed, not ground truth."""
    threshold = float(np.percentile(raw, 95))
    background = float(np.median(raw))
    maxima = (raw == maximum_filter(raw, size=3, mode='nearest')) & (raw >= threshold)
    coordinates = np.argwhere(maxima)
    delta = coordinates.astype(float)-source_local
    distance = np.linalg.norm(delta, axis=1)
    cosine = np.divide(np.sum(delta*direction, axis=1), distance,
                       out=np.full(len(distance), -1.0), where=distance > 0)
    minimum_cosine = float(np.cos(np.deg2rad(75)))
    valid = (distance >= 5) & (distance <= 10) & (cosine >= minimum_cosine)
    coordinates, distance, cosine = coordinates[valid], distance[valid], cosine[valid]
    intensities = raw[tuple(coordinates.T)].astype(float)
    score = (intensities-background)*(0.3+0.7*cosine)
    order = sorted(range(len(coordinates)),
                   key=lambda index: (-float(score[index]), *coordinates[index].tolist()))
    selected = []
    for index in order:
        ray = (coordinates[index]-source_local)/distance[index]
        separated = all(
            np.linalg.norm(coordinates[index]-coordinates[other]) >= 3
            and np.degrees(np.arccos(np.clip(np.dot(
                ray, (coordinates[other]-source_local)/distance[other]), -1, 1))) >= 20
            for other in selected)
        if separated:
            selected.append(index)
        if len(selected) == 3:
            break
    points = [{'position': coordinates[index].astype(float).tolist(),
               'distanceVoxels': float(distance[index]), 'directionCosine': float(cosine[index]),
               'intensity': int(intensities[index]), 'score': float(score[index]),
               'isLocalMaximum': True}
              for index in selected]
    parameters = {
        'method': 'direction-conditioned-local-intensity-maxima',
        'nearbyRadiusVoxels': NEARBY_RADIUS, 'distanceRangeVoxels': [5, 10],
        'forwardConeDegrees': 75, 'minimumDirectionCosine': minimum_cosine,
        'localMaximumWindow': [3, 3, 3], 'intensityThresholdPercentile': 95,
        'intensityThresholdValue': threshold, 'medianCropIntensity': background,
        'minimumCandidateSeparationVoxels': 3, 'minimumBearingSeparationDegrees': 20, 'maxCandidates': 3,
        'scoreFormula': '(intensity - medianCropIntensity) * (0.3 + 0.7 * directionCosine)',
        'note': 'Original uint16 voxel maxima; proposed locations are not validated continuation labels.',
    }
    return points, parameters


def qa_image(path, raw8, task):
    from PIL import Image, ImageDraw
    canvas = Image.new('RGB', (SIZE*3, SIZE))
    draw = ImageDraw.Draw(canvas)
    nodes = {node['id']: np.array(node['position']) for node in task['nodes']}
    for panel, (axis, dimensions) in enumerate([(2, (0, 1)), (1, (0, 2)), (0, (1, 2))]):
        canvas.paste(Image.fromarray(raw8.max(axis=axis).T).convert('RGB'), (SIZE*panel, 0))
        for a, b in task['edges']:
            pa, pb = nodes[a], nodes[b]
            draw.line((pa[dimensions[0]]+SIZE*panel, pa[dimensions[1]],
                       pb[dimensions[0]]+SIZE*panel, pb[dimensions[1]]), fill=(60, 150, 180))
        pa = task['sourcePosition']
        x, y = pa[dimensions[0]]+SIZE*panel, pa[dimensions[1]]
        draw.ellipse((x-1, y-1, x+1, y+1), fill=(40, 220, 255))
        for candidate in task['candidates']:
            position = candidate['position']
            x, y = position[dimensions[0]]+SIZE*panel, position[dimensions[1]]
            draw.ellipse((x-0.8, y-0.8, x+0.8, y+0.8), fill=(255, 170, 60))
    canvas.resize((1152, 384)).save(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Directory containing paired RM009_axons_2.tif/.db')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT, help='Default: public/neurofly/data')
    parser.add_argument('--qa', type=Path, help='Optional QA PNG directory (requires Pillow)')
    args = parser.parse_args()
    source_dir, output = args.source.resolve(), args.out.resolve()
    image_path, db_path = source_dir/(NAME+'.tif'), source_dir/(NAME+'.db')
    if checksum(image_path) != PUBLISHED_IMAGE_MD5:
        raise ValueError('This curated export requires the published RM009_axons_2.tif')
    connection = sqlite3.connect(db_path.as_uri()+'?mode=ro', uri=True)
    if geometry_checksum(connection) != PUBLISHED_GEOMETRY_SHA256:
        raise ValueError('Source graph differs from the published reference; re-curate before export')
    volume = tifffile.memmap(image_path, mode='r')
    if volume.shape != (1000, 1000, 300) or volume.dtype != np.dtype('uint16'):
        raise ValueError('Unexpected source shape or dtype')
    output.mkdir(parents=True, exist_ok=True)
    if args.qa:
        args.qa.mkdir(parents=True, exist_ok=True)
    nodes, all_edges, original_edges, adjacency, fragments = original_graph(connection)
    source_info = {
        'filename': NAME+'.tif', 'shapeXYZ': list(volume.shape), 'dtype': str(volume.dtype),
        'bitDepth': 16, 'voxelCount': int(volume.size), 'uncompressedBytes': int(volume.nbytes),
        'fileBytes': image_path.stat().st_size, 'md5': PUBLISHED_IMAGE_MD5,
        'database': NAME+'.db', 'databaseMD5': checksum(db_path), 'publishedDatabaseMD5': PUBLISHED_DB_MD5,
        'geometrySHA256': PUBLISHED_GEOMETRY_SHA256,
        'publishedGeometryVerification': 'Ordered node coordinates, edges with provenance, and segment geometry checked against the published database fingerprint. Review flags excluded.',
        'nodeCount': len(nodes), 'undirectedEdgeCount': len(all_edges),
        'originalEndpointCount': sum(len(neighbors) == 1 for neighbors in adjacency.values()),
        'species': 'macaque', 'imaging': 'VISoR', 'coordinateUnit': 'voxel',
        'voxelSizeUM': [1, 1, 1], 'spacingCalibrated': True,
        'calibrationSource': {
            'type': 'user-confirmed',
            'note': 'The dataset owner confirmed 1 micrometer per voxel on each axis; consistent with NeuroFly paper section 5.1.',
            'supportingReference': 'https://arxiv.org/html/2411.04715v1#S5.SS1',
        },
    }
    specifications = [
        {'id': 'fragment-connection', 'taskType': 'fragment-connection', 'title': 'Fragment connection',
         'prompt': 'Should fragment A connect to fragment B?', 'sourceId': 2667,
         'context': 'Inspect a proposed connection between two original segmentation fragments.',
         'referenceDecision': 'accept', 'referenceCandidateId': 'b', 'reviewerPath': [2667, 2769],
         'referenceNote': 'The saved reviewer graph contains tester edge 2667–2769. This recorded reference supports fragment continuity; it is not live inference.'},
        {'id': 'endpoint-selection', 'taskType': 'endpoint-selection', 'title': 'Endpoint selection',
         'prompt': 'Which nearby endpoint continues fragment A?', 'sourceId': 1194,
         'context': 'Choose among three original endpoints in different fragments within 12 voxels of A.',
         'referenceDecision': None, 'referenceCandidateId': None, 'reviewerPath': [],
         'referenceNote': 'Candidate endpoints are measured original graph endpoints. No validated selection label is assigned to this demonstration.'},
        {'id': 'point-proposal', 'taskType': 'point-proposal', 'title': 'Point proposal',
         'prompt': 'Which proposed point continues fragment A, or is A a true ending?', 'sourceId': 4578,
         'context': 'No other-fragment endpoint lies within 12 voxels. Inspect image maxima 5–10 voxels away in the 75° forward cone.',
         'referenceDecision': None, 'referenceCandidateId': None, 'reviewerPath': [],
         'referenceNote': 'These are direction-conditioned measured image maxima, not ground-truth continuation labels. None means a true ending; uncertainty remains a separate choice.'},
    ]
    manifest = {
        'schemaVersion': 3, 'dataRevision': 3, 'revision': REVISION, 'kind': 'curated-decision-replay',
        'provenance': {
            'title': 'NeuroFly Neuron Reconstruction Dataset', 'url': 'https://zenodo.org/records/13328867',
            'doi': '10.5281/zenodo.13328867', 'license': 'CC-BY-4.0',
            'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/', 'creatorsAsDeposited': ['Anonymous, Anonymous'],
            'sourceCode': 'https://github.com/beanli161514/neurofly',
            'annotationGuide': 'https://github.com/beanli161514/neurofly/blob/main/docs/agent_annotation.md',
            'note': 'Real images, original segmentation fragments, and measured image-point proposals. Visitor choices are unverified demo reviews. No model inference or training runs in the page.',
        },
        'sourceVolume': source_info,
        'axes': {'positions': 'xyz', 'volumeBytes': 'uint8, C-order zyx, x varies fastest',
                 'spacing': [1, 1, 1], 'unit': 'voxel', 'physicalSpacingUM': [1, 1, 1],
                 'note': 'Graph positions remain in source voxel coordinates; physical spacing is confirmed as 1 micrometer per voxel on each axis.'},
        'taskDesign': {'taskTypes': ['fragment-connection', 'endpoint-selection', 'point-proposal'],
                       'source': 'Unchecked original segmentation endpoint (simulated pre-review state)',
                       'initialEdges': 'seger only', 'uncertaintyAvailableForAllTypes': True,
                       'noneAvailableFor': ['point-proposal'], 'noneMeaning': 'true-ending',
                       'note': 'Reviewer joins and interpolated paths are excluded from the initial graph.'},
        'tasks': [],
    }
    for task in specifications:
        source_id = task['sourceId']
        if len(adjacency[source_id]) != 1:
            raise ValueError('Task source must be a degree-one original endpoint')
        origin = np.clip(np.floor(nodes[source_id]['position']).astype(int)-16, 0, np.array(volume.shape)-SIZE)
        raw = np.asarray(volume[tuple(slice(int(x), int(x+SIZE)) for x in origin)])
        source_local = nodes[source_id]['position']-origin
        inside = {nid for nid in adjacency if nodes[nid]['status'] != 0
                  and np.all(nodes[nid]['position'] >= origin) and np.all(nodes[nid]['position'] < origin+SIZE)}
        history_ids, direction = source_history(source_id, nodes, adjacency, inside)
        nearby = nearby_endpoints(source_id, nodes, adjacency, fragments)
        candidates = []
        if task['taskType'] == 'point-proposal':
            if nearby:
                raise ValueError('Point proposal requires no other-fragment endpoint within the declared radius')
            peaks, generation = propose_image_points(raw, source_local, direction)
            if len(peaks) < 2:
                raise ValueError('Selected point-proposal example needs at least two measured maxima')
            candidates = [{**peak, 'nodeId': None, 'kind': 'image-point',
                           'provenance': 'measured-uint16-voxel-local-maximum'} for peak in peaks]
        else:
            candidate_ids = [2769] if task['taskType'] == 'fragment-connection' else nearby
            seen = set()
            for nid in candidate_ids:
                if fragments[nid] in seen:
                    continue
                seen.add(fragments[nid])
                if nid not in inside or nid not in nearby or len(adjacency[nid]) != 1:
                    raise ValueError('Fragment candidates must be nearby original endpoints within the crop')
                delta = nodes[nid]['position']-nodes[source_id]['position']
                distance = float(np.linalg.norm(delta))
                candidates.append({'nodeId': nid, 'kind': 'fragment-endpoint',
                                   'position': (nodes[nid]['position']-origin).tolist(),
                                   'fragmentId': fragments[nid], 'endpointDegree': 1,
                                   'distanceVoxels': distance, 'directionCosine': float(np.dot(delta, direction)/distance),
                                   'intensity': int(volume[tuple(nodes[nid]['position'].astype(int))]),
                                   'originalEdgePresent': tuple(sorted((source_id, nid))) in all_edges,
                                   'provenance': 'original-segmentation-fragment-endpoint'})
                if len(candidates) == 3:
                    break
            generation = {'method': 'single-curated-fragment-pair' if len(candidates) == 1 else 'nearby-original-fragment-endpoints',
                          'nearbyRadiusVoxels': NEARBY_RADIUS, 'maxCandidates': 1 if len(candidates) == 1 else 3,
                          'endpointDefinition': 'degree one in the full seger-only graph',
                          'order': 'curated pair' if len(candidates) == 1 else 'ascending Euclidean distance; one endpoint per distinct other fragment'}
        for index, candidate in enumerate(candidates):
            candidate.update(id=chr(ord('b')+index), label=chr(ord('B')+index),
                             sourceVolumePosition=(np.array(candidate['position'])+origin).tolist(),
                             intensityUnit='original-uint16', generationRank=index+1)
        edges = sorted(edge for edge in original_edges if all(n in inside for n in edge))
        spatial = {nid for nid, node in nodes.items() if np.all(node['position'] >= origin)
                   and np.all(node['position'] < origin+SIZE)}
        held_reviewer = [list(edge) for edge, creator in sorted(all_edges.items())
                         if creator != 'seger' and all(n in spatial for n in edge)]
        reference_edges = [{'sourceId': a, 'targetId': b, 'creator': all_edges[tuple(sorted((a, b)))]}
                           for a, b in zip(task['reviewerPath'][:-1], task['reviewerPath'][1:])]
        low, high = np.percentile(raw, [30, 99.95])
        raw8 = np.rint(np.clip((raw.astype(np.float32)-low)/(high-low), 0, 1)*255).astype(np.uint8)
        filename = task['id']+'-32-v3.u8.gz'
        write_gzip(output/filename, raw8.transpose(2, 1, 0).tobytes())
        first = candidates[0]
        task.update(
            candidates=candidates, candidateGeneration=generation, nearbyEndpointCount=len(nearby),
            nearbyEndpointIds=nearby, allowsNone=task['taskType'] == 'point-proposal',
            noneMeaning='true-ending' if task['taskType'] == 'point-proposal' else None,
            allowsUncertain=True, centerReviewStatus='unchecked',
            taskProvenance='curated-segmentation-fragment-replay',
            volume=filename, shape=[SIZE]*3, origin=origin.tolist(), spacing=[1, 1, 1],
            sourceVolume=source_info, compressedBytes=(output/filename).stat().st_size,
            decodedBytes=int(raw8.nbytes),
            intensityMapping={'method': 'linear-clipped-percentile', 'originalType': 'uint16', 'outputType': 'uint8',
                              'low': float(low), 'high': float(high), 'percentiles': [30, 99.95],
                              'originalCropMin': int(raw.min()), 'originalCropMax': int(raw.max()),
                              'note': '8-bit display quantization only; candidate maxima are detected in original uint16 values.'},
            nodes=[{'id': nid, 'position': (nodes[nid]['position']-origin).tolist(), 'component': fragments[nid]}
                   for nid in sorted(inside)], edges=[list(edge) for edge in edges],
            heldOutReviewerEdges=held_reviewer, reviewerPathEdges=reference_edges,
            heldOutEdges=[sorted([source_id, candidate['nodeId']]) for candidate in candidates if candidate['nodeId'] is not None],
            sourceDegree=1, sourceFragmentId=fragments[source_id], sourcePosition=source_local.tolist(),
            historyNodeIds=history_ids, history=[(nodes[nid]['position']-origin).tolist() for nid in history_ids],
            incomingVector=direction.tolist(),
            replayState={'sourceChecked': 0, 'sourceState': 'unchecked', 'basis': 'simulated-pre-review',
                         'savedSourceChecked': nodes[source_id]['checked'], 'initialGraph': 'original-segmentation-fragments'},
            replayNote='Initial graph contains only original seger fragments. Unchecked state is simulated; the source DB remains unchanged.',
            # Transitional aliases only. Runtime decisions must use candidates + selected candidate id.
            targetId=first['nodeId'], targetPosition=first['position'], targetFragmentId=first.get('fragmentId'),
            originalEdgePresent=first.get('originalEdgePresent', False),
        )
        manifest['tasks'].append(task)
        if args.qa:
            qa_image(args.qa/(task['id']+'-qa.png'), raw8, task)
    coarse = np.asarray(volume).reshape(100, 10, 100, 10, 30, 10).max(axis=(1, 3, 5))
    low, high = np.percentile(coarse, [30, 99.7])
    overview = np.rint(np.clip((coarse.astype(np.float32)-low)/(high-low), 0, 1)*255).astype(np.uint8)
    write_gzip(output/'overview.u8.gz', overview.transpose(2, 1, 0).tobytes())
    manifest['overview'] = {'volume': 'overview.u8.gz', 'shape': [100, 100, 30], 'sourceShapeXYZ': list(volume.shape),
                            'downsampleFactor': [10]*3, 'method': '10x10x10 maximum pooling', 'spacing': [10]*3,
                            'compressedBytes': (output/'overview.u8.gz').stat().st_size,
                            'intensityMapping': {'low': float(low), 'high': float(high)},
                            'note': 'Complete public sample block at reduced resolution, not a whole brain or a terabyte dataset.'}
    for stem in ('continuation', 'extension', 'crossing'):
        for suffix in ('.u8.gz', '-32.u8.gz'):
            (output/(stem+suffix)).unlink(missing_ok=True)
    (output/'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    connection.close()
    print(json.dumps({'revision': REVISION, 'tasks': [
        {'id': task['id'], 'sourceId': task['sourceId'], 'nearbyEndpointCount': task['nearbyEndpointCount'],
         'candidates': [{'id': c['id'], 'nodeId': c['nodeId'], 'position': c['position']} for c in task['candidates']],
         'compressedBytes': task['compressedBytes'], 'nodes': len(task['nodes'])} for task in manifest['tasks']]}, indent=2))


if __name__ == '__main__':
    main()
