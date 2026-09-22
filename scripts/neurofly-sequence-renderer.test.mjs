import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {VolumeView} from '../src/neurofly-volume.js';
import {createFiberRollout} from '../src/neurofly-rollout.js';

const spec=JSON.parse(readFileSync(new URL('../public/neurofly/data/tracing.json',import.meta.url)));
const rollout=createFiberRollout(spec);

function fixture() {
  const elements=[];
  const previous=globalThis.document;
  globalThis.document={createElement(){
    return {style:{},hidden:true,classList:{toggle(){}},remove(){this.removed=true;}};
  }};
  const view=Object.create(VolumeView.prototype);
  Object.assign(view,{
    annotations:new THREE.Group(),graphScene:new THREE.Scene(),labels:[],labelEntries:[],lineMaterials:[],clipPlanes:[new THREE.Plane(),new THREE.Plane()],
    container:{clientWidth:800,clientHeight:500,append(element){elements.push(element);}},
    render(){},
  });
  return {view,elements,restore(){globalThis.document=previous;}};
}

function lineCoordinates(object) {
  const a=object.geometry.attributes.instanceStart,b=object.geometry.attributes.instanceEnd;
  return Array.from({length:a.count},(_,i)=>[
    a.getX(i),a.getY(i),a.getZ(i),b.getX(i),b.getY(i),b.getZ(i),
  ]).flat();
}

test('sequence renders measured fragments and highlights bridge endpoints independently of the adopted tip',()=>{
  const {view,elements,restore}=fixture();
  try {
    view.setFiberSequence(spec.pathXYZ);
    assert.notEqual(view.fiberSequence.positions[0],spec.pathXYZ[0]);
    view.setFiberState(rollout.initial);
    assert.equal(view.labels.length,0);
    const count=(color)=>view.annotations.children.filter(object=>object.isInstancedMesh&&object.material.color.getHexString()===color)
      .reduce((sum,object)=>sum+object.count,0);
    assert.equal(count('38cddd'),5);
    assert.equal(count('9993b4'),rollout.initial.visibleNodeIndices.length-5);

    const join=rollout.steps.find(state=>state.taskType==='endpoint-selection');
    view.setFiberState(join);
    assert.deepEqual(join.activeEdge,[23,24]);
    assert.equal(join.tipIndex,28);
    assert.deepEqual(view.labelEntries.map(entry=>[entry.label,entry.position]),[
      ['A',spec.pathXYZ[23]],['B',spec.pathXYZ[24]],['C',spec.pathXYZ[28]],
    ]);
    const active=view.annotations.children.find(object=>object.isLineSegments2&&object.material.linewidth===3.4);
    assert.equal(active.material.color.getHexString(),'ffcd62');
    assert.deepEqual(lineCoordinates(active),[...spec.pathXYZ[23],...spec.pathXYZ[24]]);
    const proposal=view.annotations.children.find(object=>object.isLineSegments2&&object.material.dashed);
    assert.deepEqual(lineCoordinates(proposal),[...spec.pathXYZ[23],...spec.pathXYZ[28]]);
    assert.equal(proposal.material.color.getHexString(),'c0a3f6');

    const resources=view.annotations.children.flatMap(object=>[object.geometry,object.material]);
    let disposed=0;
    resources.forEach(resource=>resource.addEventListener('dispose',()=>disposed++));
    const oldLabels=[...view.labels];
    view.setFiberState(rollout.initial);
    assert.equal(disposed,resources.length,'previous step geometry and materials must be disposed');
    assert.ok(oldLabels.every(label=>label.removed));
    assert.equal(view.labels.length,0);
    assert.equal(count('38cddd'),5,'rewinding must restore only the original seed as integrated');
    assert.ok(elements.filter(element=>!element.removed).length===0);
  } finally {view.setFiberSequence(spec.pathXYZ);restore();}
});

test('all rollout states use the supplied graph geometry and preserve high-resolution node meshes',()=>{
  const {view,restore}=fixture();
  const original=structuredClone(spec.pathXYZ);
  try {
    view.setFiberSequence(spec.pathXYZ);
    for(const state of [rollout.initial,...rollout.steps]){
      view.setFiberState(state);
      const lines=view.annotations.children.filter(object=>object.isLineSegments2);
      const base=lines.filter(object=>object.material.linewidth===1.9||object.material.linewidth===2.2);
      const actual=base.flatMap(object=>{
        const coordinates=lineCoordinates(object);
        return Array.from({length:coordinates.length/6},(_,i)=>coordinates.slice(i*6,i*6+6).join(','));
      }).sort();
      const expected=state.visibleEdges.map(([a,b])=>[...spec.pathXYZ[a],...spec.pathXYZ[b]].join(',')).sort();
      assert.deepEqual(actual,expected);
      for(const object of view.annotations.children.filter(object=>object.isInstancedMesh)){
        assert.equal(object.geometry.parameters.widthSegments,24);
        assert.equal(object.geometry.parameters.heightSegments,16);
      }
    }
    assert.deepEqual(spec.pathXYZ,original);
    const before=view.fiberSequence.state;
    assert.throws(()=>view.setFiberState({...before,visibleEdges:[[0,999]]}),/Invalid fiber sequence state/);
    assert.equal(view.fiberSequence.state,before,'an invalid update must not discard the current scene');
    view.setFiberPath(spec.pathXYZ);
    assert.equal(view.fiberSequence,null,'legacy prefix playback must clear sequence state');
  } finally {view.setFiberSequence(spec.pathXYZ);restore();}
});

test('surrounding graph persists during replay, clips crossing edges to the volume, and clears on a new sequence',()=>{
  const {view,restore}=fixture();
  try {
    view.task={shape:spec.shape};
    view.setFiberSequence(spec.pathXYZ);
    const context={nodes:[{id:1,position:[-5,20,20]},{id:2,position:[110,20,20]}],edges:[[1,2]]};
    view.setFiberContext(context);
    const objects=[...view.fiberContext.children];
    const lines=objects.find(object=>object.isLineSegments2);
    assert.equal(lines.material.linewidth,1.2);
    assert.equal(lines.material.clippingPlanes.length,8);
    assert.deepEqual(lineCoordinates(lines),[-5,20,20,110,20,20]);
    const bounds=lines.material.clippingPlanes.slice(2);
    assert.ok(bounds.every(plane=>plane.distanceToPoint(new THREE.Vector3(20,20,20))>=0));
    assert.ok(bounds.some(plane=>plane.distanceToPoint(new THREE.Vector3(-5,20,20))<0));
    assert.ok(bounds.some(plane=>plane.distanceToPoint(new THREE.Vector3(110,20,20))<0));
    for(const state of [rollout.initial,rollout.steps[12],rollout.steps.at(-1),rollout.initial]){
      view.setFiberState(state);
      assert.deepEqual(view.fiberContext.children,objects);
    }
    view.setAnnotations(false);assert.equal(view.fiberContext.visible,false);
    view.setAnnotations(true);assert.equal(view.fiberContext.visible,true);
    let disposed=0;
    objects.flatMap(object=>[object.geometry,object.material]).forEach(resource=>resource.addEventListener('dispose',()=>disposed++));
    view.setFiberSequence(spec.pathXYZ);
    assert.equal(disposed,objects.length*2);
    assert.equal(view.fiberContext.children.length,0);
    assert.equal(view.fiberContextLineMaterial,null);
  } finally {view.setFiberSequence(spec.pathXYZ);restore();}
});
