import {makeTrainingExample} from './neurofly-training.js';

const $=id=>document.getElementById(id);
const names={
  'fragment-connection':'Fragment connection',
  'endpoint-selection':'Endpoint selection',
  'point-proposal':'Point proposal',
};

/** Show the input/label pair from the same pre-review state as the local task. */
export function renderTrainingExample(task,record){
  const sample=makeTrainingExample(task,record);
  $('training-task').textContent=names[task.taskType];
  const candidateKind=(task.taskType==='point-proposal'?'proposed point':'fragment endpoint')+(task.candidates.length===1?'':'s');
  $('training-input-summary').textContent=`${task.shape.join(' × ')} voxels · ${task.history.length} trajectory points · ${task.candidates.length} ${candidateKind}`;
  $('training-example').dataset.state=sample.status;
  $('training-example').dataset.action=sample.target?.kind||'';
  for(const row of document.querySelectorAll('[data-head]')){
    const active=row.dataset.head===task.taskType;
    row.classList.toggle('active',active);
    if(active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
  }
  if(!sample.target){
    const deferred=sample.status==='deferred';
    $('training-target').textContent=deferred?'No target label':'Choose a local decision';
    $('training-target-detail').textContent=deferred
      ?'Uncertain cases return for review; they do not supervise a stop or rejection.'
      :'Review the task above to form an observation–action training pair.';
    $('training-status').textContent=deferred?'Deferred · excluded from supervision':'Awaiting review';
    return;
  }
  const candidate=task.candidates.find(c=>c.id===sample.target.candidateId);
  const target={
    connect:[`Connect A → ${candidate?.label}`,task.taskType==='fragment-connection'
      ?'Action target: Accept. Join these two fragments.'
      :`Selection target: endpoint ${candidate?.label}. Join the selected fragment.`],
    'reject-edge':[`Reject A → ${candidate?.label}`,'Action target: Reject. Keep the fragments separate; this does not label A as a true ending.'],
    extend:[`Extend A → ${candidate?.label}`,`Selection target: point ${candidate?.label}. Add this point to the trajectory.`],
    stop:['Stop at A','Selection target: None. Label A as a true ending.'],
  }[sample.target.kind];
  $('training-target').textContent=target[0];
  $('training-target-detail').textContent=target[1];
  $('training-status').textContent='Example label · requires curation';
}

/** Load the recording on demand; keep native playback and scrubbing controls. */
export function initTrainingRollout(){
  const video=$('training-rollout');
  if(!video)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let visible=false,resumeWhenVisible=!motion.matches;
  const sync=()=>{
    if(visible&&!document.hidden){
      if(resumeWhenVisible&&!motion.matches)video.play().catch(()=>{/* Native Play remains available if autoplay is blocked. */});
    }else if(!video.paused){
      resumeWhenVisible=true;
      video.pause();
    }
  };
  video.addEventListener('play',()=>{
    resumeWhenVisible=true;
    if(!visible||document.hidden)video.pause();
  });
  video.addEventListener('pause',()=>{
    // A pause while visible is the reader's choice; scrolling must not undo it.
    if(visible&&!document.hidden)resumeWhenVisible=false;
  });
  new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    sync();
  },{threshold:0}).observe(video);
  document.addEventListener('visibilitychange',sync);
  motion.addEventListener('change',()=>{
    if(motion.matches){resumeWhenVisible=false;video.pause();}
  });
}
