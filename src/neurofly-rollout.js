const RANGES = [[0, 4], [11, 16], [24, 28], [37, 42], [49, 52]];
const indices = (start, end) => Array.from({length: end - start + 1}, (_, i) => start + i);
const edgeKey = (a, b) => JSON.stringify([a, b].sort((x, y) => x - y));

/** A deterministic action walkthrough of saved annotation geometry.
 * The five initial fragments are illustrative subdivisions of this path.
 * Every added point and bridge comes from the original ordered annotation;
 * reaching the displayed crop's end never produces a true-ending label.
 */
export function createFiberRollout(spec) {
  const path = spec.pathXYZ;
  if (!Array.isArray(path) || path.length !== 55 || path.some(point =>
    !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))) {
    throw new TypeError('This walkthrough requires the 55-point annotated XYZ path');
  }
  if (!Array.isArray(spec.nodeIds) || spec.nodeIds.length !== path.length || new Set(spec.nodeIds).size !== path.length || !Array.isArray(spec.edges)) {
    throw new TypeError('The annotated path must retain its source IDs and edges');
  }
  const sourceEdges = new Set(spec.edges.map(([a, b]) => edgeKey(a, b)));
  for (let i = 1; i < path.length; i++) {
    if (!sourceEdges.has(edgeKey(spec.nodeIds[i - 1], spec.nodeIds[i]))) {
      throw new TypeError(`Missing original annotation edge at path index ${i}`);
    }
  }

  const fragments = RANGES.map(([start, end], i) => ({
    id: `fragment-${i + 1}`, range: [start, end], nodeIndices: indices(start, end),
  }));
  const visibleNodes = new Set(fragments.flatMap(fragment => fragment.nodeIndices));
  const edges = fragments.flatMap(({range: [start, end]}) => indices(start, end - 1).map(i => [i, i + 1]));
  let connectedThrough = RANGES[0][1], fragmentCount = fragments.length;

  const snapshot = (activeEdge, candidates, taskType, option, label, detail) => ({
    connectedThrough,
    visibleNodeIndices: [...visibleNodes].sort((a, b) => a - b),
    visibleEdges: edges.map(edge => [...edge]).sort(([a], [b]) => a - b),
    tipIndex: connectedThrough,
    activeEdge: activeEdge ? [...activeEdge] : null,
    candidates: candidates.map(candidate => ({...candidate})),
    taskType, option, label, detail, fragmentCount,
  });
  const initial = snapshot(null, [], null, null, 'Five fragments', 'Extend across gaps and connect nearby fragments.');
  const steps = [];

  function append(source, target, through, candidates, taskType, option, label, detail) {
    for (const candidate of candidates) {
      if (path[candidate.index].some((n, axis) => n - path[source][axis] < -16 || n - path[source][axis] >= 16)) {
        throw new TypeError('A walkthrough candidate falls outside the source-centered 32³ window');
      }
    }
    visibleNodes.add(target);
    edges.push([source, target]);
    connectedThrough = through;
    steps.push(snapshot([source, target], candidates, taskType, option, label, detail));
  }

  function extendThrough(last) {
    while (connectedThrough < last) {
      const source = connectedThrough, target = source + 1;
      append(source, target, target, [{label: 'B', index: target}], 'point-proposal', 'B',
        'Extend to B', target === path.length - 1 ? 'Fiber connected across the displayed volume.' : 'Select a continuation point along the fiber.');
    }
  }

  for (let join = 1; join < RANGES.length; join++) {
    const [start, end] = RANGES[join];
    extendThrough(start - 1);
    const selection = join % 2 === 0;
    const candidates = [{label: 'B', index: start}];
    if (selection) candidates.push({label: 'C', index: end});
    fragmentCount--;
    append(connectedThrough, start, end, candidates,
      selection ? 'endpoint-selection' : 'fragment-connection', selection ? 'B' : 'Accept',
      selection ? 'Select endpoint B' : 'Connect fragments',
      selection ? 'Connect to B and follow the existing fragment.' : 'Accept the connection and follow the existing fragment.');
  }
  extendThrough(path.length - 1);
  return {fragments, initial, steps};
}
