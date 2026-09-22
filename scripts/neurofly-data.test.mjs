import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const root = new URL('../public/neurofly/data/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
const pair = (a, b) => JSON.stringify([a, b].sort((x, y) => x - y));
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const almost = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const volumeBytes = spec => gunzipSync(readFileSync(new URL(spec.volume, root)));
const voxelIndex = ([x, y, z]) => x + 32 * (y + 32 * z);

test('whole-brain reference retains calibrated physical scale and fits the illustrative block', () => {
  const brain = JSON.parse(readFileSync(new URL('brain-reference.json', root)));
  const compressed = readFileSync(new URL(brain.volume, root));
  const voxels = gunzipSync(compressed);
  assert.equal(compressed.length, brain.compressedBytes);
  assert.equal(voxels.length, brain.shape.reduce((a, b) => a * b, 1));
  assert.deepEqual(brain.spacingMM, [1, 1, 1]);
  assert.deepEqual(brain.shape.map((n, i) => n * brain.spacingMM[i]), brain.physicalExtentMM);
  assert.equal(brain.registration.registeredToMicroscopy, false);
  const blockSize = manifest.sourceVolume.shapeXYZ.map((n, i) => n * manifest.sourceVolume.voxelSizeUM[i] / 1000);
  assert.deepEqual(blockSize, brain.illustrativeBlockSizeMM);
  brain.illustrativeBlockCenterXYZ.forEach((n, i) => {
    const half = blockSize[i] / brain.spacingMM[i] / 2;
    assert.ok(n - half >= -.5 && n + half <= brain.shape[i] - .5);
    const affine = brain.affineVoxelToRASMM[i];
    almost(affine[0] * brain.illustrativeBlockCenterXYZ[0] + affine[1] * brain.illustrativeBlockCenterXYZ[1] + affine[2] * brain.illustrativeBlockCenterXYZ[2] + affine[3], brain.illustrativeBlockCenterRASMM[i]);
  });
  const [x, y, z] = brain.illustrativeBlockCenterXYZ.map(Math.round);
  assert.ok(voxels[x + brain.shape[0] * (y + brain.shape[1] * z)] > 0, 'illustrative location lies inside brain signal');
});

function reachable(edges, start) {
  const found = new Set([start]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of edges) {
      if (found.has(a) && !found.has(b)) { found.add(b); changed = true; }
      if (found.has(b) && !found.has(a)) { found.add(a); changed = true; }
    }
  }
  return found;
}

test('revision 3 contains three distinct task types with genuine 32³ payloads', () => {
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.dataRevision, 3);
  assert.equal(manifest.revision, 'three-task-types-32-v3');
  assert.deepEqual(manifest.tasks.map(task => task.taskType), ['fragment-connection', 'endpoint-selection', 'point-proposal']);
  assert.equal(manifest.axes.positions, 'xyz');
  assert.equal(manifest.axes.unit, 'voxel');
  assert.equal(manifest.sourceVolume.spacingCalibrated, true);
  assert.equal(manifest.taskDesign.initialEdges, 'seger only');
  assert.deepEqual(manifest.taskDesign.noneAvailableFor, ['point-proposal']);
  for (const task of manifest.tasks) {
    assert.deepEqual(task.shape, [32, 32, 32]);
    assert.equal(task.volume, `${task.id}-32-v3.u8.gz`);
    assert.equal(task.decodedBytes, 32768);
  }
  for (const spec of [...manifest.tasks, manifest.overview]) {
    const compressed = readFileSync(new URL(spec.volume, root));
    const decoded = gunzipSync(compressed);
    assert.equal(compressed.length, spec.compressedBytes);
    assert.equal(decoded.length, spec.shape.reduce((a, b) => a * b, 1));
    assert.ok(decoded.some(value => value > 0));
  }
  assert.deepEqual(manifest.overview.shape.map((n, i) => n * manifest.overview.downsampleFactor[i]), manifest.sourceVolume.shapeXYZ);
});

