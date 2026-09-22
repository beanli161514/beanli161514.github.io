import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeReview, summarizeReviews, createExport, graphEdgesAfterReview, graphNodesAfterReview} from '../src/neurofly-review.js';

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
  assert.deepEqual(summarizeReviews(records), {total: 3, accept: 1, reject: 1, uncertain: 1, none: 0});
  const exported = createExport(records);
  assert.equal(exported.version, 3);
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

test('replay reviews retain independent copies of revisions, original flags, and the initial fragment graph', () => {
  const replayTask = {
    ...structuredClone(task),
    revision: 'example-2', manifestRevision: 'workflow-2', dataRevision: 2,
    sourceDegree: 1, sourceFragmentId: 2593, targetFragmentId: 2752,
    replayState: {
      sourceChecked: 0, sourceState: 'unchecked', basis: 'simulated-pre-review',
      savedSourceChecked: 1, initialGraph: 'original-segmentation-fragments',
    },
    initialGraph: {kind: 'original-segmentation-fragments', edgeCreators: ['seger']},
  };
  const before = structuredClone(replayTask);
  const record = makeReview(replayTask, 'accept', metadata);
  assert.equal(record.revision, replayTask.revision);
  assert.equal(record.manifestRevision, replayTask.manifestRevision);
  assert.equal(record.dataRevision, 2);
  assert.deepEqual(record.replayState, replayTask.replayState);
  assert.deepEqual(record.graphContext, {
    nodes: replayTask.nodes, edges: replayTask.edges, initialGraph: replayTask.initialGraph,
    sourceDegree: 1, sourceFragmentId: 2593, targetFragmentId: 2752,
  });
  const exported = createExport([record]);
  assert.match(exported.purpose, /source dataset is unchanged/);
  assert.equal(exported.supervisedCandidates[0].validation, 'unverified-demo-review');
  exported.reviews[0].replayState.savedSourceChecked = 0;
  exported.reviews[0].graphContext.nodes[0].position[0] = 999;
  assert.equal(record.replayState.savedSourceChecked, 1);
  assert.equal(record.graphContext.nodes[0].position[0], 10);
  record.replayState.sourceChecked = 1;
  record.graphContext.nodes[0].position[0] = 999;
  record.graphContext.edges[0][0] = 'changed';
  record.graphContext.initialGraph.edgeCreators[0] = 'changed';
  assert.deepEqual(replayTask, before);
  delete replayTask.initialGraph;
  assert.equal(makeReview(replayTask, 'uncertain', metadata).graphContext.initialGraph, 'original-segmentation-fragments');
});

test('old reviews cannot silently apply to a new candidate or data revision under the same task ID', () => {
  const oldReview = makeReview(task, 'accept', metadata);
  assert.throws(() => graphEdgesAfterReview({...task, targetId: 'c'}, oldReview), /different candidate connection/);
  assert.throws(() => graphEdgesAfterReview({...task, dataRevision: 2}, oldReview), /different dataRevision/);
  const currentTask = {...task, dataRevision: 2};
  const currentReview = makeReview(currentTask, 'accept', metadata);
  assert.equal(graphEdgesAfterReview(currentTask, currentReview).length, task.edges.length + 1);
  assert.throws(() => graphEdgesAfterReview({...currentTask, dataRevision: 3}, currentReview), /different dataRevision/);
  assert.deepEqual(graphEdgesAfterReview(currentTask, makeReview(currentTask, 'uncertain', metadata)), currentTask.edges);
});

