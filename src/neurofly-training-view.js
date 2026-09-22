import {gunzipSync} from 'fflate';
import {VolumeView} from './neurofly-volume.js';

const $=id=>document.getElementById(id);
/** Highlight the model action corresponding to the selected local task. */
export function highlightTrainingTask(task){
  for(const row of document.querySelectorAll('[data-head]')){
    const active=row.dataset.head===task.taskType;
    row.classList.toggle('active',active);
    if(active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
  }
}

/** Replay measured annotation nodes in a real, freely rotatable image volume. */
export function initTrainingRollout(){
  const container=$('training-volume');
  if(!container)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let visible=false,playing=!motion.matches,ready=false,loading=false,contextLost=false,view,spec,count=1,timer;
  const schedule=()=>{
    clearTimeout(timer);
    if(!ready||!playing||!visible||document.hidden||view.interacting)return;
    timer=setTimeout(()=>{
      count=count===spec.pathXYZ.length?1:count+1;
      draw();schedule();
    },count===spec.pathXYZ.length?1800:350);
  };
  const updateControls=()=>{
    $('training-play').disabled=!ready;
    $('training-play').textContent=playing?'Pause':'Play';
    $('training-play').setAttribute('aria-label',playing?'Pause fiber reveal':'Play fiber reveal');
    $('training-timeline').disabled=!ready;
    $('training-restart').disabled=loading||contextLost;
  };
  const draw=()=>{
    view.setFiberProgress(count);
    $('training-timeline').value=count;
    $('training-timeline').setAttribute('aria-valuetext',`${count} of ${spec.pathXYZ.length} annotation steps`);
    $('training-step').textContent=`${count} / ${spec.pathXYZ.length} steps`;
    container.dataset.visibleNodes=count;
    updateControls();
  };
  const load=async()=>{
    if(ready||loading||contextLost)return;
    loading=true;updateControls();
    const status=$('training-volume-status');status.hidden=false;status.textContent='Loading microscopy and annotated fiber…';
    try{
      const dataRoot=new URL('./data/',window.location.href);
      const response=await fetch(new URL('tracing.json',dataRoot));
      if(!response.ok)throw new Error('Fiber metadata unavailable');
      spec=await response.json();
      const payload=await fetch(new URL(spec.volume,dataRoot));
      if(!payload.ok)throw new Error('Fiber volume unavailable');
      const bytes=new Uint8Array(await payload.arrayBuffer());
      const voxels=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes;
      view??=new VolumeView(container);
      // The renderer's clipping focus is the crop center, not a boundary node.
      const center=spec.shape.map(n=>(n-1)/2);
      view.setData({...spec,nodes:[{id:'center',position:center}],edges:[],sourceId:'center',candidates:[]},voxels);
      view.setFiberPath(spec.pathXYZ);
      view.setScaleBar(20/spec.voxelSizeUM[0],'20 µm');
      view.setContrast(.85);
      view.setView(spec.preferredView||'oblique');
      view.controls.addEventListener('start',schedule);
      view.controls.addEventListener('end',schedule);
      $('training-timeline').max=spec.pathXYZ.length;
      ready=true;status.hidden=true;draw();
    }catch(error){
      status.textContent='The fiber view could not load. Select Restart to retry.';
      console.error(error);
    }finally{loading=false;updateControls();schedule();}
  };
  $('training-play').onclick=()=>{playing=!playing;updateControls();schedule();};
  $('training-restart').onclick=()=>{
    if(!ready){load();return;}
    count=1;playing=true;draw();schedule();
  };
  $('training-timeline').oninput=event=>{
    if(!ready)return;
    count=Math.max(1,Math.min(spec.pathXYZ.length,Number(event.target.value)));
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
