import {gunzipSync} from 'fflate';
import {VolumeView,CANDIDATE_COLORS} from './neurofly-volume.js';
import {makeReview,summarizeReviews,graphEdgesAfterReview} from './neurofly-review.js';
import {transformXYZ,physicalBox} from './neurofly-scale.js';
import {renderTrainingExample,initTrainingRollout} from './neurofly-training-view.js';

const $=id=>document.getElementById(id);
const dataRoot=new URL('./data/',window.location.href);
const formatBytes=n=>n>=1e6?`${(n/1e6).toFixed(2)} MB`:`${Math.round(n/1000)} KB`;
const labels={accept:'Accepted',reject:'Rejected',select:'Candidate selected',none:'True ending',uncertain:'Deferred'};
const typeNames={'fragment-connection':'Fragment connection','endpoint-selection':'Endpoint selection','point-proposal':'Point proposal'};

function choicesFor(task){
  if(task.taskType==='fragment-connection')return [
    {decision:'accept',label:'Accept'}, {decision:'reject',label:'Reject'}, {decision:'uncertain',label:'Uncertain'},
  ];
  const choices=task.candidates.map(candidate=>({decision:'select',candidateId:candidate.id,label:`Select ${candidate.label}`}));
  if(task.taskType==='point-proposal')choices.push({decision:'none',label:'None',detail:'Label A as a true ending'});
  choices.push({decision:'uncertain',label:'Uncertain',detail:'Defer this task for further review'});
  return choices;
}

function feedbackFor(task,record){
  if(!record){
    if(task.taskType==='point-proposal')return 'Choose a proposed point to extend A, or None to label A as a true ending. Use Uncertain to defer the decision.';
    if(task.taskType==='endpoint-selection')return 'Select the endpoint that continues fragment A. Use Uncertain when the image evidence is insufficient.';
    return 'Assess continuity between the two fragments in 3D. Use Uncertain when the image evidence is insufficient.';
  }
  if(record.decision==='none')return 'None selected: A is labeled as a true ending. No point or edge is added.';
  if(record.decision==='uncertain')return 'Uncertain: the graph is unchanged and the task is deferred. This does not label A as a true ending.';
  if(record.decision==='reject')return 'Connection rejected: the fragments remain separate. A is not labeled as a true ending.';
  if(record.decision==='select'){
    const candidate=task.candidates.find(c=>c.id===record.selectedCandidateId);
    return task.taskType==='point-proposal'
      ?`Point ${candidate.label} selected: extend the trajectory from A to this point.`
      :`Endpoint ${candidate.label} selected: connect A to this fragment.`;
  }
  return 'Connection accepted: the two fragments are joined.';
}

async function responseFor(file){
  const response=await fetch(new URL(file,dataRoot));
  if(!response.ok)throw new Error(`Could not load ${file} (${response.status})`);
  return response;
}