const selectionTask = {
  ...structuredClone(task), id: 'choose-endpoint', taskType: 'endpoint-selection', dataRevision: 3,
  nodes: [...structuredClone(task.nodes), {id: 'd', position: [25, 35, 40]}],
  candidates: [
    {id: 'b', label: 'B', nodeId: 'b', position: [20, 30, 40], kind: 'fragment-endpoint', metrics: {distance: 17.3}},
    {id: 'd', label: 'D', nodeId: 'd', position: [25, 35, 40], kind: 'fragment-endpoint', metrics: {distance: 23.4}},
  ],
};
const pointTask = {
  ...structuredClone(task), id: 'propose-point', taskType: 'point-proposal', dataRevision: 3,
  nodes: structuredClone(task.nodes.filter(node => node.id !== 'b')),
  generation: {method: 'direction-and-local-maxima', settings: {radius: 8}},
  candidateGeneration: {nearbyFragmentEndpoints: [], method: 'direction-and-local-maxima'},
  replayState: {basis: 'simulated-pre-review', savedSourceChecked: 1, sourceChecked: 0},
  candidates: [
    {id: 'p1', label: 'B', nodeId: null, position: [12, 23, 34], kind: 'image-point', metrics: {intensity: 120}},
    {id: 'p2', label: 'C', nodeId: null, position: [13, 24, 35], kind: 'image-point', metrics: {intensity: 140}},
  ],
};

test('binary fragment reviews retain connection labels and their sole candidate', () => {
  const binary = {...selectionTask, taskType: 'fragment-connection', candidates: [selectionTask.candidates[0]]};
  const accepted = makeReview(binary, 'accept', metadata), rejected = makeReview(binary, 'reject', metadata);
  assert.deepEqual(accepted.trainingTarget, {type: 'connection', label: 1});
  assert.deepEqual(rejected.trainingTarget, {type: 'connection', label: 0});
  assert.equal(accepted.selectedCandidateId, 'b');
  assert.equal(rejected.selectedCandidateId, 'b');
  assert.equal(accepted.trainingLabel, 1);
  assert.equal(rejected.trainingLabel, 0);
  assert.deepEqual(graphNodesAfterReview(binary, accepted), binary.nodes);
  assert.deepEqual(graphEdgesAfterReview(binary, rejected), binary.edges);
});

test('endpoint selection connects only the chosen fragment and retains the full candidate set', () => {
  const before = structuredClone(selectionTask);
  const record = makeReview(selectionTask, 'select', {...metadata, candidateId: 'd'});
  assert.deepEqual(record.trainingTarget, {type: 'candidate-selection', candidateId: 'd'});
  assert.equal('trainingLabel' in record, false);
  assert.equal(record.selectedCandidateId, 'd');
  assert.deepEqual(record.proposedEdge, {sourceId: 'a', targetId: 'd'});
  assert.deepEqual(graphEdgesAfterReview(selectionTask, record), [['a', 'c'], ['a', 'd']]);
  assert.deepEqual(graphNodesAfterReview(selectionTask, record), selectionTask.nodes);
  assert.deepEqual(record.candidates, selectionTask.candidates);
  record.candidates[0].metrics.distance = -1;
  record.graphContext.nodes[0].position[0] = -1;
  assert.deepEqual(selectionTask, before);
});

test('selecting an image proposal materializes one deterministic node and edge, without mutating the source graph', () => {
  const before = structuredClone(pointTask);
  const record = makeReview(pointTask, 'select', {...metadata, candidateId: 'p2'});
  assert.deepEqual(record.proposedEdge, {sourceId: 'a', targetId: 'proposal:propose-point:p2'});
  assert.deepEqual(graphNodesAfterReview(pointTask, null), pointTask.nodes);
  const nodes = graphNodesAfterReview(pointTask, record), edges = graphEdgesAfterReview(pointTask, record);
  assert.equal(nodes.length, pointTask.nodes.length + 1);
  assert.deepEqual(nodes.at(-1).position, [13, 24, 35]);
  assert.equal(nodes.at(-1).id, 'proposal:propose-point:p2');
  assert.equal(nodes.at(-1).validation, 'unverified-demo-review');
  assert.deepEqual(edges, [['a', 'c'], ['a', 'proposal:propose-point:p2']]);
  assert.deepEqual(graphNodesAfterReview({...pointTask, nodes}, record), nodes);
  assert.deepEqual(graphEdgesAfterReview({...pointTask, edges}, record), edges);
  assert.deepEqual(pointTask, before);
});

