import {gunzipSync} from 'fflate';
import {VolumeView} from './neurofly-volume.js';
import {createFiberRollout} from './neurofly-rollout.js';

const $=id=>document.getElementById(id);
/** The timeline owns the model-head highlight, independently of manual review. */
function highlightAction(state){
  for(const row of document.querySelectorAll('[data-head]')){
    const active=row.dataset.head===state.taskType;
    row.classList.toggle('active',active);
    if(active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
    const available=state.taskType==='fragment-connection'?['Accept','Reject']:
      [...state.candidates.map(candidate=>candidate.label),...(state.taskType==='point-proposal'?['None']:[])];
    for(const option of row.querySelectorAll('[data-head-option]')){
      const selected=active&&option.dataset.headOption===state.option;
      option.classList.toggle('active',selected);
      option.classList.toggle('unavailable',active&&!available.includes(option.dataset.headOption));
      if(selected)option.setAttribute('aria-current','true');else option.removeAttribute('aria-current');
    }
  }
}

/** Illustrate structured graph actions using an exact measured fiber. */
export function initTrainingRollout(){
  const container=$('training-volume');
  if(!container)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let visible=false,playing=!motion.matches,ready=false,loading=false,contextLost=false,view,spec,rollout,count=0,timer;
  const current=()=>count?rollout.steps[count-1]:rollout.initial;
  const schedule=()=>{
    clearTimeout(timer);
    if(!ready||!playing||!visible||document.hidden||view.interacting)return;
    timer=setTimeout(()=>{
      count=count===rollout.steps.length?0:count+1;
      draw();schedule();
    },count===rollout.steps.length?3000:!count?1500:current().taskType==='point-proposal'?650:2200);
  };
  const updateControls=()=>{
    $('training-play').disabled=!ready;
    $('training-play').textContent=playing?'Pause':'Play';
    $('training-play').setAttribute('aria-label',playing?'Pause structured tracing':'Play structured tracing');
    $('training-timeline').disabled=!ready;
    $('training-restart').disabled=loading||contextLost;
  };
  const draw=()=>{
    const state=current();
    view.setFiberState(state);
    highlightAction(state);
    $('training-timeline').value=count;
    $('training-timeline').setAttribute('aria-valuetext',`${count} of ${rollout.steps.length} steps: ${state.label}`);
    $('training-step').textContent=`${count} / ${rollout.steps.length} steps`;
    $('training-action').textContent=state.label;
    $('training-action-detail').textContent=state.detail;
    $('training-fragments').textContent=state.fragmentCount===1?'1 connected fiber':`${state.fragmentCount} fragments`;
    container.dataset.visibleNodes=state.visibleNodeIndices.length;
    container.dataset.action=state.taskType||'initial';
    container.dataset.step=count;
    updateControls();
  };
  const load=async()=>{
    if(ready||loading||contextLost)return;
    loading=true;updateControls();
    const status=$('training-volume-status');status.hidden=false;status.textContent='Loading microscopy and fiber fragments…';
    try{
      const dataRoot=new URL('./data/',window.location.href);
      const response=await fetch(new URL('tracing.json',dataRoot));
      if(!response.ok)throw new Error('Fiber metadata unavailable');
      spec=await response.json();
      rollout=createFiberRollout(spec);
      const [payload,contextResponse]=await Promise.all([
        fetch(new URL(spec.volume,dataRoot)),fetch(new URL('tracing-context.json',dataRoot)),
      ]);
      if(!payload.ok)throw new Error('Fiber volume unavailable');
      if(!contextResponse.ok)throw new Error('Annotation context unavailable');
      const context=await contextResponse.json();
      if(context.origin.some((n,i)=>n!==spec.origin[i])||context.shape.some((n,i)=>n!==spec.shape[i]))throw new Error('Annotation context does not match the image crop.');
      // The active path is drawn by the action sequence, including its gaps.
      // Every other recorded segment remains visible as spatial context.
      const edgeKey=([a,b])=>JSON.stringify([a,b].sort((x,y)=>x-y));
      const pathEdges=new Set(spec.edges.map(edgeKey)),pathIds=new Set(spec.nodeIds);
      const contextEdges=context.edges.filter(edge=>!pathEdges.has(edgeKey(edge)));
      const contextIds=new Set(contextEdges.flat());
      const contextNodes=context.nodes.filter(node=>contextIds.has(node.id)||!pathIds.has(node.id));
      const bytes=new Uint8Array(await payload.arrayBuffer());
      const voxels=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes;
      view??=new VolumeView(container);
      // The renderer's clipping focus is the crop center, not a boundary node.
      const center=spec.shape.map(n=>(n-1)/2);
      view.setData({...spec,nodes:[{id:'center',position:center}],edges:[],sourceId:'center',candidates:[]},voxels);
      view.setFiberSequence(spec.pathXYZ);
      view.setFiberContext({nodes:contextNodes,edges:contextEdges});
      view.setScaleBar(20/spec.voxelSizeUM[0],'20 µm');
      view.setContrast(.85);
      view.setView(spec.preferredView||'oblique');
      view.controls.addEventListener('start',schedule);
      view.controls.addEventListener('end',schedule);
      $('training-timeline').max=rollout.steps.length;
      ready=true;status.hidden=true;draw();
    }catch(error){
      status.textContent='The fiber view could not load. Select Restart to retry.';
      console.error(error);
    }finally{loading=false;updateControls();schedule();}
  };
  $('training-play').onclick=()=>{playing=!playing;updateControls();schedule();};
  $('training-restart').onclick=()=>{
    if(!ready){load();return;}
    count=0;playing=true;draw();schedule();
  };
  $('training-timeline').oninput=event=>{
    if(!ready)return;
    count=Math.max(0,Math.min(rollout.steps.length,Math.floor(Number(event.target.value)||0)));
    playing=false;draw();schedule();
  };
  container.addEventListener('volume-error',event=>{
    contextLost=true;playing=false;ready=false;clearTimeout(timer);updateControls();
    $('training-volume-status').hidden=false;$('training-volume-status').textContent=event.detail;
  });
  new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    if(visible)load();
    schedule();
  },{threshold:0}).observe(container);
  document.addEventListener('visibilitychange',schedule);
  motion.addEventListener('change',()=>{
    if(motion.matches){playing=false;updateControls();schedule();}
  });
  updateControls();
}
