import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {project,frameAtTime,shapeFromCoefficients} from '../src/math.js';
const manifest=JSON.parse(readFileSync(new URL('../public/data/manifest.json',import.meta.url)));
test('distorted browser projection agrees with OpenCV for all cameras and trials',()=>{
  const fixtures=JSON.parse(readFileSync(new URL('./projection-fixtures.json',import.meta.url)));
  let max=0;
  for(const f of fixtures){const camera=manifest.cameras.find(c=>c.name===f.camera);f.points.forEach((p,i)=>{const q=project(p,camera);max=Math.max(max,Math.hypot(q[0]-f.pixels[i][0],q[1]-f.pixels[i][1]));});}
  assert.ok(max<.0002,`projection error ${max} pixels`);
});
test('frame mapping respects exact boundaries, final frame, and floating point PTS',()=>{
  assert.equal(frameAtTime(0,100,500),0);assert.equal(frameAtTime(.009,100,500),0);
  assert.equal(frameAtTime(.29,100,500),29);assert.equal(frameAtTime(4.99,100,500),499);assert.equal(frameAtTime(5,100,500),499);
  for(let f=0;f<500;f++)assert.equal(frameAtTime(f/100,100,500),f);
});
test('all three tracks preserve expected frame and point counts; face and ears are complete',()=>{
  assert.deepEqual(manifest.trials.map(t=>[t.start,t.end]),[[13400,13650],[16300,16800],[46700,47000]]);
  for(const t of manifest.trials){const raw=gunzipSync(readFileSync(new URL('../public/data/'+t.track,import.meta.url)));assert.equal(raw.length,t.frames*169*3*4);const values=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);for(let f=0;f<t.frames;f++)for(let i=0;i<169*3;i++)assert.ok(Number.isFinite(values[f*169*3+i]));}
});
test('PCA model retains both ears, 15 independent modes, and returns mean on reset',()=>{
  const {models}=JSON.parse(readFileSync(new URL('../public/data/shape-model.json',import.meta.url)));
  for(const m of Object.values(models)){assert.equal(m.modes.length,15);assert.equal(m.mean.length,225);const alpha=new Array(15).fill(0);assert.deepEqual(shapeFromCoefficients(m,alpha),Float32Array.from(m.mean));alpha[0]=2;const out=shapeFromCoefficients(m,alpha);for(let i=0;i<225;i++)assert.ok(Math.abs(out[i]-(m.mean[i]+2*m.modes[0][i]))<.00001);}
});
test('web PCA deformation matches the existing desktop vis_pca tool',()=>{
  const {models}=JSON.parse(readFileSync(new URL('../public/data/shape-model.json',import.meta.url)));
  const fixtures=JSON.parse(readFileSync(new URL('./pca-fixtures.json',import.meta.url)));
  for(const {ear,alpha,expected} of fixtures){const actual=shapeFromCoefficients(models[ear],alpha);for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-expected[i])<.00001);}
});
