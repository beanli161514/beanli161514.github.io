import {gunzipSync} from 'fflate';
import {VolumeView} from './neurofly-volume.js';
import {makeReview,summarizeReviews,createExport,graphEdgesAfterReview} from './neurofly-review.js';

const $=id=>document.getElementById(id);
const dataRoot=new URL('./data/',window.location.href);
const formatBytes=n=>n>=1e6?`${(n/1e6).toFixed(2)} MB`:`${Math.round(n/1000)} KB`;
const storageKey='neurofly-workflow-reviews-v1';
const labels={accept:'Accepted',reject:'Rejected',uncertain:'Deferred'};
const feedback={
  accept:'Connection accepted. A positive candidate label now links the image context, endpoint pair, and your review.',
  reject:'Connection rejected. This pair becomes a negative candidate label, rather than a missing or forgotten edge.',
  uncertain:'Uncertainty preserved. The graph stays unchanged and this case is kept for another review, outside candidate training labels.',
};

async function responseFor(file){
  const response=await fetch(new URL(file,dataRoot));
  if(!response.ok)throw new Error(`Could not load ${file} (${response.status})`);
  return response;
}

async function boot(){
  const manifest=await(await responseFor('manifest.json')).json();
  const tasks=manifest.tasks,cache=new Map(),loadedFiles=new Map(),records=new Map(),undo=[];
  let index=0,version=0,ready=false,overview;
  let view;
  try{view=new VolumeView($('volume-view'));}
  catch(error){throw new Error('The 3D viewer needs WebGL 2. Please open this page in a browser with hardware graphics enabled.',{cause:error});}
  $('volume-view').addEventListener('volume-error',event=>{$('volume-status').hidden=false;$('volume-status').textContent=event.detail;});

  // Recover only decisions for the current, versioned task set. Reconstruct the
  // record from source metadata, rather than trusting stale browser geometry.
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');
    if(Array.isArray(saved))for(const row of saved){
      const task=tasks.find(t=>t.id===row.taskId);
      if(task&&['accept','reject','uncertain'].includes(row.decision))records.set(task.id,makeReview(task,row.decision,{timestamp:row.timestamp}));
    }
  }catch{ /* Storage may be disabled; the demo still works for this visit. */ }

  function persist(){try{localStorage.setItem(storageKey,JSON.stringify([...records.values()]));}catch{}}
  function updateBytes(){
    const sum=[...loadedFiles.values()].reduce((a,b)=>a+b,0);
    $('loaded-bytes').textContent=formatBytes(sum);
  }
  async function loadVolume(spec){
    if(!cache.has(spec.volume))cache.set(spec.volume,(async()=>{
      const bytes=new Uint8Array(await(await responseFor(spec.volume)).arrayBuffer());
      const voxels=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes;
      if(voxels.byteLength!==spec.shape.reduce((a,b)=>a*b,1))throw new Error('Invalid volume dimensions');
      loadedFiles.set(spec.volume,spec.compressedBytes);updateBytes();return voxels;
    })().catch(error=>{cache.delete(spec.volume);throw error;}));
    return cache.get(spec.volume);
  }

  function setRegion(task){
    if(overview){
      const factor=manifest.overview.downsampleFactor;
      overview.setRegion(task.origin.map((n,i)=>n/factor[i]),task.shape.map((n,i)=>n/factor[i]));
    }
    const fraction=task.shape.reduce((a,b)=>a*b,1)/manifest.sourceVolume.voxelCount*100;
    $('scale-caption').textContent=`${manifest.sourceVolume.shapeXYZ.join(' × ')} voxels · ${formatBytes(manifest.sourceVolume.uncompressedBytes)} source block. The highlighted ${task.shape.join(' × ')} window contains ${fraction.toFixed(2)}% of its voxels.`;
  }

  function updateReview(){
    const task=tasks[index],record=records.get(task.id),summary=summarizeReviews([...records.values()]);
    $('records-count').textContent=summary.total;
    $('positive-count').textContent=summary.accept;
    $('negative-count').textContent=summary.reject;
    $('uncertain-count').textContent=summary.uncertain;
    $('review-progress').textContent=`${summary.total} / ${tasks.length} cases reviewed`;
    $('next-task').disabled=!ready;
    $('next-task').textContent=index===tasks.length-1?'Back to first case ↗':'Next case →';
    $('undo-decision').disabled=undo.length===0;
    $('export-records').disabled=summary.total===0;
    $('reset-session').disabled=summary.total===0;
    for(const id of ['view-xy','view-xz','view-yz','view-reset','contrast','depth','annotations-toggle'])$(id).disabled=!ready;
    for(const decision of ['accept','reject','uncertain']){
      const button=$(`decision-${decision}`);button.disabled=!ready;
      button.setAttribute('aria-pressed',String(record?.decision===decision));
      button.classList.toggle('selected',record?.decision===decision);
    }
    [...$('task-tabs').children].forEach((button,i)=>{
      button.classList.toggle('active',i===index);button.setAttribute('aria-pressed',String(i===index));
      const row=records.get(tasks[i].id);button.dataset.reviewed=String(Boolean(row));
      button.title=row?`${tasks[i].title} · ${labels[row.decision]}`:tasks[i].title;
    });
    $('decision-feedback').textContent=record?feedback[record.decision]:'Look for continuous image signal and a consistent 3D direction. Choose Uncertain whenever the evidence is insufficient.';
    $('decision-feedback').dataset.decision=record?.decision||'';
    const edgeCount=graphEdgesAfterReview(task,record).length;
    $('graph-status').textContent=record?.decision==='accept'?`Edge A → B added · ${edgeCount} local edges`:record?.decision==='reject'?`Edge A → B excluded · ${edgeCount} local edges`:record?.decision==='uncertain'?`Graph unchanged · case deferred · ${edgeCount} local edges`:`${edgeCount} context edges · proposed join under review`;
    $('record-json').textContent=JSON.stringify(record?{
      task:record.taskId,
      source:record.source.volume.filename,
      crop_origin_xyz:record.source.origin,
      candidate:[record.proposedEdge.sourceId,record.proposedEdge.targetId],
      decision:record.decision,
      reviewer:record.reviewer,
      reviewed_at:record.timestamp,
      status:record.status,
      candidate_label:record.trainingLabel,
      validation:record.validation,
    }:{task:task.id,candidate:[task.sourceId,task.targetId],decision:null,status:'awaiting_review'},null,2);
    for(const name of ['review','graph','data']){
      const el=$(`pipeline-${name}`);el.classList.toggle('active',name==='review'&&!record||name==='graph'&&record?.decision==='uncertain'||name==='data'&&record&&record.decision!=='uncertain');el.classList.toggle('complete',Boolean(record)&&name==='review');
    }
    const reference=$('reference-note');
    if(reference){reference.hidden=!record;reference.textContent=record?`Source context: ${task.referenceNote}`:'';}
    if(ready)view.setGraph(record);
    document.documentElement.dataset.task=task.id;
    document.documentElement.dataset.decision=record?.decision||'pending';
  }

  async function selectTask(nextIndex){
    const currentVersion=++version;index=nextIndex;ready=false;const task=tasks[index];
    $('volume-status').hidden=false;$('volume-status').textContent=`Loading ${formatBytes(task.compressedBytes)} of local image context…`;
    $('task-number').textContent=`CASE ${String(index+1).padStart(2,'0')} / ${String(tasks.length).padStart(2,'0')}`;
    $('task-title').textContent=task.prompt;
    $('task-context').textContent=task.context;
    $('task-source').textContent=`${task.sourceVolume.species} · ${task.sourceVolume.imaging} · ${task.shape[0]}³ voxels`;
    $('task-bytes').textContent=`${formatBytes(task.compressedBytes)} compressed crop`;
    $('contrast').value=1;$('depth').value=1;
    updateReview();setRegion(task);
    try{
      const data=await loadVolume(task);if(currentVersion!==version)return;
      view.setData(task,data);view.setContrast(1);view.setDepth(1);view.setAnnotations($('annotations-toggle').checked);
      ready=true;$('volume-status').hidden=true;setActiveView('oblique');updateReview();
    }catch(error){if(currentVersion===version){$('volume-status').textContent='This volume could not load. Select the case again to retry.';console.error(error);}}
  }

  function review(decision){
    if(!ready)return;
    const task=tasks[index];undo.push({id:task.id,previous:records.get(task.id)||null});
    records.set(task.id,makeReview(task,decision));persist();updateReview();
  }
  for(const decision of ['accept','reject','uncertain'])$(`decision-${decision}`).onclick=()=>review(decision);
  $('next-task').onclick=()=>selectTask((index+1)%tasks.length);
  $('undo-decision').onclick=()=>{
    const last=undo.pop();if(!last)return;
    if(last.previous)records.set(last.id,last.previous);else records.delete(last.id);
    persist();const next=tasks.findIndex(t=>t.id===last.id);
    if(next!==index)selectTask(next);else updateReview();
  };
  $('reset-session').onclick=()=>{records.clear();undo.length=0;persist();updateReview();};
  $('export-records').onclick=()=>{
    const payload=createExport([...records.values()]);payload.dataset=manifest.provenance;
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='neurofly-demo-reviews.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  function setActiveView(mode){for(const axis of ['xy','xz','yz'])$(`view-${axis}`).setAttribute('aria-pressed',String(mode===axis));}
  for(const axis of ['xy','xz','yz'])$(`view-${axis}`).onclick=()=>{view.setView(axis);setActiveView(axis);};
  $('view-reset').onclick=()=>{view.setView('oblique');setActiveView('oblique');};
  $('contrast').oninput=e=>view.setContrast(Number(e.target.value));
  $('depth').oninput=e=>view.setDepth(Number(e.target.value));
  $('annotations-toggle').onchange=e=>view.setAnnotations(e.target.checked);
  window.addEventListener('keydown',event=>{
    if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;
    const decision={'1':'accept','2':'reject','3':'uncertain'}[event.key];if(decision){event.preventDefault();review(decision);}
  });
  tasks.forEach((task,i)=>{const button=document.createElement('button');button.type='button';button.textContent=`0${i+1}  ${task.title}`;button.onclick=()=>selectTask(i);$('task-tabs').append(button);});

  // The overview is a max-pooled version of the *same* real source block.
  // It loads independently so a usable review never waits for a panorama.
  async function initOverview(){
    const spec=manifest.overview,voxels=await loadVolume(spec);
    overview=new VolumeView($('scale-overview'));
    const center=spec.shape.map(n=>(n-1)/2);
    overview.setData({...spec,nodes:[{id:'a',position:center},{id:'b',position:center}],edges:[],sourceId:'a',targetId:'b'},voxels);
    overview.setAnnotations(false);overview.setView('xy');setRegion(tasks[index]);
  }
  initOverview().catch(error=>{$('scale-overview').textContent='Overview unavailable; local cases remain interactive.';console.error(error);});
  await selectTask(0);
}

boot().catch(error=>{
  $('volume-status').hidden=false;$('volume-status').textContent=error.message;
  for(const id of ['decision-accept','decision-reject','decision-uncertain','next-task'])$(id).disabled=true;
  console.error(error);
});
