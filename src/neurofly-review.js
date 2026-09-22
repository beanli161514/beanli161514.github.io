const DECISIONS = new Set(['accept', 'reject', 'uncertain']);
const clone = value => JSON.parse(JSON.stringify(value));

function checkDecision(decision) {
  if (!DECISIONS.has(decision)) throw new TypeError(`Unknown review decision: ${decision}`);
}

function position(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${name} must contain three finite coordinates`);
  }
  return [...value];
}

function endpoints(task) {
  const source = task.nodes.find(node => node.id === task.sourceId);
  const target = task.nodes.find(node => node.id === task.targetId);
  if (!source || !target) throw new TypeError('The proposed edge must reference two existing nodes');
  if (source.id === target.id) throw new TypeError('The proposed edge must connect different nodes');
  return {source, target};
}

/** A visitor decision is an auditable review, never an expert-validated label. */
export function makeReview(task, decision, {reviewer = 'demo-visitor', timestamp = new Date().toISOString()} = {}) {
  checkDecision(decision);
  const {source, target} = endpoints(task);
  return {
    taskId: task.id,
    decision,
    reviewer,
    timestamp,
    status: decision === 'uncertain' ? 'deferred' : 'reviewed',
    proposedEdge: {sourceId: source.id, targetId: target.id},
    sourcePosition: position(source.position, 'Source position'),
    targetPosition: position(target.position, 'Target position'),
    source: {
      volume: clone(task.sourceVolume),
      origin: position(task.origin, 'Crop origin'),
      shape: position(task.shape, 'Crop shape'),
    },
    trainingLabel: decision === 'accept' ? 1 : decision === 'reject' ? 0 : null,
    provenance: 'interactive-demo',
    validation: 'unverified-demo-review',
  };
}

export function summarizeReviews(records) {
  const summary = {total: 0, accept: 0, reject: 0, uncertain: 0};
  for (const record of records) {
    checkDecision(record.decision);
    summary.total++;
    summary[record.decision]++;
  }
  return summary;
}

/** Candidate supervision still requires validation; uncertainty is kept only in the review log. */
export function createExport(records) {
  summarizeReviews(records);
  return {
    version: 1,
    purpose: 'Interactive demonstration of structured graph review. Candidate labels are unverified, not validated training ground truth.',
    reviews: clone(records),
    supervisedCandidates: clone(records.filter(record => record.decision !== 'uncertain')),
  };
}

/** Apply a local, reversible graph edit without mutating the source task. */
export function graphEdgesAfterReview(task, record) {
  const edges = task.edges.map(edge => [...edge]);
  if (!record) return edges;
  checkDecision(record.decision);
  const {source, target} = endpoints(task);
  if (record.taskId !== task.id) throw new TypeError('The review belongs to a different task');
  const isProposedEdge = ([a, b]) =>
    (a === source.id && b === target.id) || (a === target.id && b === source.id);
  if (record.decision === 'reject') return edges.filter(edge => !isProposedEdge(edge));
  if (record.decision === 'accept' && !edges.some(isProposedEdge)) edges.push([source.id, target.id]);
  return edges;
}