test('confirmed physical calibration preserves voxel geometry and the source-to-task scale', () => {
  const source = manifest.sourceVolume;
  assert.deepEqual(source.voxelSizeUM, [1, 1, 1]);
  assert.equal(source.calibrationSource.type, 'user-confirmed');
  assert.deepEqual(manifest.axes.spacing, [1, 1, 1]);
  assert.deepEqual(manifest.axes.physicalSpacingUM, source.voxelSizeUM);
  assert.equal(manifest.axes.unit, 'voxel');
  assert.deepEqual(source.shapeXYZ.map((n, axis) => n * source.voxelSizeUM[axis] / 1000), [1, 1, 0.3]);
  for (const task of manifest.tasks) {
    assert.deepEqual(task.sourceVolume, source);
    assert.deepEqual(task.shape.map((n, axis) => n * source.voxelSizeUM[axis]), [32, 32, 32]);
  }
});

test('sources, graphs and candidate coordinates share one local voxel coordinate system', () => {
  for (const task of manifest.tasks) {
    assert.equal(task.centerReviewStatus, 'unchecked');
    assert.equal(task.replayState.sourceChecked, 0);
    assert.equal(task.replayState.basis, 'simulated-pre-review');
    assert.deepEqual(task.sourceVolume, manifest.sourceVolume);
    assert.ok(task.origin.every((n, i) => n >= 0 && n + 32 <= manifest.sourceVolume.shapeXYZ[i]));
    const nodes = new Map(task.nodes.map(node => [node.id, node]));
    assert.equal(nodes.size, task.nodes.length);
    for (const node of task.nodes) {
      assert.ok(node.position.every(n => Number.isFinite(n) && n >= 0 && n < 32));
    }
    assert.deepEqual(task.sourcePosition, [16, 16, 16]);
    assert.deepEqual(nodes.get(task.sourceId).position, task.sourcePosition);
    assert.equal(task.sourceDegree, 1);
    assert.equal(task.edges.filter(edge => edge.includes(task.sourceId)).length, 1);
    assert.equal(task.sourceFragmentId, nodes.get(task.sourceId).component);
    const initialPairs = new Set(task.edges.map(([a, b]) => pair(a, b)));
    assert.equal(initialPairs.size, task.edges.length);
    for (const [a, b] of task.edges) assert.ok(nodes.has(a) && nodes.has(b));
    for (const [a, b] of task.heldOutReviewerEdges) assert.ok(!initialPairs.has(pair(a, b)));
    assert.deepEqual(task.history, task.historyNodeIds.map(id => nodes.get(id).position));
    almost(Math.hypot(...task.incomingVector), 1);
    const bytes = volumeBytes(task);
    for (const [i, candidate] of task.candidates.entries()) {
      assert.equal(candidate.id, String.fromCharCode(98 + i));
      assert.equal(candidate.label, String.fromCharCode(66 + i));
      assert.ok(candidate.position.every(n => Number.isInteger(n) && n >= 0 && n < 32));
      assert.deepEqual(candidate.sourceVolumePosition, candidate.position.map((n, axis) => n + task.origin[axis]));
      almost(candidate.distanceVoxels, distance(candidate.position, task.sourcePosition));
      const delta = candidate.position.map((n, axis) => n - task.sourcePosition[axis]);
      almost(candidate.directionCosine, dot(delta, task.incomingVector) / candidate.distanceVoxels);
      const mapped = Math.round(255 * Math.max(0, Math.min(1,
        (candidate.intensity - task.intensityMapping.low) / (task.intensityMapping.high - task.intensityMapping.low))));
      assert.ok(Math.abs(bytes[voxelIndex(candidate.position)] - mapped) <= 1, 'candidate intensity must align with xyz volume addressing');
      if (candidate.kind === 'fragment-endpoint') {
        assert.ok(nodes.has(candidate.nodeId));
        assert.deepEqual(candidate.position, nodes.get(candidate.nodeId).position);
        assert.equal(candidate.fragmentId, nodes.get(candidate.nodeId).component);
        assert.notEqual(candidate.fragmentId, task.sourceFragmentId);
        assert.equal(candidate.endpointDegree, 1);
        assert.ok(task.nearbyEndpointIds.includes(candidate.nodeId));
        assert.ok(!reachable(task.edges, task.sourceId).has(candidate.nodeId));
        assert.ok(candidate.distanceVoxels <= task.candidateGeneration.nearbyRadiusVoxels);
      }
    }
    assert.equal(task.nearbyEndpointIds.length, task.nearbyEndpointCount);
    assert.equal(task.allowsUncertain, true);
  }
});

