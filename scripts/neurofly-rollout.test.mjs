import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFiberRollout} from '../src/neurofly-rollout.js';

const spec = JSON.parse(readFileSync(new URL('../public/neurofly/data/tracing.json', import.meta.url)));
const ranges = [[0, 4], [11, 16], [24, 28], [37, 42], [49, 52]];
const edgeKey = edge => [...edge].sort((a, b) => a - b).join(':');
const original = new Set(spec.edges.map(edgeKey));

test('five existing fragments produce 29 point extensions and four joins in a deterministic 33-step walkthrough', () => {
  const rollout = createFiberRollout(spec), states = [rollout.initial, ...rollout.steps];
  assert.deepEqual(rollout.fragments.map(fragment => fragment.range), ranges);
  assert.deepEqual(rollout.initial.visibleNodeIndices, ranges.flatMap(([start, end]) => Array.from({length: end - start + 1}, (_, i) => start + i)));
  assert.equal(rollout.initial.visibleNodeIndices.length, 26);
  assert.equal(rollout.initial.visibleEdges.length, 21);
  assert.equal(rollout.initial.connectedThrough, 4);
  assert.equal(rollout.initial.fragmentCount, 5);
  assert.equal(rollout.initial.taskType, null);
  assert.equal(rollout.initial.option, null);
  assert.equal(rollout.initial.activeEdge, null);
  assert.equal(rollout.steps.length, 33);
  assert.equal(rollout.steps.filter(step => step.taskType === 'point-proposal').length, 29);
  assert.deepEqual(rollout.steps.at(-1).visibleNodeIndices, spec.pathXYZ.map((_, i) => i));
  assert.equal(rollout.steps.at(-1).visibleEdges.length, spec.pathXYZ.length - 1);
  assert.equal(rollout.steps.at(-1).connectedThrough, 54);
  assert.equal(rollout.steps.at(-1).fragmentCount, 1);
  for (const state of states) {
    const nodes = new Set(state.visibleNodeIndices);
    assert.equal(nodes.size, state.visibleNodeIndices.length);
    assert.equal(new Set(state.visibleEdges.map(edgeKey)).size, state.visibleEdges.length);
    assert.equal(state.tipIndex, state.connectedThrough);
    assert.ok(state.visibleNodeIndices.every(index => Number.isInteger(index) && index >= 0 && index < spec.nodeCount));
    for (const [a, b] of state.visibleEdges) {
      assert.ok(nodes.has(a) && nodes.has(b));
      assert.equal(b, a + 1);
      assert.ok(original.has(edgeKey([spec.nodeIds[a], spec.nodeIds[b]])), 'no invented annotation edge');
    }
    assert.equal(state.fragmentCount, nodes.size - state.visibleEdges.length);
    for (let i = 0; i < state.connectedThrough; i++) assert.ok(state.visibleEdges.some(([a, b]) => a === i && b === i + 1));
  }
  assert.deepEqual(createFiberRollout(spec), rollout);
});

test('extensions add one original point; joins add only the missing bridge and adopt an entire known fragment', () => {
  const {initial, steps} = createFiberRollout(spec);
  let previous = initial, joins = 0;
  for (const step of steps) {
    const oldEdges = new Set(previous.visibleEdges.map(edgeKey));
    const addedEdges = step.visibleEdges.filter(edge => !oldEdges.has(edgeKey(edge)));
    assert.deepEqual(addedEdges, [step.activeEdge]);
    assert.deepEqual(step.activeEdge, [previous.connectedThrough, previous.connectedThrough + 1]);
    assert.ok(previous.visibleEdges.every(edge => step.visibleEdges.some(current => edgeKey(current) === edgeKey(edge))));
    const addedNodes = step.visibleNodeIndices.filter(index => !previous.visibleNodeIndices.includes(index));
    if (step.taskType === 'point-proposal') {
      assert.deepEqual(addedNodes, [step.activeEdge[1]]);
      assert.equal(step.connectedThrough, previous.connectedThrough + 1);
      assert.equal(step.fragmentCount, previous.fragmentCount);
      assert.equal(step.option, 'B');
      assert.deepEqual(step.candidates, [{label: 'B', index: step.activeEdge[1]}]);
    } else {
      joins++;
      const [start, end] = ranges[joins];
      assert.deepEqual(addedNodes, []);
      assert.equal(step.activeEdge[1], start);
      assert.equal(step.connectedThrough, end);
      assert.equal(step.fragmentCount, previous.fragmentCount - 1);
      assert.equal(step.taskType, joins % 2 ? 'fragment-connection' : 'endpoint-selection');
      assert.equal(step.option, joins % 2 ? 'Accept' : 'B');
      assert.deepEqual(step.candidates, joins % 2 ? [{label: 'B', index: start}] : [{label: 'B', index: start}, {label: 'C', index: end}]);
    }
    const source = spec.pathXYZ[step.activeEdge[0]];
    for (const {index} of step.candidates) {
      assert.ok(spec.pathXYZ[index].every((n, axis) => n - source[axis] >= -16 && n - source[axis] < 16));
    }
    assert.ok(!['None', 'Reject', 'Uncertain'].includes(step.option));
    previous = step;
  }
  assert.equal(joins, 4);
  assert.equal(steps.at(-1).taskType, 'point-proposal');
  assert.match(steps.at(-1).detail, /displayed (path|volume)/);
});

test('scrubbing states in any order cannot modify earlier snapshots or the source annotation', () => {
  const sourceBefore = structuredClone(spec), rollout = createFiberRollout(spec);
  const expected = structuredClone(rollout);
  for (const index of [32, 0, 15, 7, 31, 3]) assert.deepEqual(rollout.steps[index], expected.steps[index]);
  const last = rollout.steps.at(-1);
  last.visibleNodeIndices[0] = 999;
  last.visibleEdges[0][0] = 999;
  last.activeEdge[0] = 999;
  last.candidates[0].index = 999;
  rollout.fragments[0].nodeIndices[0] = 999;
  rollout.fragments[0].range[0] = 999;
  assert.deepEqual(rollout.initial, expected.initial);
  assert.deepEqual(rollout.steps.slice(0, -1), expected.steps.slice(0, -1));
  assert.deepEqual(spec, sourceBefore);
  assert.deepEqual(createFiberRollout(spec), expected);
});

test('broken source paths and out-of-context endpoint alternatives cannot masquerade as a valid replay', () => {
  assert.throws(() => createFiberRollout({...spec, pathXYZ: spec.pathXYZ.slice(1)}), /55-point/);
  assert.throws(() => createFiberRollout({...spec, edges: spec.edges.slice(1)}), /Missing original/);
  const duplicate = structuredClone(spec);
  duplicate.nodeIds[0] = duplicate.nodeIds[1];
  assert.throws(() => createFiberRollout(duplicate), /source IDs/);
  const outside = structuredClone(spec);
  outside.pathXYZ[28][0] = outside.pathXYZ[23][0] + 20;
  assert.throws(() => createFiberRollout(outside), /32³ window/);
});