test('None is a positive true-ending annotation, distinct from rejection and uncertainty', () => {
  const record = makeReview(pointTask, 'none', metadata);
  assert.equal(record.endpointStatus, 'true-ending');
  assert.equal(record.status, 'reviewed');
  assert.equal(record.trainingLabel, 1);
  assert.deepEqual(record.trainingTarget, {type: 'endpoint-status', value: 'true-ending', label: 1});
  assert.equal(record.selectedCandidateId, null);
  assert.equal(record.proposedEdge, null);
  assert.equal(record.targetPosition, null);
  assert.deepEqual(graphEdgesAfterReview(pointTask, record), pointTask.edges);
  const nodes = graphNodesAfterReview(pointTask, record);
  assert.equal(nodes.length, pointTask.nodes.length);
  assert.equal(nodes.find(node => node.id === pointTask.sourceId).endpointStatus, 'true-ending');
  assert.equal(pointTask.nodes.find(node => node.id === pointTask.sourceId).endpointStatus, undefined);
  assert.equal(createExport([record]).supervisedCandidates[0].endpointStatus, 'true-ending');
});

test('typed uncertain reviews have no training target and preserve the initial graph and generation provenance', () => {
  const uncertain = makeReview(pointTask, 'uncertain', metadata);
  assert.equal(uncertain.trainingTarget, null);
  assert.equal(uncertain.trainingLabel, null);
  assert.equal(uncertain.selectedCandidateId, null);
  assert.equal(uncertain.proposedEdge, null);
  assert.equal(uncertain.status, 'deferred');
  assert.deepEqual(graphNodesAfterReview(pointTask, uncertain), pointTask.nodes);
  assert.deepEqual(graphEdgesAfterReview(pointTask, uncertain), pointTask.edges);
  assert.deepEqual(uncertain.generation, pointTask.generation);
  assert.deepEqual(uncertain.candidateGeneration, pointTask.candidateGeneration);
  uncertain.generation.settings.radius = -1;
  uncertain.candidateGeneration.nearbyFragmentEndpoints.push('invented');
  assert.equal(pointTask.generation.settings.radius, 8);
  assert.deepEqual(pointTask.candidateGeneration.nearbyFragmentEndpoints, []);
  const records = [uncertain, makeReview(pointTask, 'none', metadata), makeReview(selectionTask, 'select', {...metadata, candidateId: 'b'})];
  assert.deepEqual(summarizeReviews(records), {total: 3, accept: 1, reject: 0, uncertain: 1, none: 1});
  const exported = createExport(records);
  assert.equal(exported.version, 3);
  assert.equal(exported.reviews.length, 3);
  assert.equal(exported.supervisedCandidates.length, 2);
  assert.ok(exported.supervisedCandidates.every(row => row.trainingTarget && row.validation === 'unverified-demo-review'));
});

test('task-specific actions, missing selections, and changed candidates are rejected', () => {
  assert.throws(() => makeReview(selectionTask, 'select', metadata), /valid candidateId/);
  assert.throws(() => makeReview(selectionTask, 'select', {...metadata, candidateId: 'absent'}), /valid candidateId/);
  assert.throws(() => makeReview(selectionTask, 'none', metadata), /not valid/);
  assert.throws(() => makeReview(selectionTask, 'reject', metadata), /not valid/);
  assert.throws(() => makeReview(pointTask, 'reject', metadata), /not valid/);
  assert.throws(() => makeReview(pointTask, 'none', {...metadata, candidateId: 'p1'}), /do not select/);
  const selection = makeReview(selectionTask, 'select', {...metadata, candidateId: 'b'});
  const changed = structuredClone(selectionTask);
  changed.candidates[0].metrics.distance = 99;
  assert.throws(() => graphEdgesAfterReview(changed, selection), /different candidate connection set/);
  const malformed = structuredClone(pointTask);
  malformed.candidates[0].nodeId = 'a';
  assert.throws(() => makeReview(malformed, 'select', {...metadata, candidateId: 'p1'}), /outside the initial graph/);
  assert.throws(() => graphNodesAfterReview({...pointTask, dataRevision: 4}, makeReview(pointTask, 'none', metadata)), /different dataRevision/);
});
