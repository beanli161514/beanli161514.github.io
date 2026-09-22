import {graphEdgesAfterReview} from './neurofly-review.js';

const clone = value => JSON.parse(JSON.stringify(value));
const TYPES = new Set(['fragment-connection', 'endpoint-selection', 'point-proposal']);

function actionsFor(task) {
  if (!TYPES.has(task.taskType)) throw new TypeError(`Unknown task type: ${task.taskType}`);
  const candidates = task.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('Training inputs require candidates');
  if (task.taskType === 'fragment-connection') {
    if (candidates.length !== 1) throw new TypeError('A binary connection task must have one candidate');
    const candidate = candidates[0];
    return [
      {id: `connect:${candidate.id}`, kind: 'connect', candidateId: candidate.id, label: `Connect A → ${candidate.label}`},
      {id: `reject-edge:${candidate.id}`, kind: 'reject-edge', candidateId: candidate.id, label: `Reject A → ${candidate.label}`},
    ];
  }
  const kind = task.taskType === 'endpoint-selection' ? 'connect' : 'extend';
  const actions = candidates.map(candidate => ({
    id: `${kind}:${candidate.id}`, kind, candidateId: candidate.id,
    label: `${kind === 'connect' ? 'Connect' : 'Extend'} A → ${candidate.label}`,
  }));
  if (task.taskType === 'point-proposal') actions.push({id: 'stop', kind: 'stop', label: 'Stop · true ending'});
  return actions;
}

/** Preview a candidate training example; browser reviews still need validation.
 * Inputs are always the original task context, including its initial graph.
 * Audit/reference fields and the reviewed graph are never model inputs.
 */
export function makeTrainingExample(task, record = null) {
  const actions = actionsFor(task);
  // Reuse revision, task, candidate and decision validation. Do not use the
  // resulting edited graph or trust a stored record.trainingTarget as a label.
  if (record) graphEdgesAfterReview(task, record);
  const source = task.nodes.find(node => node.id === task.sourceId);
  if (!source) throw new TypeError('The source must reference an existing node');
  const input = {
    volume: {
      path: task.volume,
      shapeXYZ: [...task.shape],
      originXYZ: [...task.origin],
      voxelSizeUM: [...task.sourceVolume.voxelSizeUM],
      coordinates: 'crop-local XYZ voxels',
    },
    sourceId: task.sourceId,
    sourcePosition: [...source.position],
    history: clone(task.history ?? []),
    candidates: task.candidates.map(({id, label, kind, position}) => ({id, label, kind, position: [...position]})),
    graph: {
      nodes: task.nodes.map(({id, position}) => ({id, position: [...position]})),
      edges: task.edges.map(edge => [...edge]),
    },
  };
  let target = null;
  if (record && record.decision !== 'uncertain') {
    const kind = record.decision === 'none' ? 'stop'
      : record.decision === 'reject' ? 'reject-edge'
      : task.taskType === 'point-proposal' ? 'extend' : 'connect';
    const actionId = kind === 'stop' ? 'stop' : `${kind}:${record.selectedCandidateId}`;
    const classIndex = actions.findIndex(action => action.id === actionId);
    if (classIndex < 0) throw new TypeError('The reviewed action is outside this task action space');
    const action = actions[classIndex];
    target = {classIndex, actionId, kind};
    if (action.candidateId !== undefined) target.candidateId = action.candidateId;
    if (kind === 'connect' || kind === 'extend') {
      target.position = [...task.candidates.find(candidate => candidate.id === action.candidateId).position];
    }
  }
  return {
    taskId: task.id, taskType: task.taskType,
    revision: task.revision ?? task.manifestRevision ?? null,
    dataRevision: task.dataRevision ?? null,
    input, actions, target,
    status: !record ? 'pending' : record.decision === 'uncertain' ? 'deferred' : 'requires-validation',
    review: record ? {
      reviewer: record.reviewer, timestamp: record.timestamp,
      provenance: record.provenance, validation: record.validation,
    } : null,
  };
}
