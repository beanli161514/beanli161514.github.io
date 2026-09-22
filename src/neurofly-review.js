const DECISIONS = new Set(['accept', 'reject', 'select', 'none', 'uncertain']);
const ALLOWED = {
  'fragment-connection': ['accept', 'reject', 'uncertain'],
  'endpoint-selection': ['select', 'uncertain'],
  'point-proposal': ['select', 'none', 'uncertain'],
};
const REVISION_FIELDS = ['revision', 'manifestRevision', 'dataRevision'];
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const proposalNodeId = (task, candidate) => `proposal:${task.id}:${candidate.id}`;

function position(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${name} must contain three finite coordinates`);
  }
  return [...value];
}

function taskContext(task) {
  const taskType = task.taskType ?? 'fragment-connection';
  if (!ALLOWED[taskType]) throw new TypeError(`Unknown task type: ${taskType}`);
  const source = task.nodes.find(node => node.id === task.sourceId);
  if (!source) throw new TypeError('The source must reference an existing node');
  position(source.position, 'Source position');
  if (task.sourcePosition && !same(task.sourcePosition, source.position)) throw new TypeError('Source coordinates do not match the graph');
  let candidates = task.candidates;
  // Old binary tasks remain readable; new typed tasks must supply candidates.
  if (!task.taskType && candidates === undefined) {
    const target = task.nodes.find(node => node.id === task.targetId);
    if (!target) throw new TypeError('The proposed edge must reference two existing nodes');
    candidates = [{id: 'b', label: 'B', nodeId: target.id, position: target.position, kind: 'fragment-endpoint'}];
  }
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('A task must supply candidates');
  if (taskType === 'fragment-connection' && candidates.length !== 1) throw new TypeError('A binary connection task must have one candidate');
  if (taskType === 'endpoint-selection' && candidates.length < 2) throw new TypeError('Endpoint selection requires multiple candidates');
  const ids = new Set();
  for (const candidate of candidates) {
    if (typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) throw new TypeError('Candidate IDs must be unique nonempty strings');
    ids.add(candidate.id);
    position(candidate.position, 'Candidate position');
    if (taskType === 'point-proposal') {
      if (candidate.kind !== 'image-point' || candidate.nodeId != null) throw new TypeError('Point proposals must be image points outside the initial graph');
      const existing = task.nodes.find(node => node.id === proposalNodeId(task, candidate));
      if (existing && !same(existing.position, candidate.position)) throw new TypeError('A proposed node ID conflicts with the graph');
    } else {
      const target = task.nodes.find(node => node.id === candidate.nodeId);
      if (candidate.kind !== 'fragment-endpoint' || !target) throw new TypeError('Endpoint candidates must reference existing nodes');
      if (target.id === source.id) throw new TypeError('The proposed edge must connect different nodes');
      if (!same(target.position, candidate.position)) throw new TypeError('Candidate coordinates do not match the graph');
    }
  }
  return {taskType, source, candidates};
}

function choice(context, decision, candidateId) {
  if (!DECISIONS.has(decision)) throw new TypeError(`Unknown review decision: ${decision}`);
  if (!ALLOWED[context.taskType].includes(decision)) throw new TypeError(`Decision ${decision} is not valid for ${context.taskType}`);
  if (decision === 'select') {
    const candidate = context.candidates.find(item => item.id === candidateId);
    if (!candidate) throw new TypeError('Select requires a valid candidateId');
    return candidate;
  }
  if (decision === 'accept' || decision === 'reject') {
    const candidate = context.candidates[0];
    if (candidateId != null && candidateId !== candidate.id) throw new TypeError('The candidateId does not match the binary connection');
    return candidate;
  }
  if (candidateId != null) throw new TypeError('Uncertain and None do not select a candidate');
  return null;
}

function edgeFor(task, context, selected) {
  const candidate = selected ?? (context.taskType === 'fragment-connection' ? context.candidates[0] : null);
  return candidate ? {
    sourceId: context.source.id,
    targetId: candidate.nodeId ?? proposalNodeId(task, candidate),
  } : null;
}

/** A visitor decision is an auditable local review, never expert-validated truth. */
export function makeReview(task, decision, {candidateId, reviewer = 'demo-visitor', timestamp = new Date().toISOString()} = {}) {
  const context = taskContext(task), selected = choice(context, decision, candidateId);
  const {taskType, source, candidates} = context;
  const target = selected ?? (taskType === 'fragment-connection' ? candidates[0] : null);
  const trainingTarget = decision === 'uncertain' ? null
    : decision === 'none' ? {type: 'endpoint-status', value: 'true-ending', label: 1}
    : decision === 'select' ? {type: 'candidate-selection', candidateId: selected.id}
    : {type: 'connection', label: decision === 'accept' ? 1 : 0};
  const record = {
    taskId: task.id, taskType, decision, reviewer, timestamp,
    status: decision === 'uncertain' ? 'deferred' : 'reviewed',
    sourceId: source.id,
    candidates: clone(candidates),
    selectedCandidateId: selected?.id ?? null,
    proposedEdge: edgeFor(task, context, selected),
    sourcePosition: position(source.position, 'Source position'),
    targetPosition: target ? position(target.position, 'Target position') : null,
    source: {
      volume: clone(task.sourceVolume),
      origin: position(task.origin, 'Crop origin'),
      shape: position(task.shape, 'Crop shape'),
    },
    trainingTarget,
    provenance: 'interactive-demo',
    validation: 'unverified-demo-review',
  };
  if (decision !== 'select') record.trainingLabel = decision === 'uncertain' ? null : trainingTarget.label;
  if (decision === 'none') record.endpointStatus = 'true-ending';
  for (const field of [...REVISION_FIELDS, 'replayState', 'generation', 'candidateGeneration', 'taskDesign']) {
    if (task[field] !== undefined) record[field] = clone(task[field]);
  }
  if (task.taskType || task.replayState !== undefined || task.initialGraph !== undefined || task.sourceFragmentId !== undefined) {
    // Retain the displayed initial graph; never rewrite the saved dataset flags.
    record.graphContext = {nodes: clone(task.nodes), edges: clone(task.edges)};
    const initialGraph = task.initialGraph ?? task.replayState?.initialGraph;
    if (initialGraph !== undefined) record.graphContext.initialGraph = clone(initialGraph);
    for (const field of ['sourceDegree', 'sourceFragmentId', 'targetFragmentId']) {
      if (task[field] !== undefined) record.graphContext[field] = clone(task[field]);
    }
  }
  return record;
}

export function summarizeReviews(records) {
  const summary = {total: 0, accept: 0, reject: 0, uncertain: 0, none: 0};
  for (const record of records) {
    if (!DECISIONS.has(record.decision)) throw new TypeError(`Unknown review decision: ${record.decision}`);
    summary.total++;
    summary[record.decision === 'select' ? 'accept' : record.decision]++;
  }
  return summary;
}

/** Candidate supervision needs validation; uncertainty remains only in the review log. */
export function createExport(records) {
  summarizeReviews(records);
  return {
    version: 3,
    purpose: 'Interactive demonstration of structured graph review. Candidate labels are unverified, not validated training ground truth. Graph changes apply only to the local demo; the source dataset is unchanged.',
    reviews: clone(records),
    supervisedCandidates: clone(records.filter(record => record.decision !== 'uncertain')),
  };
}

function validateRecord(task, record) {
  const context = taskContext(task);
  if (record.taskId !== task.id) throw new TypeError('The review belongs to a different task');
  if (record.taskType !== context.taskType) throw new TypeError('The review belongs to a different task type');
  for (const field of REVISION_FIELDS) {
    if (!same(record[field], task[field])) throw new TypeError(`The review belongs to a different ${field}`);
  }
  if (!same(record.candidates, context.candidates)) throw new TypeError('The review belongs to a different candidate connection set');
  const selected = choice(context, record.decision, record.selectedCandidateId);
  if (!same(record.proposedEdge, edgeFor(task, context, selected)) || !same(record.sourcePosition, context.source.position)) {
    throw new TypeError('The review belongs to a different candidate connection');
  }
  return {context, selected};
}

/** Apply a reversible graph edit to copies of the initial graph. */
export function graphEdgesAfterReview(task, record) {
  const edges = task.edges.map(edge => [...edge]);
  if (!record) return edges;
  validateRecord(task, record);
  if (record.decision === 'uncertain' || record.decision === 'none') return edges;
  const {sourceId, targetId} = record.proposedEdge;
  const matches = ([a, b]) => (a === sourceId && b === targetId) || (a === targetId && b === sourceId);
  if (record.decision === 'reject') return edges.filter(edge => !matches(edge));
  if (!edges.some(matches)) edges.push([sourceId, targetId]);
  return edges;
}

export function graphNodesAfterReview(task, record) {
  const nodes = clone(task.nodes);
  if (!record) return nodes;
  const {context, selected} = validateRecord(task, record);
  if (record.decision === 'none') {
    nodes.find(node => node.id === context.source.id).endpointStatus = 'true-ending';
  } else if (record.decision === 'select' && selected.kind === 'image-point') {
    const id = proposalNodeId(task, selected);
    if (!nodes.some(node => node.id === id)) nodes.push({
      id, position: [...selected.position], kind: 'image-point', candidateId: selected.id,
      provenance: 'interactive-demo', validation: 'unverified-demo-review',
      ...(context.source.component !== undefined ? {component: context.source.component} : {}),
    });
  }
  return nodes;
}
