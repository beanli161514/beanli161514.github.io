import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {VolumeView} from '../src/neurofly-volume.js';

const root = new URL('../public/neurofly/data/', import.meta.url);
const read = name => readFileSync(new URL(name, root));
const spec = JSON.parse(read('tracing.json'));
const manifest = JSON.parse(read('manifest.json'));
const compressed = read(spec.volume), voxels = gunzipSync(compressed);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pair = edge => [...edge].sort((a, b) => a - b).join(':');
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const inside = (point, shape) => point.length === 3 && point.every((n, axis) => Number.isFinite(n) && n >= 0 && n < shape[axis]);

function checkPng(asset) {
  const bytes = read(asset.file);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(hash(bytes), asset.sha256);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR');
  assert.equal(bytes.readUInt32BE(16), asset.width);
  assert.equal(bytes.readUInt32BE(20), asset.height);
}

function checkAxisProjections(projections, shape) {
  const axes = {x: 0, y: 1, z: 2};
  for (const [view, horizontal, vertical, maximum] of [['xy', 'x', 'y', 'z'], ['xz', 'x', 'z', 'y'], ['yz', 'y', 'z', 'x']]) {
    const asset = projections[view];
    assert.equal(asset.horizontalAxis, horizontal);
    assert.equal(asset.verticalAxis, vertical);
    assert.equal(asset.maximumOverAxis, maximum);
    assert.equal(asset.flipHorizontal, false);
    assert.equal(asset.flipVertical, false);
    assert.equal(asset.width, shape[axes[horizontal]]);
    assert.equal(asset.height, shape[axes[vertical]]);
    checkPng(asset);
  }
}

test('tracing payload retains calibrated source space and verified uint8 XYZ addressing', () => {
  assert.equal(spec.kind, 'saved-annotation-replay');
  assert.deepEqual(spec.shape, [96, 96, 96]);
  assert.deepEqual(spec.voxelSizeUM, [1, 1, 1]);
  assert.deepEqual(spec.voxelSizeUM, spec.source.voxelSizeUM);
  assert.deepEqual(spec.physicalExtentUM, spec.shape.map((n, axis) => n * spec.voxelSizeUM[axis]));
  assert.ok(spec.origin.every((n, axis) => Number.isInteger(n) && n >= 0 && n + spec.shape[axis] <= spec.source.shapeXYZ[axis]));
  assert.deepEqual(spec.format.arrayAxes, ['z', 'y', 'x']);
  assert.deepEqual(spec.format.coordinateAxes, ['x', 'y', 'z']);
  assert.equal(spec.format.arrayOrder, 'C');
  assert.equal(spec.format.dtype, 'uint8');
  assert.equal(compressed.length, spec.compressedBytes);
  assert.equal(hash(compressed), spec.sha256);
  assert.equal(voxels.length, spec.decodedBytes);
  assert.equal(voxels.length, spec.shape.reduce((a, b) => a * b, 1));
  assert.equal(hash(voxels), spec.decodedSHA256);
  assert.ok(voxels.some(value => value > 0));
  for (const key of ['filename', 'md5', 'database', 'databaseMD5', 'geometrySHA256']) {
    assert.equal(spec.source[key], manifest.sourceVolume[key]);
  }
});

test('the ordered path keeps one source ID per exact coordinate and every recorded connecting edge', () => {
  assert.equal(spec.nodeIds.length, spec.nodeCount);
  assert.equal(new Set(spec.nodeIds).size, spec.nodeCount);
  assert.equal(spec.pathXYZ.length, spec.nodeCount);
  assert.equal(spec.sourcePathXYZ.length, spec.nodeCount);
  assert.equal(spec.edges.length, spec.nodeCount - 1);
  assert.equal(spec.edgeProvenance.length, spec.edges.length);
  assert.match(spec.provenance.selection, /neither resampled nor smoothed/);
  const creatorCounts = {};
  for (let index = 0; index < spec.nodeCount; index++) {
    const local = spec.pathXYZ[index], source = spec.sourcePathXYZ[index];
    assert.ok(inside(local, spec.shape));
    assert.ok(inside(source, spec.source.shapeXYZ));
    assert.deepEqual(local.map((n, axis) => n + spec.origin[axis]), source);
    if (index === spec.nodeCount - 1) continue;
    const edge = [spec.nodeIds[index], spec.nodeIds[index + 1]];
    assert.deepEqual(spec.edges[index], edge);
    const provenance = spec.edgeProvenance[index];
    assert.deepEqual(provenance.nodeIds, edge);
    assert.ok(provenance.sourceRecords.length > 0);
    const creators = new Set();
    for (const record of provenance.sourceRecords) {
      assert.equal(pair([record.sourceId, record.targetId]), pair(edge));
      assert.equal(typeof record.creator, 'string');
      assert.ok(record.creator.length > 0 && record.date.length > 0);
      creators.add(record.creator);
    }
    for (const creator of creators) creatorCounts[creator] = (creatorCounts[creator] || 0) + 1;
  }
  assert.deepEqual(creatorCounts, spec.edgeCreatorCounts);
  const arcLength = spec.pathXYZ.slice(1).reduce((sum, point, index) => sum + Math.hypot(
    ...point.map((n, axis) => (n - spec.pathXYZ[index][axis]) * spec.voxelSizeUM[axis])), 0);
  near(arcLength, spec.arcLengthUM);

  // Independently exported local-task geometry shares IDs with this longer
  // path, including the actual reviewer join held out of the local input graph.
  const localNodes = new Map(manifest.tasks.flatMap(task => task.nodes.map(node => [node.id,
    node.position.map((n, axis) => n + task.origin[axis])])));
  let shared = 0;
  spec.nodeIds.forEach((id, index) => {
    if (localNodes.has(id)) { shared++; assert.deepEqual(spec.sourcePathXYZ[index], localNodes.get(id)); }
  });
  assert.ok(shared >= 5, 'the replay must remain linked to independently packaged task annotations');
  const heldOut = new Set(manifest.tasks.flatMap(task => task.heldOutReviewerEdges.map(pair)));
  const reviewed = spec.edgeProvenance.filter(edge => edge.sourceRecords.some(record => record.creator === 'tester'));
  assert.ok(reviewed.length > 0);
  assert.ok(reviewed.every(edge => heldOut.has(pair(edge.nodeIds))));
});

