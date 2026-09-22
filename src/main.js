import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/manrope/latin-600.css';
import './style.css';
import {gunzipSync} from 'fflate';
import {View3D} from './scene.js';
import {project,frameAtTime,shapeFromCoefficients} from './math.js';
async function boot(){
const $=id=>document.getElementById(id),video=$('video'),canvas=$('overlay'),ctx=canvas.getContext('2d');
const dataURL=name=>new URL(`../data/${name}`,window.location.href).href;
async function fetchOK(name){const response=await fetch(dataURL(name));if(!response.ok)throw new Error(`Could not load ${name} (${response.status})`);return response;}
const manifest=await (await fetchOK('manifest.json')).json();
let trial,track,frame=0,ready=false,loadVersion=0,viewMode='face',reconstruction;
let earLines,faceLine,facePoints,rigLines=[];
try{
  reconstruction=new View3D($('scene'));
  earLines=manifest.ears.map(e=>reconstruction.line(e.color,2.5));
  faceLine=reconstruction.line('#c0cccd',1.1,.8);
  facePoints=reconstruction.points(manifest.face.colors.flat(),4.5);
  for(const cam of manifest.cameras){
    const line=reconstruction.line('#7292a1',1,.55),positions=[];
    for(let i=0;i<4;i++)positions.push(...cam.center,...cam.corners[i],...cam.corners[i],...cam.corners[(i+1)%4]);
    reconstruction.setSegments(line,positions);rigLines.push(line);reconstruction.label(cam.name,cam.center);
  }
  reconstruction.showLabels=true;
}catch(error){$('scene').innerHTML='<p class="error">3D rendering is unavailable. Enable WebGL in your browser to explore the reconstruction.</p>';console.error(error);}
function currentPoints(){return track?.subarray(frame*manifest.pointCount*3,(frame+1)*manifest.pointCount*3);}
function fitView(){if(!reconstruction||!track)return;const points=currentPoints();const extent=viewMode==='rig'?[...points,...manifest.cameras.flatMap(c=>[...c.center,...c.corners.flat()])]:points;reconstruction.fit(extent,viewMode==='rig'?[1,-.8,-1]:[0,-.2,-1],viewMode==='rig'?1.08:1.12);}
function draw(time){
  if(!ready||!track||video.readyState<2)return;
  frame=frameAtTime(time,manifest.fps,trial.frames);
  const points=currentPoints();
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  if($('overlay-toggle').checked){
    manifest.cameras.forEach((camera,index)=>{
      const x=(index%3)*480,y=Math.floor(index/3)*384,sx=480/manifest.sourceSize[0],sy=384/manifest.sourceSize[1];
      const uv=[];for(let i=0;i<manifest.pointCount;i++)uv.push(project(points.subarray(i*3,i*3+3),camera));
      ctx.save();ctx.beginPath();ctx.rect(x,y,480,384);ctx.clip();ctx.translate(x,y);
      const segment=(a,b)=>{if(!a||!b)return;ctx.moveTo(a[0]*sx,a[1]*sy);ctx.lineTo(b[0]*sx,b[1]*sy);};
      ctx.lineWidth=1.05;ctx.strokeStyle='#ffffffb3';ctx.beginPath();manifest.face.edges.forEach(([a,b])=>segment(uv[a],uv[b]));ctx.stroke();
      manifest.face.colors.forEach((color,i)=>{if(!uv[i])return;ctx.fillStyle=`rgb(${color.join(',')})`;ctx.beginPath();ctx.arc(uv[i][0]*sx,uv[i][1]*sy,1.65,0,Math.PI*2);ctx.fill();});
      for(const ear of manifest.ears){ctx.beginPath();ctx.strokeStyle=ear.color;ctx.lineWidth=2;ctx.lineJoin='round';ctx.lineCap='round';for(let i=ear.offset+1;i<ear.offset+ear.count;i++)segment(uv[i-1],uv[i]);ctx.stroke();}
      ctx.restore();
    });
  }
  if(reconstruction){
    manifest.ears.forEach((e,i)=>reconstruction.setCurve(earLines[i],points.subarray(e.offset*3,(e.offset+e.count)*3)));
    const positions=[];for(const [a,b] of manifest.face.edges){const segment=[...points.subarray(a*3,a*3+3),...points.subarray(b*3,b*3+3)];if(segment.every(Number.isFinite))positions.push(...segment);}
    reconstruction.setSegments(faceLine,positions);reconstruction.setPoints(facePoints,points.subarray(0,manifest.face.names.length*3));reconstruction.render();
  }
  $('timeline').value=frame;$('time').textContent=`${(frame/manifest.fps).toFixed(2)} s`;
  $('frame-label').textContent=`Frame ${trial.start+frame}`;
  $('timeline').setAttribute('aria-valuetext',`Frame ${trial.start+frame}, ${(frame/manifest.fps).toFixed(2)} seconds`);
  // A small observable state for reproducible browser QA; no private source data.
  document.documentElement.dataset.frame=String(trial.start+frame);
}
function pause(){video.pause();$('play').innerHTML='▶ <span>Play</span>';$('play').setAttribute('aria-label','Play trial');}
async function play(){if(!ready)return;if(video.ended||frame>=trial.frames-1)video.currentTime=0;try{await video.play();$('play').innerHTML='Ⅱ <span>Pause</span>';$('play').setAttribute('aria-label','Pause trial');}catch(e){$('trial-caption').textContent='Playback could not start. Try pressing Play again.';}}
$('play').onclick=()=>video.paused?play():pause();
$('speed').onchange=()=>video.playbackRate=Number($('speed').value);
$('timeline').addEventListener('input',()=>{pause();video.currentTime=(Number($('timeline').value)+.1)/manifest.fps;});
video.addEventListener('ended',pause);
video.addEventListener('seeked',()=>draw(video.currentTime));
video.addEventListener('error',()=>{if(trial){ready=false;$('loading').hidden=false;$('loading').textContent='Video could not load. Reload the page to retry.';$('play').disabled=true;}});
if('requestVideoFrameCallback' in video){
  const onFrame=(_now,metadata)=>{draw(metadata.mediaTime);video.requestVideoFrameCallback(onFrame);};video.requestVideoFrameCallback(onFrame);
}else{
  const tick=()=>{if(!video.paused&&!video.seeking)draw(video.currentTime);requestAnimationFrame(tick);};requestAnimationFrame(tick);
}
$('overlay-toggle').onchange=()=>draw(frame/manifest.fps);
$('frustums-toggle').onchange=()=>{rigLines.forEach(l=>l.visible=$('frustums-toggle').checked);if(reconstruction){reconstruction.showLabels=$('frustums-toggle').checked;reconstruction.render();}};
for(const mode of ['face','rig'])$('fit-'+mode).onclick=()=>{viewMode=mode;for(const m of ['face','rig']){$('fit-'+m).classList.toggle('active',m===mode);$('fit-'+m).setAttribute('aria-pressed',String(m===mode));}fitView();};
$('reset-view').onclick=fitView;
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON','TEXTAREA','A'].includes(e.target.tagName)){e.preventDefault();video.paused?play():pause();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
const trackCache=new Map();
async function getTrack(trial){
  if(!trackCache.has(trial.id))trackCache.set(trial.id,(async()=>{const compressed=new Uint8Array(await(await fetchOK(trial.track)).arrayBuffer()),bytes=compressed[0]===31&&compressed[1]===139?gunzipSync(compressed):compressed;if(bytes.byteLength!==trial.frames*manifest.pointCount*3*4)throw new Error('Invalid track length');return new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);})().catch(e=>{trackCache.delete(trial.id);throw e;}));
  return trackCache.get(trial.id);
}
async function selectTrial(selected){
  const version=++loadVersion;pause();ready=false;track=null;trial=selected;frame=0;
  $('loading').hidden=false;$('loading').textContent=`Loading ${selected.label.toLowerCase()}…`;
  $('play').disabled=true;$('timeline').disabled=true;$('timeline').max=selected.frames-1;$('timeline').value=0;
  $('time').textContent='0.00 s';$('frame-label').textContent=`Frame ${selected.start}`;$('duration').textContent=`${(selected.frames/manifest.fps).toFixed(2)} s`;
  [...$('trials').children].forEach((b,i)=>{const active=manifest.trials[i]===selected;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  try{
    // Wait for both sources. A fresh element load prevents old trial frames surviving a switch.
    const videoReady=new Promise((resolve,reject)=>{
      const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('Video failed to load'));};
      const cleanup=()=>{video.removeEventListener('loadeddata',done);video.removeEventListener('error',fail);};
      video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',fail,{once:true});
    });
    video.src=dataURL(selected.video);video.poster=dataURL(selected.poster);video.load();video.playbackRate=Number($('speed').value);
    const [data]=await Promise.all([getTrack(selected),videoReady]);
    if(version!==loadVersion)return;
    track=data;ready=true;draw(0);fitView();$('loading').hidden=true;$('play').disabled=false;$('timeline').disabled=false;
    $('trial-caption').textContent=`${selected.label} · Source frames ${selected.start.toLocaleString()}–${(selected.end-1).toLocaleString()} · ${(selected.start/manifest.fps).toFixed(2)}–${(selected.end/manifest.fps).toFixed(2)} s in the recording. Missing landmarks are omitted.`;
  }catch(e){if(version===loadVersion){$('loading').textContent='This trial could not load. Choose a trial to retry.';console.error(e);}}
}
for(const selected of manifest.trials){const b=document.createElement('button');b.innerHTML=`${selected.label}<small>${(selected.start/manifest.fps).toFixed(2)}–${(selected.end/manifest.fps).toFixed(2)} s</small>`;b.onclick=()=>selectTrial(selected);$('trials').append(b);}
selectTrial(manifest.trials[0]);

