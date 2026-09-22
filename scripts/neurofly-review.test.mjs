import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeReview, summarizeReviews, createExport, graphEdgesAfterReview} from '../src/neurofly-review.js';

const task = {
  id: 'gap-01',
  title: 'Does this edge exist?',
  volume: 'gap-01.u8.gz',
  shape: [96, 80, 64],
  origin: [1024, 2048, 128],
  sourceVolume: {filename: 'microscopy.tif', shapeXYZ: [12000, 9000, 2000]},
  nodes: [{id: 'a', position: [10, 20, 30]}, {id: 'b', position: [20, 30, 40]}, {id: 'c', position: [5, 10, 15]}],
  edges: [['a', 'c']],
  sourceId: 'a', targetId: 'b',
  referenceDecision: 'accept',
};
const metadata = {reviewer: 'test-visitor', timestamp: '2026-09-22T12:00:00.000Z'};

test('reviews retain coordinates and provenance without inheriting the reference answer', () => {
  const review = makeReview(task, 'reject', metadata);
  assert.equal(review.taskId, task.id);
  assert.equal(review.trainingLabel, 0);
  assert.equal(review.status, 'reviewed');
  assert.equal(review.reviewer, metadata.reviewer);
  assert.equal(review.timestamp, metadata.timestamp);
  assert.equal(review.provenance, 'interactive-demo');
  assert.equal(review.validation, 'unverified-demo-review');
  assert.deepEqual(review.proposedEdge, {sourceId: 'a', targetId: 'b'});
  assert.deepEqual(review.sourcePosition, [10, 20, 30]);
  assert.deepEqual(review.targetPosition, [20, 30, 40]);
  assert.deepEqual(review.source, {volume: task.sourceVolume, origin: task.origin, shape: task.shape});
  assert.equal('referenceDecision' in review, false);
  assert.deepEqual(JSON.parse(JSON.stringify(review)), review);
  review.sourcePosition[0] = -1;
  review.source.volume.shapeXYZ[0] = -1;
  review.source.origin[0] = -1;
  assert.equal(task.nodes[0].position[0], 10);
  assert.equal(task.sourceVolume.shapeXYZ[0], 12000);
  assert.equal(task.origin[0], 1024);
});

test('uncertainty is deferred and excluded from candidate supervision, while its audit record remains', () => {
  const records = ['accept', 'reject', 'uncertain'].map(decision => makeReview(task, decision, metadata));
  assert.equal(records[2].trainingLabel, null);
  assert.equal(records[2].status, 'deferred');
  assert.deepEqual(summarizeReviews(records), {total: 3, accept: 1, reject: 1, uncertain: 1});
  const exported = createExport(records);
  assert.equal(exported.version, 1);
  assert.match(exported.purpose, /unverified/);
  assert.equal(exported.reviews.length, 3);
  assert.deepEqual(exported.supervisedCandidates.map(record => record.trainingLabel), [1, 0]);
  assert.ok(exported.supervisedCandidates.every(record => record.validation === 'unverified-demo-review'));
  exported.reviews[0].sourcePosition[0] = 999;
  assert.equal(records[0].sourcePosition[0], 10);
  assert.equal(exported.supervisedCandidates[0].sourcePosition[0], 10);
  assert.deepEqual(createExport([]).supervisedCandidates, []);
});

test('graph review edits are idempotent, undirected, and leave the original graph unchanged', () => {
  const before = structuredClone(task);
  const accepted = makeReview(task, 'accept', metadata);
  const rejected = makeReview(task, 'reject', metadata);
  const uncertain = makeReview(task, 'uncertain', metadata);
  const added = graphEdgesAfterReview(task, accepted);
  assert.deepEqual(added, [['a', 'c'], ['a', 'b']]);
  assert.deepEqual(graphEdgesAfterReview({...task, edges: added}, accepted), added);
  const reversed = {...task, edges: [['a', 'c'], ['b', 'a']]};
  assert.deepEqual(graphEdgesAfterReview(reversed, accepted), reversed.edges);
  assert.deepEqual(graphEdgesAfterReview(reversed, rejected), task.edges);
  assert.deepEqual(graphEdgesAfterReview(task, rejected), task.edges);
  assert.deepEqual(graphEdgesAfterReview(reversed, uncertain), reversed.edges);
  assert.deepEqual(graphEdgesAfterReview(task, null), task.edges);
  added[0][0] = 'changed';
  assert.deepEqual(task, before);
});

test('invalid decisions, missing endpoints, invalid coordinates, and mismatched tasks fail explicitly', () => {
  assert.throws(() => makeReview(task, 'maybe', metadata), /Unknown review decision/);
  assert.throws(() => summarizeReviews([{decision: 'maybe'}]), /Unknown review decision/);
  assert.throws(() => makeReview({...task, targetId: 'absent'}, 'accept', metadata), /existing nodes/);
  assert.throws(() => makeReview({...task, targetId: 'a'}, 'accept', metadata), /different nodes/);
  assert.throws(() => makeReview({...task, nodes: [{id: 'a', position: [NaN, 0, 0]}, task.nodes[1]]}, 'accept', metadata), /finite coordinates/);
  assert.throws(() => graphEdgesAfterReview(task, {...makeReview(task, 'accept', metadata), taskId: 'other-task'}), /different task/);
});