async function boot(){
  const manifest=await(await responseFor('manifest.json?revision=whole-brain-scale-v1')).json();
  const storageKey=`neurofly-reviews-${manifest.revision||manifest.schemaVersion}`;
  const tasks=manifest.tasks.map(task=>({...task,revision:manifest.revision,dataRevision:manifest.dataRevision}));
  const cache=new Map(),records=new Map(),undo=[];
  let index=0,version=0,ready=false,overview;
  let view;
  try{view=new VolumeView($('volume-view'));}
  catch(error){throw new Error('The 3D viewer needs WebGL 2. Please open this page in a browser with hardware graphics enabled.',{cause:error});}
  $('volume-view').addEventListener('volume-error',event=>{$('volume-status').hidden=false;$('volume-status').textContent=event.detail;});

  // Stored decisions are tied to this task revision; validate each row against
  // its original candidate set before reconstructing a record from source data.
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');
    if(Array.isArray(saved))for(const row of saved){
      const task=tasks.find(t=>t.id===row.taskId);
      if(!task)continue;
      try{
        graphEdgesAfterReview(task,row);
        records.set(task.id,makeReview(task,row.decision,{candidateId:row.selectedCandidateId,reviewer:row.reviewer,timestamp:row.timestamp}));
      }catch{ /* Ignore an invalid or stale row without discarding other reviews. */ }
    }
  }catch{ /* Storage may be disabled; reviews still work for this visit. */ }

  function persist(){try{localStorage.setItem(storageKey,JSON.stringify([...records.values()]));}catch{}}
  async function loadVolume(spec){
    if(!cache.has(spec.volume))cache.set(spec.volume,(async()=>{
      const bytes=new Uint8Array(await(await responseFor(spec.volume)).arrayBuffer());
      const voxels=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes;
      if(voxels.byteLength!==spec.shape.reduce((a,b)=>a*b,1))throw new Error('Invalid volume dimensions');
      return voxels;
    })().catch(error=>{cache.delete(spec.volume);throw error;}));
    return cache.get(spec.volume);
  }

  function setRegion(task){
    if(overview){
      const factor=manifest.overview.downsampleFactor;
      overview.setRegion(task.origin.map((n,i)=>n/factor[i]),task.shape.map((n,i)=>n/factor[i]));
    }
    const extentMM=manifest.sourceVolume.shapeXYZ.map((n,i)=>n*manifest.sourceVolume.voxelSizeUM[i]/1000);
    $('scale-caption').textContent=`${extentMM.join(' × ')} mm · fluorescence image at 1 µm per voxel. Gold box: the current 32 µm task cube.`;
  }

  function renderChoices(task){
    $('decision-actions').replaceChildren();
    choicesFor(task).forEach((choice,i)=>{
      const button=document.createElement('button');button.type='button';
      button.className=`decision-button ${choice.decision}${choice.candidateId?' candidate-choice':''}`;
      button.dataset.decision=choice.decision;button.dataset.candidateId=choice.candidateId||'';
      button.id=choice.candidateId?`decision-candidate-${choice.candidateId}`:`decision-${choice.decision}`;
      const text=document.createElement('span'),label=document.createElement('span');text.className='choice-content';label.className='choice-label';label.textContent=choice.label;text.append(label);
      let detail=choice.detail;
      if(choice.candidateId){
        const candidate=task.candidates.find(c=>c.id===choice.candidateId),candidateIndex=task.candidates.indexOf(candidate);
        button.style.setProperty('--candidate-color',CANDIDATE_COLORS[candidateIndex%CANDIDATE_COLORS.length]);
        const swatch=document.createElement('i');swatch.className='choice-swatch';swatch.setAttribute('aria-hidden','true');button.append(swatch);
        const physicalDistance=Math.hypot(...candidate.position.map((n,j)=>(n-task.sourcePosition[j])*task.sourceVolume.voxelSizeUM[j]));
        detail=`${candidate.kind==='image-point'?'Proposed point':'Fragment endpoint'} · ${physicalDistance.toFixed(1)} µm from A`;
        button.onpointerenter=()=>{if(ready)view.setHighlight(candidate.id);};
        button.onpointerleave=()=>{if(ready)view.setHighlight(null);};
        button.onfocus=()=>{if(ready)view.setHighlight(candidate.id);};
        button.onblur=()=>{if(ready)view.setHighlight(null);};
      }
      if(detail){const small=document.createElement('small');small.className='choice-detail';small.textContent=detail;text.append(small);}
      const key=document.createElement('kbd');key.textContent=i+1;key.setAttribute('aria-hidden','true');
      button.append(text,key);button.onclick=()=>review(choice.decision,choice.candidateId);
      $('decision-actions').append(button);
    });
    const legend=$('candidate-legend');
    if(legend){
      legend.replaceChildren();
      task.candidates.forEach((candidate,i)=>{
        const item=document.createElement('span'),dot=document.createElement('i');
        dot.style.background=CANDIDATE_COLORS[i%CANDIDATE_COLORS.length];
        item.append(dot,document.createTextNode(`${candidate.label} · ${candidate.kind==='image-point'?'proposed point':'fragment endpoint'}`));legend.append(item);
      });
    }
  }

  function updateReview(){
    const task=tasks[index],record=records.get(task.id),summary=summarizeReviews([...records.values()]);
    $('review-progress').textContent=`${summary.total} / ${tasks.length} tasks reviewed`;
    $('next-task').disabled=!ready;
    $('next-task').textContent=index===tasks.length-1?'First task':'Next task';
    $('undo-decision').disabled=undo.length===0;
    $('reset-session').disabled=summary.total===0;
    for(const id of ['view-xy','view-xz','view-yz','view-reset','contrast','depth','annotations-toggle'])$(id).disabled=!ready;
    for(const button of $('decision-actions').children){
      const selected=record?.decision===button.dataset.decision&&(!button.dataset.candidateId||record.selectedCandidateId===button.dataset.candidateId);
      button.disabled=!ready;button.setAttribute('aria-pressed',String(Boolean(selected)));button.classList.toggle('selected',Boolean(selected));
    }
    [...$('task-tabs').children].forEach((button,i)=>{
      button.classList.toggle('active',i===index);button.setAttribute('aria-pressed',String(i===index));
      const row=records.get(tasks[i].id);button.dataset.reviewed=String(Boolean(row));
      button.title=row?`${tasks[i].title} · ${labels[row.decision]}`:tasks[i].title;
    });
    $('decision-feedback').textContent=feedbackFor(task,record);
    $('decision-feedback').dataset.decision=record?.decision||'';
    if(ready){view.setHighlight(null);view.setGraph(record);}
    document.documentElement.dataset.task=task.id;
    document.documentElement.dataset.taskType=task.taskType;
    document.documentElement.dataset.decision=record?.decision||'pending';
    renderTrainingExample(task,record);
  }

  async function selectTask(nextIndex){
    const currentVersion=++version;index=nextIndex;ready=false;const task=tasks[index];
    $('volume-status').hidden=false;$('volume-status').textContent=`Loading ${formatBytes(task.compressedBytes)} of local image context…`;
    $('task-number').textContent=`TASK ${String(index+1).padStart(2,'0')} / ${String(tasks.length).padStart(2,'0')}`;
    $('task-kind').textContent=typeNames[task.taskType];
    $('task-title').textContent=task.prompt;
    $('task-context').textContent=task.context;
    $('task-source').textContent=`${task.sourceVolume.species} · ${task.sourceVolume.imaging} · 1 µm/voxel`;
    $('task-size').textContent=`${task.shape.map((n,i)=>n*task.sourceVolume.voxelSizeUM[i]).join(' × ')} µm`;
    $('contrast').value=1;$('depth').value=1;
    renderChoices(task);updateReview();setRegion(task);
    try{
      const data=await loadVolume(task);if(currentVersion!==version)return;
      view.setData(task,data);view.setScaleBar(10/task.sourceVolume.voxelSizeUM[0],'10 µm');view.setContrast(1);view.setDepth(1);view.setAnnotations($('annotations-toggle').checked);
      ready=true;$('volume-status').hidden=true;setActiveView('oblique');updateReview();
    }catch(error){if(currentVersion===version){$('volume-status').textContent='This volume could not load. Select the task again to retry.';console.error(error);}}
  }

  function review(decision,candidateId){
    if(!ready)return;
    const task=tasks[index],record=makeReview(task,decision,{candidateId});
    undo.push({id:task.id,previous:records.get(task.id)||null});
    records.set(task.id,record);persist();updateReview();
  }
  $('next-task').onclick=()=>selectTask((index+1)%tasks.length);
  $('undo-decision').onclick=()=>{
    const last=undo.pop();if(!last)return;
    if(last.previous)records.set(last.id,last.previous);else records.delete(last.id);
    persist();const next=tasks.findIndex(t=>t.id===last.id);
    if(next!==index)selectTask(next);else updateReview();
  };
  $('reset-session').onclick=()=>{records.clear();undo.length=0;persist();updateReview();};
  function setActiveView(mode){for(const axis of ['xy','xz','yz'])$(`view-${axis}`).setAttribute('aria-pressed',String(mode===axis));}
  for(const axis of ['xy','xz','yz'])$(`view-${axis}`).onclick=()=>{view.setView(axis);setActiveView(axis);};
  $('view-reset').onclick=()=>{view.setView('oblique');setActiveView('oblique');};
  $('contrast').oninput=e=>view.setContrast(Number(e.target.value));
  $('depth').oninput=e=>view.setDepth(Number(e.target.value));
  $('annotations-toggle').onchange=e=>view.setAnnotations(e.target.checked);
  window.addEventListener('keydown',event=>{
    if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||['INPUT','SELECT','TEXTAREA','VIDEO'].includes(event.target.tagName))return;
    const choice=choicesFor(tasks[index])[Number(event.key)-1];
    if(/^[1-9]$/.test(event.key)&&choice){event.preventDefault();review(choice.decision,choice.candidateId);}
  });
  tasks.forEach((task,i)=>{const button=document.createElement('button');button.type='button';button.textContent=task.title;button.onclick=()=>selectTask(i);$('task-tabs').append(button);});

  async function initOverview(){
    const spec=manifest.overview,voxels=await loadVolume(spec);
    overview=new VolumeView($('scale-overview'));
    const center=spec.shape.map(n=>(n-1)/2);
    overview.setData({...spec,nodes:[{id:'a',position:center}],edges:[],sourceId:'a',sourcePosition:center,candidates:[]},voxels);
    overview.setAnnotations(false);overview.setView('xy');
    overview.setScaleBar(200/(manifest.sourceVolume.voxelSizeUM[0]*spec.downsampleFactor[0]),'200 µm');
    setRegion(tasks[index]);overview.enableAutoRotation();
  }
  async function initBrain(){
    const spec=await(await responseFor('t154-brain.json')).json(),voxels=await loadVolume(spec);
    const brain=new VolumeView($('brain-overview'));
    const center=spec.shape.map(n=>(n-1)/2);
    brain.setData({...spec,nodes:[{id:'a',position:center}],edges:[],sourceId:'a',sourcePosition:center,candidates:[]},voxels);
    brain.setAnnotations(false);brain.setView(spec.preferredView||'oblique');
    const sizeMM=manifest.sourceVolume.shapeXYZ.map((n,i)=>n*manifest.sourceVolume.voxelSizeUM[i]/1000);
    const box=physicalBox(spec.illustrativeBlockCenterXYZ,sizeMM,spec.spacingMM);
    brain.setRegion(box.origin,box.size);brain.setScaleBar(2/spec.spacingMM[0],'2 mm');
    brain.setContrast(.7);
    $('brain-view-reset').disabled=false;
    $('brain-view-reset').onclick=()=>brain.setView(spec.preferredView||'oblique');
    try{
      const bytes=new Uint8Array(await(await responseFor('t154-neurons-v1.json.gz')).arrayBuffer());
      // Static servers may set Content-Encoding:gzip for .json.gz, in which
      // case fetch has already decoded it. Support both hosting behaviors.
      const data=JSON.parse(new TextDecoder().decode(bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes));
      const traces=data.neurons.map(neuron=>{
        const positions=neuron.positionsXYZ.map(p=>transformXYZ(p,spec.affineSourceVoxelToOverview));
        return {...neuron,segments:neuron.edges.flatMap(([a,b])=>[...positions[a],...positions[b]])};
      });
      brain.setTraces(traces);
    }catch(error){$('brain-caption').textContent='12 × 8 × 13.2 mm · T154 fluorescence. Neuron annotations could not load.';console.error(error);}
    brain.enableAutoRotation();
  }
  initOverview().catch(error=>{$('scale-overview').textContent='Overview unavailable; local tasks remain interactive.';console.error(error);});
  initBrain().catch(error=>{$('brain-overview').textContent='Brain reference unavailable.';console.error(error);});
  await selectTask(0);
}

initTrainingRollout();
boot().catch(error=>{
  $('volume-status').hidden=false;$('volume-status').textContent=error.message;
  for(const button of document.querySelectorAll('#decision-actions button, #next-task'))button.disabled=true;
  console.error(error);
});