test('diagram context is a true 32³ crop with the same five consecutive annotated history points', () => {
  const context = spec.diagramContext;
  assert.deepEqual(context.shape, [32, 32, 32]);
  assert.deepEqual(context.voxelSizeUM, spec.voxelSizeUM);
  assert.ok(context.origin.every((n, axis) => Number.isInteger(n) && n >= 0 && n + context.shape[axis] <= spec.shape[axis]));
  assert.deepEqual(context.absoluteSourceOrigin, context.origin.map((n, axis) => n + spec.origin[axis]));
  assert.equal(spec.historyIndices.length, 5);
  assert.deepEqual(spec.historyIndices.slice(1), spec.historyIndices.slice(0, -1).map(index => index + 1));
  assert.deepEqual(spec.historyNodeIds, spec.historyIndices.map(index => spec.nodeIds[index]));
  assert.deepEqual(spec.historyXYZ, spec.historyIndices.map(index => spec.pathXYZ[index]));
  assert.deepEqual(context.historyNodeIds, spec.historyNodeIds);
  assert.deepEqual(context.historyXYZ, spec.historyXYZ.map(point => point.map((n, axis) => n - context.origin[axis])));
  assert.ok(context.historyXYZ.every(point => inside(point, context.shape)));
  checkAxisProjections(spec.projections, spec.shape);
  checkAxisProjections(context.projections, context.shape);
  const oblique = context.obliqueProjection;
  checkPng(oblique);
  assert.equal(oblique.width, oblique.bounds[2] - oblique.bounds[0]);
  assert.equal(oblique.height, oblique.bounds[3] - oblique.bounds[1]);
  assert.equal(oblique.matrix.length, 2);
  assert.ok(oblique.matrix.every(row => row.length === 3 && row.every(Number.isFinite)));
  // The projected cube and all history centers must land inside the image
  // bounds used to place that PNG in the schematic, with no implicit flips.
  const normalized = context.historyXYZ.map(point => point.map((n, axis) => (n + .5) / context.shape[axis]));
  for (let corner = 0; corner < 8; corner++) normalized.push([corner & 1, (corner >> 1) & 1, (corner >> 2) & 1]);
  for (const point of normalized) {
    const screen = oblique.matrix.map((row, i) => oblique.offset[i] + row.reduce((sum, n, axis) => sum + n * point[axis], 0));
    assert.ok(screen[0] >= oblique.bounds[0] && screen[0] <= oblique.bounds[2]);
    assert.ok(screen[1] >= oblique.bounds[1] && screen[1] <= oblique.bounds[3]);
  }
});

test('fiber reveal shows exactly the requested prefix, adjacent edges and current tip without changing source positions', () => {
  const original = structuredClone(spec.pathXYZ), geometries = [];
  const stub = {
    annotations: {traverse() {}, clear() {}}, labels: [], labelEntries: [],
    render() {},
    makePoints(positions) {
      return {positions, count: positions.length / 3, instanceMatrix: {}, setMatrixAt(index, matrix) {
        this.tipPosition = matrix.elements.slice(12, 15);
      }};
    },
    makeLine(positions) {
      geometries.push(positions);
      return {geometry: {instanceCount: positions.length / 6}};
    },
    setFiberProgress: VolumeView.prototype.setFiberProgress,
  };
  VolumeView.prototype.setFiberPath.call(stub, spec.pathXYZ);
  assert.deepEqual(geometries[0], spec.pathXYZ.slice(1).flatMap((point, index) => [...spec.pathXYZ[index], ...point]));
  const n = spec.nodeCount;
  for (const [input, expected] of [[0, 0], [1, 1], [5, 5], [n, n], [n + 10, n], [-3, 0], [3.8, 3], [NaN, 0]]) {
    stub.setFiberProgress(input);
    assert.equal(stub.fiber.points.count, expected);
    assert.equal(stub.fiber.lines.geometry.instanceCount, Math.max(0, expected - 1));
    assert.equal(stub.fiber.tip.count, expected ? 1 : 0);
    if (expected) assert.deepEqual(stub.fiber.tip.tipPosition, spec.pathXYZ[expected - 1]);
  }
  assert.deepEqual(spec.pathXYZ, original);
  assert.notEqual(stub.fiber.positions[0], spec.pathXYZ[0]);
});
