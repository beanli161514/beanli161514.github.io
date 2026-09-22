import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {transformXYZ,physicalBox} from '../src/neurofly-scale.js';

const root=new URL('../public/neurofly/data/',import.meta.url);
const read=name=>readFileSync(new URL(name,root));
const brain=JSON.parse(read('t154-brain.json'));
const metadata=JSON.parse(read('t154-neurons.json'));
const neurons=JSON.parse(gunzipSync(read(metadata.skeleton))).neurons;
const almost=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≈ ${b}`);

test('T154 overview is a compact real pyramid with calibrated isotropic voxels',()=>{
  const bytes=read(brain.volume),voxels=gunzipSync(bytes);
  assert.equal(bytes.length,brain.compressedBytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),brain.volumeSHA256);
  assert.equal(voxels.length,brain.shape.reduce((a,b)=>a*b,1));
  assert.equal(brain.kind,'whole-brain-fluorescence');
  assert.equal(brain.sourceFilename,'T154_1um.ims');
  assert.equal(brain.sourceLevel,6);
  assert.deepEqual(brain.spacingUM,[64,64,64]);
  assert.deepEqual(brain.nativePhysicalExtentMM,[12,8,13.2]);
  assert.ok(brain.sourceLowResolutionReadBytes<1e7);
  brain.shape.forEach((n,i)=>almost(n*brain.spacingMM[i],brain.physicalExtentMM[i]));
  for(const point of [[0,0,0],[8046,1843,4668],brain.sourceImageSizeXYZ.map(n=>n-1)]){
    const transformed=transformXYZ(point,brain.affineSourceVoxelToOverview);
    transformed.forEach((n,i)=>almost((n+.5)*brain.spacingUM[i],point[i]+.5));
  }
});

test('the yellow block has true physical size and is wholly inside T154 tissue',()=>{
  const {size,origin}=physicalBox(brain.illustrativeBlockCenterXYZ,[1,1,.3],brain.spacingMM);
  assert.deepEqual(size,[15.625,15.625,4.6875]);
  origin.forEach((n,i)=>{
    almost((n-.5+size[i]/2),brain.illustrativeBlockCenterXYZ[i]);
    assert.ok(n-.5>=-.5&&n+size[i]-.5<=brain.shape[i]-.5);
  });
  const [lo,hi]=brain.insideTissueCheck.expandedBoundsXYZ;
  origin.forEach((n,i)=>assert.ok(lo[i]<=n-.5&&hi[i]>=n+size[i]-.5));
  const voxels=gunzipSync(read(brain.volume));
  for(let z=lo[2];z<hi[2];z++)for(let y=lo[1];y<hi[1];y++)for(let x=lo[0];x<hi[0];x++){
    assert.ok(voxels[x+brain.shape[0]*(y+brain.shape[1]*z)]>90,'expanded box remains in fluorescent tissue');
  }
  assert.equal(brain.registration.registeredToMicroscopy,false);
});

test('six annotated neurons retain soma, branch topology and every original edge path',()=>{
  const compressed=read(metadata.skeleton);
  assert.equal(createHash('sha256').update(compressed).digest('hex'),metadata.skeletonSHA256);
  assert.equal(compressed.length,metadata.compressedBytes);
  assert.equal(neurons.length,6);
  assert.equal(new Set(neurons.map(n=>n.id)).size,6);
  const sourceIds=new Set();
  for(const neuron of neurons){
    const {positionsXYZ,sourceNodeIds,edges,edgeSourceNodeIds,sourceStatistics}=neuron;
    assert.equal(positionsXYZ.length,sourceNodeIds.length);
    assert.equal(edges.length,positionsXYZ.length-1);
    assert.equal(edgeSourceNodeIds.length,edges.length);
    const degree=Array(positionsXYZ.length).fill(0),adjacency=degree.map(()=>[]),originalEdges=new Set();
    edges.forEach(([a,b],i)=>{
      assert.ok(a!==b&&a>=0&&b>=0&&a<degree.length&&b<degree.length);
      degree[a]++;degree[b]++;adjacency[a].push(b);adjacency[b].push(a);
      const path=edgeSourceNodeIds[i];
      assert.equal(path[0],sourceNodeIds[a]);assert.equal(path.at(-1),sourceNodeIds[b]);
      for(let j=1;j<path.length;j++){
        const key=[path[j-1],path[j]].sort((a,b)=>a-b).join(',');
        assert.ok(!originalEdges.has(key));originalEdges.add(key);
      }
    });
    assert.equal(originalEdges.size,sourceStatistics.edgeCount);
    const seen=new Set([0]),pending=[0];
    while(pending.length)for(const next of adjacency[pending.pop()])if(!seen.has(next)){seen.add(next);pending.push(next);}
    assert.equal(seen.size,positionsXYZ.length);
    assert.equal(degree.filter(n=>n===1).length,sourceStatistics.terminalCount);
    assert.equal(degree.filter(n=>n>2).length,sourceStatistics.branchCount);
    assert.equal(neuron.nodeTypes.filter(n=>n===1).length,1);
    assert.equal(sourceStatistics.terminalCheckedCounts['1'],sourceStatistics.terminalCount);
    assert.ok(neuron.displayStatistics.maxDeviationUM<=4);
    positionsXYZ.forEach((point,i)=>{
      assert.ok(!sourceIds.has(sourceNodeIds[i]));sourceIds.add(sourceNodeIds[i]);
      transformXYZ(point,brain.affineSourceVoxelToOverview).forEach((n,axis)=>{
        assert.ok(n>=-.5&&n<brain.shape[axis]-.5);
        almost((n+.5)*brain.spacingUM[axis],point[axis]+.5);
      });
    });
  }
});
