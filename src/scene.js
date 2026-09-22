import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

export class View3D {
  constructor(container,{up=[0,-1,0]}={}) {
    this.container=container;
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(38,1,.01,2000);
    this.camera.up.fromArray(up);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setClearColor(0,0);
    container.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=false;
    this.controls.minDistance=.1;
    this.controls.addEventListener('change',()=>this.render());
    this.materials=[];this.labels=[];
    new ResizeObserver(()=>this.resize()).observe(container);
  }
  resize(){
    const w=this.container.clientWidth,h=this.container.clientHeight;
    if(!w||!h)return;
    this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    this.materials.forEach(m=>m.resolution?.set(w,h));this.render();
  }
  line(color,width=2,opacity=1){
    const geometry=new LineSegmentsGeometry();geometry.setPositions([0,0,0,0,0,0]);
    const material=new LineMaterial({color,linewidth:width,transparent:opacity<1,opacity,depthTest:true});
    material.resolution.set(this.container.clientWidth,this.container.clientHeight);
    this.materials.push(material);
    const line=new LineSegments2(geometry,material);line.frustumCulled=false;this.scene.add(line);return line;
  }
  setSegments(line,positions){
    line.visible=positions.length>0;
    if(positions.length){
      const buffer=line.geometry.attributes.instanceStart.data;
      if(buffer.array.length===positions.length){buffer.array.set(positions);buffer.needsUpdate=true;}
      else{line.geometry.dispose();line.geometry=new LineSegmentsGeometry();line.geometry.setPositions(positions);}
    }
  }
  setCurve(line,xyz){
    const positions=[];
    for(let i=3;i<xyz.length;i+=3){
      const segment=[...xyz.slice(i-3,i),...xyz.slice(i,i+3)];
      if(segment.every(Number.isFinite))positions.push(...segment);
    }
    this.setSegments(line,positions);
  }
  points(colors,size=4){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(colors.length),3));
    const linear=[];for(let i=0;i<colors.length;i+=3){const c=new THREE.Color().setRGB(colors[i]/255,colors[i+1]/255,colors[i+2]/255,THREE.SRGBColorSpace);linear.push(c.r,c.g,c.b);}
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(linear,3));
    const points=new THREE.Points(geometry,new THREE.PointsMaterial({vertexColors:true,size,sizeAttenuation:false}));
    points.frustumCulled=false;this.scene.add(points);return points;
  }
  setPoints(points,xyz){
    const a=points.geometry.attributes.position.array;
    for(let i=0;i<xyz.length;i+=3){const ok=Number.isFinite(xyz[i]+xyz[i+1]+xyz[i+2]);for(let j=0;j<3;j++)a[i+j]=ok?xyz[i+j]:1e10;}
    points.geometry.attributes.position.needsUpdate=true;
  }
  label(text,position){const el=document.createElement('span');el.className='camera-tag';el.textContent=text;this.container.append(el);this.labels.push({el,position:new THREE.Vector3(...position)});}
  fit(xyz,direction=[.8,-.65,-1],padding=1.25){
    const box=new THREE.Box3();
    for(let i=0;i<xyz.length;i+=3)if(Number.isFinite(xyz[i]+xyz[i+1]+xyz[i+2]))box.expandByPoint(new THREE.Vector3(xyz[i],xyz[i+1],xyz[i+2]));
    if(box.isEmpty())return;
    const center=box.getCenter(new THREE.Vector3()),radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.1);
    const fov=THREE.MathUtils.degToRad(this.camera.fov),angle=Math.min(fov,2*Math.atan(Math.tan(fov/2)*this.camera.aspect));
    const distance=radius/Math.sin(angle/2)*padding;
    this.controls.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance));
    this.camera.near=Math.max(.01,distance/10000);this.camera.far=Math.max(2000,distance*10);this.camera.updateProjectionMatrix();
    this.controls.update();this.render();
  }
  render(){
    this.renderer.render(this.scene,this.camera);
    for(const {el,position} of this.labels){const p=position.clone().project(this.camera);el.hidden=!this.showLabels||Math.abs(p.z)>1||Math.abs(p.x)>1||Math.abs(p.y)>1;el.style.left=`${(p.x+1)*this.container.clientWidth/2}px`;el.style.top=`${(1-p.y)*this.container.clientHeight/2}px`;}
  }
}