async function initShape(){
  const {models}=await(await fetchOK('shape-model.json')).json();
  const view=new View3D($('shape-scene'),{up:[0,0,1]}),meanLine=view.line('#8b969d',1.6,.65),shapeLine=view.line(manifest.ears[0].color,3.5);
  let ear='left';const values={left:new Float32Array(models.left.modes.length),right:new Float32Array(models.right.modes.length)};
  function update(){
    view.setCurve(meanLine,models[ear].mean);meanLine.visible=$('mean-toggle').checked;
    view.setCurve(shapeLine,shapeFromCoefficients(models[ear],values[ear]));shapeLine.material.color.set(manifest.ears.find(e=>e.name===ear).color);view.render();
  }
  function resetView(){view.fit(models[ear].mean,models[ear].viewDirection,1.15);}
  function buildSliders(){
    $('coefficients').replaceChildren();
    models[ear].modes.forEach((_mode,i)=>{
      const row=document.createElement('div');row.className='pc-row';
      row.innerHTML=`<label for="pc-${i}"><span>PC ${i+1}<small>${(models[ear].variance[i]*100).toFixed(1)}%</small></span><output for="pc-${i}">${values[ear][i].toFixed(2)}σ</output></label><input id="pc-${i}" aria-label="${ear} ear principal component ${i+1}" type="range" min="-3" max="3" step="0.05" value="${values[ear][i]}">`;
      row.querySelector('input').oninput=e=>{values[ear][i]=Number(e.target.value);row.querySelector('output').textContent=`${values[ear][i].toFixed(2)}σ`;update();};$('coefficients').append(row);
    });
    update();resetView();
  }
  for(const side of ['left','right'])$('ear-'+side).onclick=()=>{ear=side;for(const s of ['left','right']){$('ear-'+s).classList.toggle('active',s===side);$('ear-'+s).setAttribute('aria-pressed',String(s===side));}buildSliders();};
  $('reset-pcs').onclick=()=>{values.left.fill(0);values.right.fill(0);buildSliders();};
  $('mean-toggle').onchange=update;$('shape-view-reset').onclick=resetView;
  buildSliders();
}
initShape().catch(error=>{$('coefficients').textContent='The shape viewer could not load. Check WebGL support and reload to retry.';console.error(error);});

}
boot().catch(error=>{const el=document.getElementById("loading");el.hidden=false;el.textContent="The demo could not load. Please reload to retry.";console.error(error);});
