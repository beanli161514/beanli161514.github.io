import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root = new URL('../public/neurofly/data/', import.meta.url);
const context = JSON.parse(readFileSync(new URL('tracing-context.json', root)));
const tracing = JSON.parse(readFileSync(new URL('tracing.json', root)));
const pair = edge => [...edge].sort((a, b) => a - b).join(':');
const inside = point => point.every((n, axis) => n >= context.clipBoundsXYZ.min[axis] && n <= context.clipBoundsXYZ.max[axis]);

test('all-annotation context shares the exact tracing crop, source fingerprint and physical voxel grid', () => {
  assert.equal(context.kind, 'saved-annotation-crop-context');
  assert.deepEqual(context.origin, tracing.origin);
  assert.deepEqual(context.shape, tracing.shape);
  assert.deepEqual(context.voxelSizeUM, tracing.voxelSizeUM);
  assert.deepEqual(context.clipBoundsXYZ.min, [-.5, -.5, -.5]);
  assert.deepEqual(context.clipBoundsXYZ.max, tracing.shape.map(n => n - .5));
  assert.equal(context.source.databaseMD5, tracing.source.databaseMD5);
  assert.equal(context.source.geometrySHA256, tracing.source.geometrySHA256);
  assert.equal(context.source.imageMD5, tracing.source.md5);
  assert.equal(context.volume, tracing.volume);
  assert.equal(context.volumeSHA256, createHash('sha256').update(readFileSync(new URL(tracing.volume, root))).digest('hex'));
  assert.equal(context.nodeCount, 165);
  assert.equal(context.edgeCount, 160);
  assert.equal(context.interiorNodeCount, 155);
  assert.equal(context.outsideEndpointCount, 10);
  assert.equal(context.boundaryCrossingEdgeCount, 10);
});

test('context retains genuine focal geometry, all interior annotations and necessary unclipped boundary endpoints', () => {
  const nodes = new Map(context.nodes.map(node => [node.id, node.position]));
  const edges = new Set(context.edges.map(pair));
  assert.equal(nodes.size, context.nodeCount);
  assert.equal(context.nodes.length, context.nodeCount);
  assert.equal(edges.size, context.edgeCount);
  assert.equal(context.edges.length, context.edgeCount);
  assert.equal(context.edgeProvenance.length, context.edgeCount);
  const degrees = new Map(), creators = {};
  let crossing = 0, bothOutside = 0;
  for (const [index, [a, b]] of context.edges.entries()) {
    assert.ok(a !== b && nodes.has(a) && nodes.has(b));
    const pa = nodes.get(a), pb = nodes.get(b);
    // A nonempty parameter interval certifies actual geometric intersection,
    // rather than assuming that proximity or one endpoint implies visibility.
    let enter = 0, leave = 1;
    for (let axis = 0; axis < 3; axis++) {
      const delta = pb[axis] - pa[axis];
      if (delta === 0) {
        assert.ok(pa[axis] >= context.clipBoundsXYZ.min[axis] && pa[axis] <= context.clipBoundsXYZ.max[axis]);
      } else {
        const t = [context.clipBoundsXYZ.min[axis], context.clipBoundsXYZ.max[axis]].map(bound => (bound - pa[axis]) / delta).sort((x, y) => x - y);
        enter = Math.max(enter, t[0]); leave = Math.min(leave, t[1]);
      }
    }
    assert.ok(enter <= leave, 'every retained edge intersects the actual voxel grid');
    if (!inside(pa) || !inside(pb)) crossing++;
    if (!inside(pa) && !inside(pb)) bothOutside++;
    for (const id of [a, b]) degrees.set(id, (degrees.get(id) || 0) + 1);
    const provenance = context.edgeProvenance[index];
    assert.equal(pair(provenance.nodeIds), pair([a, b]));
    assert.ok(provenance.creators.length > 0);
    for (const creator of provenance.creators) creators[creator] = (creators[creator] || 0) + 1;
  }
  assert.equal(crossing, context.boundaryCrossingEdgeCount);
  assert.equal(bothOutside, context.bothOutsideCrossingEdgeCount);
  assert.deepEqual(creators, context.edgeCreatorCounts);
  assert.equal(context.nodes.filter(node => inside(node.position)).length, context.interiorNodeCount);
  assert.equal(context.nodes.filter(node => inside(node.position) && !degrees.has(node.id)).length, context.interiorIsolatedNodeCount);
  for (const {id, position} of context.nodes) {
    assert.equal(position.length, 3);
    assert.ok(position.every(Number.isFinite));
    if (!inside(position)) assert.ok(degrees.has(id), 'outside nodes are retained only as required source endpoints');
  }
  tracing.nodeIds.forEach((id, index) => assert.deepEqual(nodes.get(id), tracing.pathXYZ[index]));
  assert.ok(tracing.edges.every(edge => edges.has(pair(edge))));
  assert.ok(context.nodeCount > tracing.nodeCount && context.edgeCount > tracing.edges.length);
});
