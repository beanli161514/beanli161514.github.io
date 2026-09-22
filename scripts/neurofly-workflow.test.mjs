import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeReview,graphEdgesAfterReview,graphNodesAfterReview,createExport} from '../src/neurofly-review.js';

const manifest=JSON.parse(readFileSync(new URL('../public/neurofly/data/manifest.json',import.meta.url)));

test('packaged task data supports all three review workflows and survives serialized restore',()=>{
  assert.deepEqual(manifest.tasks.map(t=>t.taskType),['fragment-connection','endpoint-selection','point-proposal']);
  for(const source of manifest.tasks){
    const task={...source,revision:manifest.revision,dataRevision:manifest.dataRevision};
    const before=JSON.stringify(task);
    const choices=task.taskType==='fragment-connection'
      ?[['accept'],['reject'],['uncertain']]
      :[...task.candidates.map(c=>['select',c.id]),['uncertain'],...(task.taskType==='point-proposal'?[['none']]:[])];
    for(const [decision,candidateId] of choices){
      const review=makeReview(task,decision,{candidateId});
      const saved=JSON.parse(JSON.stringify(review));
      const edges=graphEdgesAfterReview(task,saved),nodes=graphNodesAfterReview(task,saved);
      assert.equal(edges.length,task.edges.length+(['accept','select'].includes(decision)?1:0));
      assert.equal(nodes.length,task.nodes.length+(decision==='select'&&task.taskType==='point-proposal'?1:0));
      assert.equal(nodes.find(n=>n.id===task.sourceId).endpointStatus,decision==='none'?'true-ending':undefined);
      const restored=makeReview(task,saved.decision,{candidateId:saved.selectedCandidateId,reviewer:saved.reviewer,timestamp:saved.timestamp});
      assert.deepEqual(restored,saved);
      assert.equal(createExport([saved]).supervisedCandidates.length,decision==='uncertain'?0:1);
    }
    if(task.taskType!=='point-proposal')assert.throws(()=>makeReview(task,'none'),/not valid/);
    assert.equal(JSON.stringify(task),before);
  }
});
