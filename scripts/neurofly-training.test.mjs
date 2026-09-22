import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeReview} from '../src/neurofly-review.js';
import {makeTrainingExample} from '../src/neurofly-training.js';

const manifest = JSON.parse(readFileSync(new URL('../public/neurofly/data/manifest.json', import.meta.url)));
const tasks = manifest.tasks.map(task => ({...task, revision: manifest.revision, dataRevision: manifest.dataRevision}));
const byType = Object.fromEntries(tasks.map(task => [task.taskType, task]));
const metadata = {reviewer: 'test-visitor', timestamp: '2026-09-23T00:00:00.000Z'};

function reviewed(task, decision, candidateId) {
  return makeTrainingExample(task, makeReview(task, decision, {...metadata, ...(candidateId ? {candidateId} : {})}));
}

test('binary labels distinguish connecting from rejecting an edge, without asserting termination', () => {
  const task = byType['fragment-connection'], candidate = task.candidates[0];
  const accepted = reviewed(task, 'accept'), rejected = reviewed(task, 'reject');
  assert.deepEqual(accepted.actions.map(action => action.id), [`connect:${candidate.id}`, `reject-edge:${candidate.id}`]);
  assert.deepEqual(accepted.target, {
    classIndex: 0, actionId: `connect:${candidate.id}`, kind: 'connect',
    candidateId: candidate.id, position: candidate.position,
  });
  assert.deepEqual(rejected.target, {
    classIndex: 1, actionId: `reject-edge:${candidate.id}`, kind: 'reject-edge', candidateId: candidate.id,
  });
  assert.equal(accepted.status, 'requires-validation');
  assert.equal(rejected.status, 'requires-validation');
  assert.ok(!accepted.actions.some(action => action.kind === 'stop'));
});

test('each real endpoint candidate maps to its deterministic candidate-conditioned connect class', () => {
  const task = byType['endpoint-selection'];
  task.candidates.forEach((candidate, classIndex) => {
    const example = reviewed(task, 'select', candidate.id);
    assert.deepEqual(example.actions.map(action => action.id), task.candidates.map(item => `connect:${item.id}`));
    assert.deepEqual(example.target, {
      classIndex, actionId: `connect:${candidate.id}`, kind: 'connect', candidateId: candidate.id, position: candidate.position,
    });
    assert.ok(!example.actions.some(action => action.kind === 'stop' || action.kind === 'reject-edge'));
  });
});

test('point choices extend to proposed positions; None supplies a distinct positive stop class', () => {
  const task = byType['point-proposal'];
  task.candidates.forEach((candidate, classIndex) => {
    const example = reviewed(task, 'select', candidate.id);
    assert.deepEqual(example.target, {
      classIndex, actionId: `extend:${candidate.id}`, kind: 'extend', candidateId: candidate.id, position: candidate.position,
    });
    assert.deepEqual(example.input.graph.nodes, task.nodes.map(({id, position}) => ({id, position})));
  });
  const stopped = reviewed(task, 'none');
  assert.deepEqual(stopped.target, {classIndex: task.candidates.length, actionId: 'stop', kind: 'stop'});
  assert.deepEqual(stopped.actions.at(-1), {id: 'stop', kind: 'stop', label: 'Stop · true ending'});
  assert.deepEqual(stopped.input.graph.edges, task.edges);
  assert.equal(stopped.status, 'requires-validation');
  assert.equal(stopped.review.validation, 'unverified-demo-review');
});

test('pending and uncertain examples have no supervised target or uncertain action class', () => {
  for (const task of tasks) {
    const pending = makeTrainingExample(task), deferred = reviewed(task, 'uncertain');
    assert.equal(pending.status, 'pending');
    assert.equal(pending.target, null);
    assert.equal(pending.review, null);
    assert.equal(deferred.status, 'deferred');
    assert.equal(deferred.target, null);
    assert.ok(deferred.actions.every(action => action.kind !== 'uncertain'));
    assert.deepEqual(deferred.input, pending.input);
    assert.equal(deferred.review.reviewer, metadata.reviewer);
    assert.equal(deferred.review.timestamp, metadata.timestamp);
  }
});

test('training inputs cannot leak review answers, saved status, or post-review graph changes', () => {
  for (const sourceTask of tasks) {
    const task = structuredClone(sourceTask);
    // Real manifests already contain these audit fields. Make the sentinel
    // values unmistakable, and verify none enter the model-input whitelist.
    task.referenceDecision = 'LEAK';
    task.referenceCandidateId = 'LEAK';
    task.reviewerPath = ['LEAK'];
    task.replayState.savedSourceChecked = 'LEAK';
    task.candidates.forEach(candidate => { candidate.originalEdgePresent = 'LEAK'; });
    const before = structuredClone(task), pending = makeTrainingExample(task);
    const decisions = task.taskType === 'fragment-connection' ? ['accept', 'reject', 'uncertain']
      : task.taskType === 'point-proposal' ? ['select', 'none', 'uncertain'] : ['select', 'uncertain'];
    for (const decision of decisions) {
      const example = reviewed(task, decision, decision === 'select' ? task.candidates[0].id : undefined);
      assert.deepEqual(example.input, pending.input);
      assert.equal(JSON.stringify(example.input).includes('LEAK'), false);
      assert.equal(example.input.graph.nodes.length, task.nodes.length);
    }
    assert.deepEqual(task, before);
    pending.input.history[0][0] = -999;
    pending.input.candidates[0].position[0] = -999;
    pending.input.graph.nodes[0].position[0] = -999;
    pending.input.graph.edges[0][0] = -999;
    pending.input.volume.originXYZ[0] = -999;
    pending.input.volume.voxelSizeUM[0] = -999;
    assert.deepEqual(task, before);
  }
});

test('stale or mismatched records fail, while labels are derived from the validated decision', () => {
  const task = byType['point-proposal'];
  const record = makeReview(task, 'select', {...metadata, candidateId: task.candidates[1].id});
  const before = structuredClone(record);
  assert.throws(() => makeTrainingExample({...task, dataRevision: 'different'}, record), /different dataRevision/);
  assert.throws(() => makeTrainingExample({...task, revision: 'different'}, record), /different revision/);
  const changed = structuredClone(task);
  changed.candidates[1].position[0] += 1;
  assert.throws(() => makeTrainingExample(changed, record), /different candidate/);
  assert.throws(() => makeTrainingExample(task, {...record, taskId: 'other'}), /different task/);
  const tampered = {...record, trainingTarget: {type: 'endpoint-status', value: 'true-ending'}, trainingLabel: 1};
  const example = makeTrainingExample(task, tampered);
  assert.equal(example.target.kind, 'extend');
  assert.equal(example.target.candidateId, task.candidates[1].id);
  assert.equal(example.status, 'requires-validation');
  assert.deepEqual(record, before);
  assert.deepEqual(makeTrainingExample(task, record), makeTrainingExample(task, record));
});
