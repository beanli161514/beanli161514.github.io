import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const photoDescriptions={
  0:'A group of double helix model bodies arranged on a plate on a desk.',
  3:'A finished double helix model with multicolored illuminated rungs, reflected in a clear cube.',
  1:'Two illuminated double helix models beside a reflective cube.',
  4:'A small double helix model held between two fingers, with cyan illuminated rungs.',
  2:'Two finished double helix models glowing green and multicolored in the dark.',
};
const photoButtons=[...document.querySelectorAll('[data-photo]')];
photoButtons.forEach((button,index)=>button.addEventListener('click',()=>{
  const id=button.dataset.photo;
  const photo=document.querySelector('#helix-photo');
  photo.src=`/helix/photo${id}.webp`;
  photo.alt=photoDescriptions[id];
  document.querySelector('#photo-link').href=photo.src;
  document.querySelector('#photo-count').textContent=`${index+1} / ${photoButtons.length}`;
  photoButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
}));

const host=document.querySelector('#helix-view');
const status=document.querySelector('#helix-status');
const partButtons=[...document.querySelectorAll('[data-part]')];
const rotateButton=document.querySelector('#helix-rotate');
const resetButton=document.querySelector('#helix-reset');

async function initializeViewer(){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0xe8edf0);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.2;
  const canvas=renderer.domElement;
  canvas.tabIndex=0;
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label','Interactive double helix body. Drag or use arrow keys to rotate; plus and minus to zoom.');
  host.prepend(canvas);
  const scene=new THREE.Scene();
  const environment=new RoomEnvironment();
  const pmrem=new THREE.PMREMGenerator(renderer);
  const envTarget=pmrem.fromScene(environment,0.04);
  scene.environment=envTarget.texture;
  environment.dispose();
  pmrem.dispose();
  const camera=new THREE.PerspectiveCamera(32,1,0.01,1000);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true;
  controls.enablePan=false;
  controls.autoRotateSpeed=0.35;
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let rotate=!reducedMotion.matches;
  let lastInteraction=0;
  let interacting=false;
  let visible=true;
  let current=null;
  let radius=1;
  let lastFrame=0;
  rotateButton.setAttribute('aria-pressed',String(rotate));
  const material=new THREE.MeshStandardMaterial({color:0x9aabb5,metalness:0.72,roughness:0.3,flatShading:true});
  const loader=new GLTFLoader();
  const models={};
  const resize=()=>{
    const {width,height}=host.getBoundingClientRect();
    if(!width||!height)return;
    renderer.setSize(width,height);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
  };
  const observer=new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function resetView(){
    // Drain the last drag's damping before applying a reproducible camera pose.
    controls.autoRotate=false;
    controls.enableDamping=false;
    controls.update(0);
    controls.enableDamping=true;
    lastInteraction=performance.now();
    const halfFov=THREE.MathUtils.degToRad(camera.fov/2);
    const limitingFov=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));
    const distance=radius/Math.sin(limitingFov)*1.1;
    camera.position.copy(new THREE.Vector3(0.65,0.28,1).normalize().multiplyScalar(distance));
    camera.near=radius/100;
    camera.far=radius*100;
    camera.updateProjectionMatrix();
    controls.target.set(0,0,0);
    controls.minDistance=radius*1.1;
    controls.maxDistance=radius*9;
    controls.update(0);
  }
  function showPart(name){
    if(current)scene.remove(current);
    current=models[name];
    scene.add(current);
    radius=new THREE.Box3().setFromObject(current).getBoundingSphere(new THREE.Sphere()).radius;
    canvas.setAttribute('aria-label',`Interactive double helix ${name}. Drag or use arrow keys to rotate; plus and minus to zoom.`);
    partButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.part===name)));
    resetView();
  }
  for(const name of ['body','cap']){
    const gltf=await loader.loadAsync(`/helix/${name}.glb`);
    const model=gltf.scene;
    model.traverse(object=>{if(object.isMesh){object.material.dispose();object.material=material;}});
    // CAD parts use Z as their vertical axis; display each original part upright.
    model.rotation.x=-Math.PI/2;
    model.updateMatrixWorld(true);
    const center=new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    models[name]=model;
  }
  showPart('body');
  status.hidden=true;
  [...partButtons,rotateButton,resetButton].forEach(button=>button.disabled=false);
  partButtons.forEach(button=>button.addEventListener('click',()=>showPart(button.dataset.part)));
  resetButton.addEventListener('click',resetView);
  rotateButton.addEventListener('click',()=>{
    rotate=!rotate;
    rotateButton.setAttribute('aria-pressed',String(rotate));
    lastInteraction=0;
  });
  reducedMotion.addEventListener('change',event=>{
    if(event.matches){rotate=false;rotateButton.setAttribute('aria-pressed','false');}
  });
  controls.addEventListener('start',()=>{interacting=true;});
  controls.addEventListener('end',()=>{interacting=false;lastInteraction=performance.now();});
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key))return;
    event.preventDefault();
    const spherical=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if(event.key==='ArrowLeft')spherical.theta-=0.12;
    if(event.key==='ArrowRight')spherical.theta+=0.12;
    if(event.key==='ArrowUp')spherical.phi-=0.12;
    if(event.key==='ArrowDown')spherical.phi+=0.12;
    if(event.key==='+'||event.key==='=')spherical.radius*=0.9;
    if(event.key==='-')spherical.radius*=1.1;
    spherical.makeSafe();
    spherical.radius=THREE.MathUtils.clamp(spherical.radius,controls.minDistance,controls.maxDistance);
    camera.position.setFromSpherical(spherical).add(controls.target);
    lastInteraction=performance.now();
    controls.autoRotate=false;
    controls.update();
  });
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;});
  intersection.observe(host);
  renderer.setAnimationLoop(now=>{
    const delta=Math.min((now-lastFrame)/1000,0.05);
    lastFrame=now;
    if(document.hidden||!visible)return;
    controls.autoRotate=rotate&&!interacting&&now-lastInteraction>4000;
    controls.update(delta);
    renderer.render(scene,camera);
  });
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();
    renderer.setAnimationLoop(null);
    status.hidden=false;
    status.textContent='3D view interrupted. Reload to restore it, or download the STL files below.';
  });
}

initializeViewer().catch(error=>{
  console.error('Double Helix viewer:',error);
  status.hidden=false;
  status.textContent='The 3D model could not load. You can still browse the photos and download the STL files below.';
});
