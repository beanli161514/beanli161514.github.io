import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {makeReview, createExport, graphEdgesAfterReview} from '../src/neurofly-review.js';

const root = new URL('../public/neurofly/data/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
const pair = (a, b) => JSON.stringify([a, b].sort((x, y) => x - y));

test('packaged microscopy volumes match their declared dimensions and transfer sizes', () => {
  for (const spec of [...manifest.tasks, manifest.overview]) {
    assert.equal(spec.shape.length, 3);
    assert.ok(spec.shape.every(n => Number.isInteger(n) && n > 0));
    const encoded = readFileSync(new URL(spec.volume, root));
    const decoded = gunzipSync(encoded);
    assert.equal(encoded.length, spec.compressedBytes, spec.volume);
    assert.equal(decoded.length, spec.shape.reduce((a, b) => a * b, 1), spec.volume);
    assert.ok(decoded.some(value => value > 0), `${spec.volume} must contain image signal`);
  }
  assert.deepEqual(manifest.overview.shape.map((n, i) => n * manifest.overview.downsampleFactor[i]), manifest.sourceVolume.shapeXYZ);
  assert.equal(manifest.sourceVolume.voxelCount, manifest.sourceVolume.shapeXYZ.reduce((a, b) => a * b, 1));
});

test('replay graph coordinates are in bounds, candidate edges are held out, and exported reviews remain unverified', () => {
  assert.equal(manifest.kind, 'curated-decision-replay');
  assert.equal(manifest.axes.positions, 'xyz');
  assert.equal(manifest.axes.unit, 'voxel');
  assert.equal(manifest.sourceVolume.spacingCalibrated, false);
  assert.ok(manifest.provenance.url && manifest.provenance.license);
  assert.equal(new Set(manifest.tasks.map(task => task.id)).size, manifest.tasks.length);
  for (const task of manifest.tasks) {
    assert.deepEqual(task.sourceVolume, manifest.sourceVolume);
    assert.ok(task.origin.every((n, i) => n >= 0 && n + task.shape[i] <= task.sourceVolume.shapeXYZ[i]));
    const nodes = new Map(task.nodes.map(node => [node.id, node.position]));
    assert.equal(nodes.size, task.nodes.length, `${task.id}: node IDs must be unique`);
    for (const node of task.nodes) {
      assert.equal(node.position.length, 3);
      assert.ok(node.position.every((n, i) => Number.isFinite(n) && n >= 0 && n < task.shape[i]), `${task.id}: node ${node.id} must be inside the crop`);
    }
    const candidate = pair(task.sourceId, task.targetId);
    assert.deepEqual(nodes.get(task.sourceId), task.sourcePosition);
    assert.deepEqual(nodes.get(task.targetId), task.targetPosition);
    assert.ok(task.heldOutEdges.some(([a, b]) => pair(a, b) === candidate));
    assert.equal(new Set(task.edges.map(([a, b]) => pair(a, b))).size, task.edges.length);
    for (const [a, b] of task.edges) {
      assert.ok(nodes.has(a) && nodes.has(b), `${task.id}: edge endpoints must exist`);
      assert.notEqual(pair(a, b), candidate, `${task.id}: candidate must remain held out`);
    }
    assert.deepEqual(task.history, task.historyNodeIds.map(id => nodes.get(id)));
    const uncertain = makeReview(task, 'uncertain', {timestamp: '2026-09-22T00:00:00.000Z'});
    assert.deepEqual(graphEdgesAfterReview(task, uncertain), task.edges);
    const exported = createExport([uncertain, makeReview(task, 'accept')]);
    assert.equal(exported.supervisedCandidates.length, 1);
    assert.ok(exported.reviews.every(record => record.validation === 'unverified-demo-review' && record.provenance === 'interactive-demo'));
  }
});
