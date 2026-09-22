import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

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
    this.renderer.domElement.setAttribute('aria-label','Rotate the microscopy volume with mouse or touch');
    container.append(this.renderer.domElement);
    this.camera=new THREE.OrthographicCamera(-64,64,64,-64,.1,2000);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enablePan=false;
    this.controls.minZoom=.6;this.controls.maxZoom=5;
    this.controls.addEventListener('change',()=>this.render());
    this.controls.addEventListener('start',()=>{this.interacting=true;this.resize();});
    this.controls.addEventListener('end',()=>{this.interacting=false;this.resize();});
    this.volumeScene=new THREE.Scene();
    this.graphScene=new THREE.Scene();
    this.annotations=new THREE.Group();
    this.graphScene.add(this.annotations);
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
    this.labels=['A','B'].map(text=>{const el=document.createElement('span');el.className='volume-point-label';el.textContent=text;el.hidden=true;container.append(el);return el;});
    this.lineMaterials=[];
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();container.dispatchEvent(new CustomEvent('volume-error',{detail:'The graphics context was lost. Reload to restore the 3D view.'}));});
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
    const a=task.nodes.find(n=>n.id===task.sourceId).position,b=task.nodes.find(n=>n.id===task.targetId).position;
    this.material.uniforms.uFocus.value.fromArray(a).add(new THREE.Vector3(...b)).multiplyScalar(.5);
    this.setGraph(null);
    this.setView('oblique');
  }

  makeLine(positions,color,width=1,opacity=1,dashed=false) {
    if(!positions.length)return;
    const geometry=new LineSegmentsGeometry();geometry.setPositions(positions);
    const material=new LineMaterial({color,linewidth:width,transparent:opacity<1,opacity,depthTest:false,depthWrite:false,dashed,dashSize:2,gapSize:1.2,clippingPlanes:this.clipPlanes});
    material.resolution.set(this.container.clientWidth,this.container.clientHeight);
    this.lineMaterials.push(material);
    const object=new LineSegments2(geometry,material);object.computeLineDistances();object.frustumCulled=false;
    this.annotations.add(object);return object;
  }

  makePoints(positions,color,size) {
    if(!positions.length)return;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const material=new THREE.ShaderMaterial({
      uniforms:{color:{value:new THREE.Color(color)},size:{value:size},clipDirection:this.clipDirection,clipFocus:this.clipFocus,clipHalf:this.clipHalf},
      vertexShader:'uniform float size; varying vec3 worldPosition; void main(){worldPosition=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=size;}',
      fragmentShader:'uniform vec3 color; uniform vec3 clipDirection; uniform vec3 clipFocus; uniform float clipHalf; varying vec3 worldPosition; void main(){if(abs(dot(worldPosition-clipFocus,clipDirection))>clipHalf)discard;float r=length(gl_PointCoord-0.5);if(r>0.5)discard;gl_FragColor=vec4(mix(vec3(0.025,0.045,0.06),color,1.0-smoothstep(0.31,0.49,r)),1.0);}',
      depthTest:false,depthWrite:false,
    });
    const object=new THREE.Points(geometry,material);object.frustumCulled=false;this.annotations.add(object);return object;
  }

  setGraph(record) {
    disposeGroup(this.annotations);this.lineMaterials=[];
    if(!this.task)return;
    const t=this.task, nodes=new Map(t.nodes.map(n=>[n.id,n.position]));
    const isProposal=(a,b)=>(a===t.sourceId&&b===t.targetId)||(b===t.sourceId&&a===t.targetId);
    // The proposed join is drawn separately, including its accepted/rejected state.
    const context=t.edges.filter(([a,b])=>!isProposal(a,b)).flatMap(([a,b])=>nodes.has(a)&&nodes.has(b)?[...nodes.get(a),...nodes.get(b)]:[]);
    this.makeLine(context,'#66a3b2',1.35,.55);
    this.makePoints(t.nodes.filter(n=>n.id!==t.sourceId&&n.id!==t.targetId).flatMap(n=>n.position),'#99c9d5',5);
    if(t.history?.length>1){
      this.makeLine(t.history.slice(1).flatMap((p,i)=>[...t.history[i],...p]),'#56dbe7',2.7);
      this.makePoints(t.history.flat(),'#56dbe7',7);
    }
    const a=new THREE.Vector3(...nodes.get(t.sourceId)),b=new THREE.Vector3(...nodes.get(t.targetId));
    const color=record?.decision==='accept'?'#63edbc':record?.decision==='reject'?'#f38e8d':record?.decision==='uncertain'?'#bba7f3':'#ffc875';
    this.makeLine([...a,...b],color,record?.decision==='accept'?3.2:2.4,1,record?.decision!=='accept');
    const direction=b.clone().sub(a),length=direction.length();
    if(length>0){
      const arrow=new THREE.ArrowHelper(direction.normalize(),b.clone().addScaledVector(direction,-Math.min(4,length*.25)),Math.min(4,length*.25),color,Math.min(3,length*.22),Math.min(2,length*.15));
      arrow.line.visible=false;arrow.cone.material.depthTest=false;arrow.cone.material.clippingPlanes=this.clipPlanes;this.annotations.add(arrow);
    }
    this.makePoints([...a],'#56dbe7',15);this.makePoints([...b],color,15);
    if(record?.decision==='reject'){
      const middle=a.clone().lerp(b,.5),r=1.6;
      this.makeLine([middle.x-r,middle.y-r,middle.z,middle.x+r,middle.y+r,middle.z,middle.x-r,middle.y+r,middle.z,middle.x+r,middle.y-r,middle.z],color,2);
    }
    this.render();
  }

  setView(mode='oblique') {
    if(!this.task)return;
    const size=new THREE.Vector3(...this.task.shape),center=size.clone().addScalar(-1).multiplyScalar(.5);
    const directions={xy:[0,0,1],xz:[0,-1,0],yz:[1,0,0],oblique:[.5,-.65,1.25]};
    this.camera.up.set(0,mode==='xy'?1:0,mode==='xy'?0:1);
    this.camera.position.copy(center).add(new THREE.Vector3(...directions[mode]).normalize().multiplyScalar(size.length()*2));
    this.controls.target.copy(center);this.camera.zoom=1;
    this.camera.lookAt(center);this.controls.update();this.resize();
  }

  setContrast(value){this.material.uniforms.uContrast.value=value;this.render();}
  setDepth(value){this.material.uniforms.uDepth.value=value;this.render();}
  setAnnotations(visible){this.annotations.visible=visible;this.render();}

  setRegion(origin,size){
    if(this.region){this.graphScene.remove(this.region);this.region.geometry.dispose();this.region.material.dispose();}
    const box=new THREE.Box3(new THREE.Vector3(...origin).addScalar(-.5),new THREE.Vector3(...origin).add(new THREE.Vector3(...size)).addScalar(-.5));
    this.region=new THREE.Box3Helper(box,'#ffc875');this.region.material.depthTest=false;
    this.graphScene.add(this.region);this.render();
  }

  resize() {
    const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;
    // Cap the ray-casting buffer, independent of Retina DPR, and reduce it while
    // dragging. Static views return to full quality; nothing runs when idle.
    const ratio=Math.min(1,1000/w)*(this.interacting?.68:1);
    this.renderer.setPixelRatio(ratio);this.renderer.setSize(w,h,false);
    const extent=this.task?Math.max(...this.task.shape)*.66:64;
    this.camera.left=-extent*w/h;this.camera.right=extent*w/h;
    this.camera.top=extent;this.camera.bottom=-extent;
    this.camera.updateProjectionMatrix();
    this.lineMaterials.forEach(m=>m.resolution.set(w,h));
    this.material.uniforms.uStep.value=this.interacting?1.25:.6;
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
    this.renderer.clear();
    this.renderer.render(this.volumeScene,this.quadCamera);
    this.renderer.clearDepth();this.renderer.render(this.graphScene,this.camera);
    [this.task.sourceId,this.task.targetId].forEach((id,i)=>{
      const world=new THREE.Vector3(...this.task.nodes.find(n=>n.id===id).position),p=world.clone().project(this.camera);
      this.labels[i].hidden=!this.annotations.visible||Math.abs(p.x)>1||Math.abs(p.y)>1||Math.abs(world.sub(center).dot(direction))>half;
      this.labels[i].style.left=`${(p.x+1)*this.container.clientWidth/2+(i?12:-23)}px`;
      this.labels[i].style.top=`${(1-p.y)*this.container.clientHeight/2+(i?4:-22)}px`;
    });
  }
}
