import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

export const CANDIDATE_COLORS=['#efbb55','#e993b8','#a1a0ee'];

// GPU ray casting of real scalar voxels. A MIP takes the brightest sample along
// each view ray; annotations are overlaid in the very same voxel coordinates.
const vertexShader = `
varying vec2 vUv;
void main() { vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }
`;
const fragmentShader = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uVolume;
uniform mat4 uInverseProjection;
uniform mat4 uCameraWorld;
uniform vec3 uSize;
uniform vec3 uFocus;
uniform float uContrast;
uniform float uDepth;
uniform float uStep;
varying vec2 vUv;
void main() {
  vec2 ndc=vUv*2.0-1.0;
  vec4 n=uInverseProjection*vec4(ndc,-1.0,1.0);
  vec4 f=uInverseProjection*vec4(ndc,1.0,1.0);
  vec3 origin=(uCameraWorld*vec4(n.xyz/n.w,1.0)).xyz;
  vec3 farPoint=(uCameraWorld*vec4(f.xyz/f.w,1.0)).xyz;
  vec3 dir=normalize(farPoint-origin);
  vec3 inv=1.0/mix(dir,vec3(0.000001),lessThan(abs(dir),vec3(0.000001)));
  vec3 ta=(vec3(-0.5)-origin)*inv;
  vec3 tb=(uSize-0.5-origin)*inv;
  vec3 lo=min(ta,tb), hi=max(ta,tb);
  float start=max(max(lo.x,lo.y),max(lo.z,0.0));
  float end=min(min(hi.x,hi.y),hi.z);
  float slabCenter=dot(uFocus-origin,dir);
  float slabHalf=length(uSize)*0.5*uDepth;
  start=max(start,slabCenter-slabHalf);
  end=min(end,slabCenter+slabHalf);
  vec3 background=vec3(0.027,0.044,0.06);
  if(end<=start) {gl_FragColor=vec4(background,1.0);return;}
  int count=int(clamp(ceil((end-start)/uStep),1.0,384.0));
  float stepSize=(end-start)/float(count);
  float peak=0.0;
  for(int i=0;i<384;i++) {
    if(i>=count) break;
    vec3 p=origin+dir*(start+(float(i)+0.5)*stepSize);
    peak=max(peak,texture(uVolume,(p+0.5)/uSize).r);
  }
  float intensity=clamp(peak*uContrast,0.0,1.0);
  intensity=pow(intensity,0.85);
  gl_FragColor=vec4(mix(background,vec3(0.93,0.96,0.97),intensity),1.0);
}
`;

function disposeGroup(group) {
  group.traverse(object=>{
    if(object.isInstancedMesh)object.dispose();
    object.geometry?.dispose();
    if(Array.isArray(object.material)) object.material.forEach(m=>m.dispose());
    else object.material?.dispose();
  });
  group.clear();
}

export class VolumeView {
  constructor(container) {
    this.container=container;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.autoClear=false;
    this.renderer.setClearColor('#071019');
    this.renderer.localClippingEnabled=true;
    this.renderer.domElement.setAttribute('aria-label',`${container.getAttribute('aria-label')||'3D volume'}; drag to rotate, scroll to zoom`);
    container.append(this.renderer.domElement);
    this.camera=new THREE.OrthographicCamera(-64,64,64,-64,.1,2000);
    this.createControls();
    this.volumeScene=new THREE.Scene();
    // Keep annotation geometry at display resolution while ray casting into a
    // smaller texture. Orbiting may reduce volume sampling, never node quality.
    this.volumeTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false});
    this.screenScene=new THREE.Scene();
    this.screenScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({
      vertexShader,fragmentShader:'uniform sampler2D image; varying vec2 vUv; void main(){gl_FragColor=texture2D(image,vUv);}',
      uniforms:{image:{value:this.volumeTarget.texture}},depthWrite:false,depthTest:false,
    })));
    this.graphScene=new THREE.Scene();
    this.graphScene.add(new THREE.HemisphereLight(0xffffff,0x516475,1.25));
    this.keyLight=new THREE.DirectionalLight(0xffffff,1.5);this.graphScene.add(this.keyLight);
    this.graphScene.add(this.keyLight.target);
    this.annotations=new THREE.Group();
    this.graphScene.add(this.annotations);
    this.traces=new THREE.Group();this.graphScene.add(this.traces);
    this.traceObjects=new Map();this.traceMaterials=[];
    this.clipDirection={value:new THREE.Vector3(0,0,-1)};
    this.clipFocus={value:new THREE.Vector3()};
    this.clipHalf={value:1000};
    this.clipPlanes=[new THREE.Plane(),new THREE.Plane()];
    this.quadCamera=new THREE.Camera();
    this.material=new THREE.ShaderMaterial({
      vertexShader,fragmentShader,depthWrite:false,depthTest:false,
      uniforms:{uVolume:{value:null},uSize:{value:new THREE.Vector3(1,1,1)},
        uFocus:{value:new THREE.Vector3()},uInverseProjection:{value:new THREE.Matrix4()},
        uCameraWorld:{value:new THREE.Matrix4()},uContrast:{value:1},uDepth:{value:1},uStep:{value:.6}},
    });
    this.volumeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));
    this.labels=[];this.labelEntries=[];this.record=null;this.highlightId=null;
    this.lineMaterials=[];
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();container.dispatchEvent(new CustomEvent('volume-error',{detail:'The graphics context was lost. Reload to restore the 3D view.'}));});
  }

  createControls(){
    this.controls?.dispose();
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.orbitUp=this.camera.up.clone();
    this.controls.enablePan=false;
    this.controls.minZoom=.6;this.controls.maxZoom=5;
    this.controls.addEventListener('change',()=>this.render());
    this.controls.addEventListener('start',()=>{
      this.interacting=true;this.autoRotation?.pause();this.resize();
    });
    this.controls.addEventListener('end',()=>{
      this.interacting=false;this.autoRotation?.resume();this.resize();
    });
  }

  enableAutoRotation(speed=.2){
    if(this.autoRotation)return;
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    let visible=false,paused=false,frame=0,lastTime=0,resumeTimer;
    const active=()=>visible&&!document.hidden&&!reducedMotion.matches&&!paused&&!this.interacting;
    const tick=now=>{
      if(!lastTime)lastTime=now;
      const seconds=(now-lastTime)/1000;
      // Slow motion needs only 30 updates per second. The existing change
      // listener renders the volume and all annotations with the same camera.
      if(seconds>=1/30){
        this.controls.autoRotateSpeed=speed;this.controls.autoRotate=true;
        this.controls.update(Math.min(seconds,.1));
        this.controls.autoRotate=false;lastTime=now;
      }
      frame=requestAnimationFrame(tick);
    };
    const refresh=()=>{
      if(active()&&!frame){
        lastTime=0;this.autoAnimating=true;this.resize();
        frame=requestAnimationFrame(tick);
      }else if(!active()&&frame){
        cancelAnimationFrame(frame);frame=0;lastTime=0;
        this.autoAnimating=false;this.resize();
      }
    };
    this.autoRotation={
      pause:()=>{clearTimeout(resumeTimer);paused=true;refresh();},
      resume:()=>{clearTimeout(resumeTimer);resumeTimer=setTimeout(()=>{paused=false;refresh();},5000);},
    };
    this.visibilityObserver=new IntersectionObserver(entries=>{
      visible=entries[0].isIntersecting;refresh();
    },{threshold:0});
    this.visibilityObserver.observe(this.container);
    document.addEventListener('visibilitychange',refresh);
    reducedMotion.addEventListener('change',refresh);
  }

  setData(task,voxels) {
    if(voxels.length!==task.shape.reduce((a,b)=>a*b,1))throw new Error('Volume length does not match its shape.');
    this.texture?.dispose();this.task=task;
    this.texture=new THREE.Data3DTexture(voxels,...task.shape);
    this.texture.format=THREE.RedFormat;this.texture.type=THREE.UnsignedByteType;
    this.texture.minFilter=THREE.LinearFilter;this.texture.magFilter=THREE.LinearFilter;
    this.texture.unpackAlignment=1;this.texture.needsUpdate=true;
    this.material.uniforms.uVolume.value=this.texture;
    this.material.uniforms.uSize.value.fromArray(task.shape);
    const source=task.nodes.find(n=>n.id===task.sourceId);
    this.material.uniforms.uFocus.value.fromArray(source.position);
    this.highlightId=null;
    this.labels.forEach(label=>label.remove());
    this.labelEntries=[{label:'A',position:source.position},...(task.candidates||[])];
    this.labels=this.labelEntries.map(entry=>{
      const el=document.createElement('span');el.className='volume-point-label';el.textContent=entry.label;el.hidden=true;this.container.append(el);return el;
    });
    this.setGraph(null);
    this.setView('oblique');
  }

  makeLine(positions,color,width=1,opacity=1,dashed=false) {
    if(!positions.length)return;
    const geometry=new LineSegmentsGeometry();geometry.setPositions(positions);
    const material=new LineMaterial({color,linewidth:width,transparent:opacity<1,opacity,depthTest:true,depthWrite:true,dashed,dashSize:.55,gapSize:.35,clippingPlanes:this.clipPlanes});
    material.resolution.set(this.container.clientWidth,this.container.clientHeight);
    this.lineMaterials.push(material);
    const object=new LineSegments2(geometry,material);object.computeLineDistances();object.frustumCulled=false;
    this.annotations.add(object);return object;
  }

  makePoints(positions,color,radius) {
    if(!positions.length)return;
    const geometry=new THREE.SphereGeometry(radius,24,16);
    const material=new THREE.MeshPhongMaterial({color,specular:0x777777,shininess:35,
      clippingPlanes:this.clipPlanes,depthTest:true,depthWrite:true});
    const object=new THREE.InstancedMesh(geometry,material,positions.length/3),matrix=new THREE.Matrix4();
    for(let i=0;i<positions.length;i+=3)object.setMatrixAt(i/3,matrix.makeTranslation(positions[i],positions[i+1],positions[i+2]));
    object.instanceMatrix.needsUpdate=true;object.frustumCulled=false;
    this.annotations.add(object);return object;
  }

  setHighlight(candidateId) {
    if(this.highlightId===candidateId)return;
    this.highlightId=candidateId;this.setGraph(this.record);
  }

  setGraph(record) {
    this.record=record;
    this.fiber=null;
    disposeGroup(this.annotations);this.lineMaterials=[];
    if(!this.task)return;
    const t=this.task,candidates=t.candidates||[];
    const nodes=new Map(t.nodes.map(n=>[n.id,n.position])),nodeInfo=new Map(t.nodes.map(n=>[n.id,n]));
    const sourceComponent=nodeInfo.get(t.sourceId).component;
    const candidateIds=new Set(candidates.filter(c=>c.nodeId!=null).map(c=>c.nodeId));
    const componentColors=new Map();
    candidates.forEach((c,i)=>{if(c.nodeId!=null)componentColors.set(nodeInfo.get(c.nodeId)?.component,CANDIDATE_COLORS[i%CANDIDATE_COLORS.length]);});
    const colorFor=component=>component===sourceComponent?'#29c4df':componentColors.get(component)||'#92a7c3';
    for(const component of new Set(t.nodes.map(n=>n.component))){
      const context=t.edges.filter(([a])=>nodeInfo.get(a)?.component===component)
        .flatMap(([a,b])=>nodes.has(a)&&nodes.has(b)?[...nodes.get(a),...nodes.get(b)]:[]);
      this.makeLine(context,colorFor(component),1.8);
      this.makePoints(t.nodes.filter(n=>n.component===component&&n.id!==t.sourceId&&!candidateIds.has(n.id)).flatMap(n=>n.position),colorFor(component),.36);
    }
    const a=new THREE.Vector3(...nodes.get(t.sourceId));
    const terminal=record?.decision==='none';
    const chosen=record?.decision==='accept'?candidates[0]?.id:record?.decision==='select'?record.selectedCandidateId:null;
    candidates.forEach((candidate,i)=>{
      const b=new THREE.Vector3(...candidate.position),active=this.highlightId===candidate.id;
      const selected=chosen===candidate.id,muted=terminal||Boolean(chosen&&!selected);
      const candidateColor=CANDIDATE_COLORS[i%CANDIDATE_COLORS.length];
      const color=selected?'#50e7a1':record?.decision==='reject'?'#f48f96':record?.decision==='uncertain'?'#c0a3f6':active?'#ffffff':candidates.length===1?'#f4f6fa':candidateColor;
      if(!terminal){
        this.makeLine([...a,...b],muted?'#536779':color,selected||active?2.5:1.8,1,!selected);
        if(!muted){
          const direction=b.clone().sub(a),length=direction.length();
          if(length>0){
            direction.normalize();
            const tip=b.clone().addScaledVector(direction,-.65),head=Math.min(.7,length*.2);
            const arrow=new THREE.ArrowHelper(direction,tip.clone().addScaledVector(direction,-head),head,color,head,head*.7);
            arrow.line.visible=false;arrow.cone.material.clippingPlanes=this.clipPlanes;this.annotations.add(arrow);
          }
        }
      }
      this.makePoints([...b],muted?'#657482':candidateColor,(active||selected) ? .64 : .53);
      const label=this.labels[i+1];
      label.style.borderColor=selected?'#50e7a1':candidateColor;
      label.style.opacity=muted?'.55':'1';
      label.textContent=candidate.label;
    });
    this.makePoints([...a],terminal?'#50e7a1':'#29c4df',terminal ? .64 : .53);
    this.labels[0].textContent=terminal?'A · true ending':'A';
    this.labels[0].classList.toggle('terminal',terminal);
    this.render();
  }

  /** Keep one GPU copy of a measured fiber; reveal only its ordered prefix. */
  setFiberPath(pathXYZ) {
    if(!Array.isArray(pathXYZ)||pathXYZ.length<2||pathXYZ.some(p=>p.length!==3||!p.every(Number.isFinite)))throw new Error('A fiber needs at least two finite XYZ positions.');
    disposeGroup(this.annotations);this.lineMaterials=[];
    this.labels.forEach(label=>label.remove());this.labels=[];this.labelEntries=[];
    this.annotations.visible=true;
    const positions=pathXYZ.map(p=>[...p]);
    const points=this.makePoints(positions.flat(),'#38cddd',.64);
    const lines=this.makeLine(positions.slice(1).flatMap((p,i)=>[...positions[i],...p]),'#38cddd',2);
    const tip=this.makePoints([0,0,0],'#ffcd62',.9);
    this.fiber={positions,points,lines,tip};
    this.setFiberProgress(1);
  }

  setFiberProgress(count) {
    if(!this.fiber)return;
    const {positions,points,lines,tip}=this.fiber;
    const visible=Math.max(0,Math.min(positions.length,Math.floor(Number(count)||0)));
    points.count=visible;
    lines.geometry.instanceCount=Math.max(0,visible-1);
    tip.count=visible?1:0;
    if(visible){
      tip.setMatrixAt(0,new THREE.Matrix4().makeTranslation(...positions[visible-1]));
      tip.instanceMatrix.needsUpdate=true;
    }
    this.render();
  }

  setView(mode='oblique') {
    if(!this.task)return;
    this.autoRotation?.pause();
    const size=new THREE.Vector3(...this.task.shape),center=size.clone().addScalar(-1).multiplyScalar(.5);
    const directions={xy:[0,0,1],xz:[0,-1,0],yz:[1,0,0],oblique:[.5,-.65,1.25]};
    this.camera.up.set(0,mode==='xy'?1:0,mode==='xy'?0:1);
    this.camera.position.copy(center).add(new THREE.Vector3(...directions[mode]).normalize().multiplyScalar(size.length()*2));
    // OrbitControls captures camera.up at construction, so rebuild its orbit
    // frame when switching between Y-up (XY) and Z-up views.
    if(!this.orbitUp.equals(this.camera.up))this.createControls();
    this.controls.target.copy(center);this.camera.zoom=1;
    this.camera.lookAt(center);this.controls.update(0);this.resize();
    this.autoRotation?.resume();
  }

  setContrast(value){this.material.uniforms.uContrast.value=value;this.render();}
  setDepth(value){this.material.uniforms.uDepth.value=value;this.render();}
  setAnnotations(visible){this.annotations.visible=visible;this.render();}

  setTraces(traces){
    disposeGroup(this.traces);this.traceObjects.clear();this.traceMaterials=[];
    for(const trace of traces){
      if(!trace.segments.length)continue;
      const geometry=new LineSegmentsGeometry();geometry.setPositions(trace.segments);
      const material=new LineMaterial({color:trace.color,linewidth:1.7,depthTest:true,depthWrite:true,clippingPlanes:this.clipPlanes});
      material.resolution.set(this.container.clientWidth,this.container.clientHeight);
      const object=new LineSegments2(geometry,material);object.frustumCulled=false;
      this.traces.add(object);this.traceObjects.set(trace.id,object);this.traceMaterials.push(material);
    }
    this.render();
  }

  showTraces(visible,selected='all'){
    this.traces.visible=visible;
    for(const [id,object] of this.traceObjects)object.visible=selected==='all'||id===selected;
    this.render();
  }

  setRegion(origin,size){
    if(this.region){this.graphScene.remove(this.region);this.region.geometry.dispose();this.region.material.dispose();}
    const box=new THREE.BoxGeometry(...size),edges=new THREE.EdgesGeometry(box);
    const geometry=new LineSegmentsGeometry();geometry.setPositions(edges.attributes.position.array);
    box.dispose();edges.dispose();
    const material=new LineMaterial({color:'#ffcb50',linewidth:1.6,depthTest:false,depthWrite:false});
    material.resolution.set(this.container.clientWidth,this.container.clientHeight);
    this.region=new LineSegments2(geometry,material);this.region.frustumCulled=false;this.region.renderOrder=10;
    this.region.position.fromArray(origin).add(new THREE.Vector3(...size).multiplyScalar(.5)).addScalar(-.5);
    this.graphScene.add(this.region);this.render();
  }

  setScaleBar(lengthVoxels,label){
    if(!this.scaleBar){
      const element=document.createElement('div'),line=document.createElement('i'),caption=document.createElement('span');
      element.className='volume-scale-bar';element.append(line,caption);this.container.append(element);
      this.scaleBar={element,line,caption};
    }
    this.scaleBar.length=lengthVoxels;this.scaleBar.label=label;this.scaleBar.caption.textContent=label;this.render();
  }

  resize() {
    const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;
    const moving=this.interacting||this.autoAnimating;
    const volumeRatio=Math.min(1,1000/w)*(moving?.75:1);
    this.volumeTarget.setSize(Math.max(1,Math.round(w*volumeRatio)),Math.max(1,Math.round(h*volumeRatio)));
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setSize(w,h,false);
    const extent=this.task?Math.max(...this.task.shape)*.66:64;
    this.camera.left=-extent*w/h;this.camera.right=extent*w/h;
    this.camera.top=extent;this.camera.bottom=-extent;
    this.camera.updateProjectionMatrix();
    this.lineMaterials.forEach(m=>m.resolution.set(w,h));
    this.traceMaterials.forEach(m=>m.resolution.set(w,h));
    this.region?.material.resolution.set(w,h);
    this.material.uniforms.uStep.value=moving?.7:.35;
    this.render();
  }

  render() {
    if(!this.task)return;
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this.clipDirection.value);
    this.clipFocus.value.copy(this.material.uniforms.uFocus.value);
    this.clipHalf.value=this.material.uniforms.uSize.value.length()*.5*this.material.uniforms.uDepth.value;
    const direction=this.clipDirection.value,center=this.clipFocus.value,half=this.clipHalf.value;
    this.clipPlanes[0].set(direction,-direction.dot(center)+half);
    this.clipPlanes[1].set(direction.clone().negate(),direction.dot(center)+half);
    this.material.uniforms.uInverseProjection.value.copy(this.camera.projectionMatrixInverse);
    this.material.uniforms.uCameraWorld.value.copy(this.camera.matrixWorld);
    this.keyLight.position.copy(this.camera.position).add(new THREE.Vector3(-20,30,10));
    this.keyLight.target.position.copy(this.controls.target);
    this.renderer.setRenderTarget(this.volumeTarget);
    this.renderer.clear();
    this.renderer.render(this.volumeScene,this.quadCamera);
    this.renderer.setRenderTarget(null);this.renderer.clear();
    this.renderer.render(this.screenScene,this.quadCamera);
    this.renderer.clearDepth();this.renderer.render(this.graphScene,this.camera);
    if(this.scaleBar){
      // An orthographic camera has the same physical scale at every depth.
      const pixels=this.scaleBar.length*this.camera.zoom*this.container.clientWidth/(this.camera.right-this.camera.left);
      const fraction=[1,.5,.2,.1].find(f=>pixels*f<=this.container.clientWidth*.3)||.1;
      this.scaleBar.line.style.width=`${pixels*fraction}px`;
      this.scaleBar.caption.textContent=this.scaleBar.label.replace(/^\d+(\.\d+)?/,n=>String(Number(n)*fraction));
    }
    const placed=[];
    this.labelEntries.forEach((entry,i)=>{
      const world=new THREE.Vector3(...entry.position),p=world.clone().project(this.camera),label=this.labels[i];
      label.hidden=!this.annotations.visible||Math.abs(p.x)>1||Math.abs(p.y)>1||Math.abs(world.sub(center).dot(direction))>half;
      if(label.hidden)return;
      const left=Math.max(2,Math.min(this.container.clientWidth-label.offsetWidth-2,(p.x+1)*this.container.clientWidth/2+(i?12:-23)));
      let top=(1-p.y)*this.container.clientHeight/2+(i?4:-22);
      for(const box of placed)if(Math.abs(left-box.left)<Math.max(label.offsetWidth,box.width)+4&&Math.abs(top-box.top)<24)top=box.top+24;
      top=Math.max(2,Math.min(this.container.clientHeight-24,top));
      label.style.left=`${left}px`;label.style.top=`${top}px`;
      placed.push({left,top,width:label.offsetWidth});
    });
  }
}
