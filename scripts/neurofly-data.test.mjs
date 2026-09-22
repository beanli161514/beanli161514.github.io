import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {makeReview, createExport, graphEdgesAfterReview} from '../src/neurofly-review.js';

const root = new URL('../public/neurofly/data/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
const pair = (a, b) => JSON.stringify([a, b].sort((x, y) => x - y));

function reachable(edges, start) {
  const reached = new Set([start]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of edges) {
      if (reached.has(a) && !reached.has(b)) { reached.add(b); changed = true; }
      if (reached.has(b) && !reached.has(a)) { reached.add(a); changed = true; }
    }
  }
  return reached;
}

test('packaged task volumes are true 32-cubes with declared transfer sizes', () => {
  for (const task of manifest.tasks) {
    assert.deepEqual(task.shape, [32, 32, 32]);
    assert.equal(task.volume, `${task.id}-32.u8.gz`);
    assert.equal(task.decodedBytes, 32768);
  }
  for (const spec of [...manifest.tasks, manifest.overview]) {
    const encoded = readFileSync(new URL(spec.volume, root));
    const decoded = gunzipSync(encoded);
    assert.equal(encoded.length, spec.compressedBytes, spec.volume);
    assert.equal(decoded.length, spec.shape.reduce((a, b) => a * b, 1), spec.volume);
    assert.ok(decoded.some(value => value > 0), `${spec.volume} must contain image signal`);
  }
  assert.deepEqual(manifest.overview.shape.map((n, i) => n * manifest.overview.downsampleFactor[i]), manifest.sourceVolume.shapeXYZ);
  assert.equal(manifest.sourceVolume.voxelCount, manifest.sourceVolume.shapeXYZ.reduce((a, b) => a * b, 1));
});

test('task design uses centered unchecked endpoints and candidates in different original fragments', () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.revision, 'endpoint-fragments-32-v2');
  assert.equal(manifest.kind, 'curated-decision-replay');
  assert.equal(manifest.axes.positions, 'xyz');
  assert.equal(manifest.axes.unit, 'voxel');
  assert.equal(manifest.sourceVolume.spacingCalibrated, false);
  assert.deepEqual(manifest.taskDesign.choices, ['accept', 'reject', 'uncertain']);
  assert.equal(manifest.taskDesign.initialEdges, 'seger only');
  assert.ok(manifest.provenance.url && manifest.provenance.license);
  assert.equal(new Set(manifest.tasks.map(task => task.id)).size, manifest.tasks.length);
  assert.equal(new Set(manifest.tasks.map(task => task.prompt)).size, 1);
  for (const task of manifest.tasks) {
    assert.equal(task.prompt, 'Should this candidate connection be accepted?');
    assert.equal(task.centerReviewStatus, 'unchecked');
    assert.equal(task.taskType, 'endpoint-fragment-connection');
    assert.equal(task.replayState.sourceChecked, 0);
    assert.equal(task.replayState.basis, 'simulated-pre-review');
    assert.deepEqual(task.sourceVolume, manifest.sourceVolume);
    assert.ok(task.origin.every((n, i) => n >= 0 && n + task.shape[i] <= task.sourceVolume.shapeXYZ[i]));
    const nodes = new Map(task.nodes.map(node => [node.id, node]));
    assert.equal(nodes.size, task.nodes.length, `${task.id}: node IDs must be unique`);
    for (const node of task.nodes) {
      assert.equal(node.position.length, 3);
      assert.ok(node.position.every((n, i) => Number.isFinite(n) && n >= 0 && n < task.shape[i]), `${task.id}: node ${node.id} must be inside the crop`);
    }
    assert.deepEqual(nodes.get(task.sourceId).position, [16, 16, 16]);
    assert.deepEqual(nodes.get(task.sourceId).position, task.sourcePosition);
    assert.deepEqual(nodes.get(task.targetId).position, task.targetPosition);
    assert.notEqual(nodes.get(task.sourceId).component, nodes.get(task.targetId).component);
    assert.equal(nodes.get(task.sourceId).component, task.sourceFragmentId);
    assert.equal(nodes.get(task.targetId).component, task.targetFragmentId);
    assert.equal(task.sourceDegree, 1);
    assert.equal(task.edges.filter(edge => edge.includes(task.sourceId)).length, 1);
    assert.ok(!reachable(task.edges, task.sourceId).has(task.targetId));
    const candidate = pair(task.sourceId, task.targetId);
    assert.ok(task.heldOutEdges.some(([a, b]) => pair(a, b) === candidate));
    const initialPairs = new Set(task.edges.map(([a, b]) => pair(a, b)));
    assert.equal(initialPairs.size, task.edges.length);
    for (const [a, b] of task.edges) {
      assert.ok(nodes.has(a) && nodes.has(b), `${task.id}: edge endpoints must exist`);
      assert.notEqual(pair(a, b), candidate, `${task.id}: candidate must remain unconnected`);
    }
    for (const [a, b] of task.heldOutReviewerEdges) assert.ok(!initialPairs.has(pair(a, b)));
    assert.deepEqual(task.history, task.historyNodeIds.map(id => nodes.get(id).position));
    assert.equal(task.reviewerPath[0], task.sourceId);
    assert.equal(task.reviewerPath.at(-1), task.targetId);
    assert.equal(task.reviewerPathEdges.length, task.reviewerPath.length - 1);
  }
});

test('saved reference paths are not confused with direct candidate edges or verified visitor labels', () => {
  const extension = manifest.tasks.find(task => task.id === 'extension');
  assert.equal(extension.targetId, 3867);
  assert.equal(extension.originalEdgePresent, false);
  assert.deepEqual(extension.reviewerPath, [3814, 6740, 7473, 3867]);
  assert.deepEqual(extension.reviewerPathEdges.map(edge => edge.creator), ['tester', 'astar', 'astar']);
  assert.equal(manifest.tasks.find(task => task.id === 'crossing').referenceDecision, null);
  for (const task of manifest.tasks) {
    const uncertain = makeReview(task, 'uncertain', {timestamp: '2026-09-23T00:00:00.000Z'});
    assert.deepEqual(graphEdgesAfterReview(task, uncertain), task.edges);
    const exported = createExport([uncertain, makeReview(task, 'accept')]);
    assert.equal(exported.supervisedCandidates.length, 1);
    assert.ok(exported.reviews.every(record => record.validation === 'unverified-demo-review' && record.provenance === 'interactive-demo'));
  }
});