test('connection and endpoint-selection tasks preserve their different action spaces', () => {
  const connection = manifest.tasks.find(task => task.taskType === 'fragment-connection');
  assert.equal(connection.candidates.length, 1);
  assert.equal(connection.candidates[0].kind, 'fragment-endpoint');
  assert.equal(connection.allowsNone, false);
  assert.equal(connection.referenceDecision, 'accept');
  assert.equal(connection.referenceCandidateId, 'b');
  assert.deepEqual(connection.reviewerPath, [2667, 2769]);
  const selection = manifest.tasks.find(task => task.taskType === 'endpoint-selection');
  assert.ok(selection.candidates.length >= 2);
  assert.ok(selection.candidates.every(candidate => candidate.kind === 'fragment-endpoint'));
  assert.equal(new Set(selection.candidates.map(candidate => candidate.fragmentId)).size, selection.candidates.length);
  assert.equal(selection.allowsNone, false);
  assert.equal(selection.referenceDecision, null);
  assert.equal(selection.referenceCandidateId, null);
});

test('point proposals are spatially separated measured maxima with no nearby fragment endpoint', () => {
  const task = manifest.tasks.find(task => task.taskType === 'point-proposal');
  assert.equal(task.nearbyEndpointCount, 0);
  assert.deepEqual(task.nearbyEndpointIds, []);
  assert.equal(task.allowsNone, true);
  assert.equal(task.noneMeaning, 'true-ending');
  assert.equal(task.referenceDecision, null);
  assert.equal(task.referenceCandidateId, null);
  assert.ok(task.candidates.length >= 2);
  const params = task.candidateGeneration;
  assert.equal(params.nearbyRadiusVoxels, 12);
  assert.deepEqual(params.distanceRangeVoxels, [5, 10]);
  const bytes = volumeBytes(task);
  for (const [index, candidate] of task.candidates.entries()) {
    assert.equal(candidate.kind, 'image-point');
    assert.equal(candidate.nodeId, null);
    assert.equal(candidate.isLocalMaximum, true);
    assert.ok(candidate.distanceVoxels >= 5 && candidate.distanceVoxels <= 10);
    assert.ok(candidate.directionCosine >= params.minimumDirectionCosine);
    assert.ok(candidate.intensity >= params.intensityThresholdValue);
    const [x, y, z] = candidate.position;
    const center = bytes[voxelIndex(candidate.position)];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      assert.ok(bytes[voxelIndex([x + dx, y + dy, z + dz])] <= center, 'quantized point must remain a local intensity maximum');
    }
    const ray = candidate.position.map((n, axis) => (n - task.sourcePosition[axis]) / candidate.distanceVoxels);
    for (const other of task.candidates.slice(0, index)) {
      assert.ok(distance(candidate.position, other.position) >= params.minimumCandidateSeparationVoxels);
      const otherRay = other.position.map((n, axis) => (n - task.sourcePosition[axis]) / other.distanceVoxels);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(ray, otherRay)))) * 180 / Math.PI;
      assert.ok(angle >= params.minimumBearingSeparationDegrees);
    }
  }
});
