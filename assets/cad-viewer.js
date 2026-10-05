import * as THREE from '../vendor/three-r180/three.module.min.js';
import {OrbitControls} from '../vendor/three-r180/OrbitControls.js';
import {createAssembly} from './cad-model.js';

export async function initCad() {
  const q=id=>document.getElementById(id),view=q('cadView'),canvas=q('cadCanvas'),root=q('cad');
  let renderer,software=false,context;
  // WebGL failure is distinct from a module/network failure. Software uses the same scene.
  try { context=canvas.getContext('webgl2',{antialias:true}); } catch(_) {}
  if(context) {
    try {renderer=new THREE.WebGLRenderer({canvas,context,antialias:true});} catch(_) {}
  }
  if(!renderer) {
    software=true;
    const {SVGRenderer}=await import('../vendor/three-r180/SVGRenderer.js');
    renderer=new SVGRenderer();renderer.setQuality('high');renderer.setPrecision(2);
    renderer.domElement.id='cadSoftwareCanvas';renderer.domElement.setAttribute('role','img');
    renderer.domElement.setAttribute('aria-label','같은 3D 형상과 좌표를 사용하는 소프트웨어 CAD 보기. 드래그로 회전, 휠이나 핀치로 확대.');
    canvas.style.display='none';view.prepend(renderer.domElement);
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
  }
  const surface=renderer.domElement;
  const model=createAssembly(THREE,{software});
  const camera=new THREE.PerspectiveCamera(34,1,.01,30);camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,surface);controls.enableDamping=true;controls.dampingFactor=.09;
  controls.minDistance=.55;controls.maxDistance=15;controls.maxPolarAngle=Math.PI*.92;
  const state={mode:'exterior',playing:!matchMedia('(prefers-reduced-motion: reduce)').matches,selected:9,speed:.75,variation:.48,explode:.7,time:0};
  const modeNames={exterior:'외관',internal:'내부',section:'단면',exploded:'한 층 분해',operation:'힘 전달'};
  const svgNS='http://www.w3.org/2000/svg';
  const overlay=document.createElementNS(svgNS,'svg');overlay.id='cadOverlay';overlay.setAttribute('aria-hidden','true');view.append(overlay);
  const labels=document.createElement('div');labels.id='cadLabels';labels.setAttribute('aria-hidden','true');view.append(labels);
  const help=document.createElement('div');help.id='cadRenderInfo';help.textContent=software?'소프트웨어 3D 보기':'WebGL 3D 보기';view.append(help);
  let width=1,height=1,dirty=true,frameId=0,lastRender=0;
  const project=v=>{const p=v.clone().project(camera);return {x:(p.x+1)*width/2,y:(1-p.y)*height/2,visible:p.z>=-1&&p.z<=1};};
  const world=(object,offset=new THREE.Vector3())=>object.localToWorld(offset.clone());
  function fitCamera() {
    const z=model.layerObjs[state.selected].z,aspect=width/height;
    if(state.mode==='section'||state.mode==='exploded') {
      const distance=aspect<.85?1.48:1.15;
      controls.target.set(0,0,z+(state.mode==='exploded'?.04:0));
      camera.position.copy(controls.target).add(new THREE.Vector3(.30,-1,.38).normalize().multiplyScalar(distance));
    } else if(state.mode==='operation') {
      const mid=(.18+z)/2,span=Math.max(1.1,z-.18);
      const distance=Math.max(3.2,span*2.35,2.0/aspect);
      controls.target.set(.13,0,mid);camera.position.copy(controls.target).add(new THREE.Vector3(1.5,-4,1.4).normalize().multiplyScalar(distance));
    } else {
      const distance=Math.max(8.4,6.0/aspect);
      controls.target.set(0,0,2.22);camera.position.copy(controls.target).add(new THREE.Vector3(4,-7,3).normalize().multiplyScalar(distance));
    }
    controls.update();dirty=true;
  }
  function updateReadout() {
    const factor=model.layerObjs[state.selected].factor;
    q('cadLayerReadout').textContent=(state.selected+1)+'층';q('cadLayerSpeed').textContent=factor.toFixed(2)+'×';
    q('cadLayerCoupling').textContent=factor<.48?'약한 결합':factor<.72?'중간 결합':'강한 결합';
    q('cadSpeedReadout').textContent=state.speed<.5?'아주 느리게':state.speed<.72?'느리게':state.speed<1?'보통':'빠르게';
    q('cadVariationReadout').textContent=state.variation<.3?'작게':state.variation<.6?'중간':'크게';
    q('cadExplodeReadout').textContent=Math.round(state.explode*100)+'%';
    const note=state.mode==='operation'?'황색 선과 점은 회전력 전달 설명용 · 전기 흐름 아님':state.mode==='exploded'?'선택한 한 층 주변만 확대 · 부품은 Z축 방향으로만 분리':state.mode==='section'?'앞 절반을 연 중앙 허브 · 내륜–볼–외륜은 같은 Z축':state.mode==='internal'?'구동부는 베이스 내부 · 선택 층은 공통축에서 직접 힘을 받음':'모든 레이어의 중심은 고정 · 같은 방향으로 Z축 회전';
    q('cadStatus').innerHTML='<b>'+modeNames[state.mode]+' · '+(state.selected+1)+'층</b><br>'+note+'<br><span class="cad-gesture">드래그: 회전 · 휠/핀치: 확대</span>';
    q('cadModeBadge').textContent=modeNames[state.mode]+' 보기';
    q('cadAxisHint').textContent='Z = 수직 중앙축 · 레이어 = XY 평면';
    q('cadOperationSteps').hidden=state.mode!=='operation';
  }
  function applyFactors() {
    for(const l of model.layerObjs)l.factor=Math.max(.20,Math.min(.97,.66+(l.baseFactor-.66)*state.variation/.48));
    updateReadout();dirty=true;
  }
  function setMode(mode) {
    state.mode=mode;model.setMode(state.selected,mode,state.explode);
    root.querySelectorAll('[data-cad-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cadMode===mode)));
    q('cadExplodeField').hidden=mode!=='exploded';q('cadExplode').disabled=mode!=='exploded';
    q('cadPlay').textContent=state.playing?'일시정지':'재생';updateReadout();fitCamera();
  }
  function selectLayer(i) {
    state.selected=Math.max(0,Math.min(19,i));q('cadLayer').value=String(state.selected);
    setMode(state.mode);
  }
  function makeSvg(tag,attrs) {const e=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
  function renderOverlay() {
    overlay.replaceChildren();labels.replaceChildren();
    model.root.updateMatrixWorld(true);camera.updateMatrixWorld();
    const close=state.mode==='section'||state.mode==='exploded',operation=state.mode==='operation';
    // A camera-relative coordinate triad is an explanatory overlay, never an extra physical shaft.
    const origin={x:width-50,y:height-78};
    const matrix=new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse);
    for(const [name,axis,color] of [['X',new THREE.Vector3(1,0,0),'#9a5143'],['Y',new THREE.Vector3(0,1,0),'#648659'],['Z',new THREE.Vector3(0,0,1),'#477989']]) {
      const d=axis.applyMatrix3(matrix).multiplyScalar(30),x=origin.x+d.x,y=origin.y-d.y;
      overlay.append(makeSvg('line',{x1:origin.x,y1:origin.y,x2:x,y2:y,stroke:color,'stroke-width':2}));
      const t=makeSvg('text',{x:x+4,y:y+4,fill:color,'font-size':13,'font-weight':700});t.textContent=name;overlay.append(t);
    }
    const entries=close?[
      ['retainer',model.retainer,'리테이너 / 조정 칼라'],
      ['hub',model.hub,'회전 허브'],['bearing',model.bearing,'베어링: 내륜 · 볼 · 외륜'],
      ['friction',model.friction,'마찰 링'],['spring',model.spring,'디스크 스프링'],['collar',model.collar,'축 칼라']
    ]:state.mode==='internal'||operation?[
      ['motor',model.motor,'BLDC 1개'],['driver',model.driver,'FOC / 드라이버'],
      ['belt',model.shaftPulley,'타이밍 벨트 · 필요 시'],['coupling',model.friction,(state.selected+1)+'층 마찰 coupling']
    ]:[];
    let anchorEntries=entries.map(([id,obj,text])=>({id,text,p:project(world(obj,new THREE.Vector3(close?.16:0,0,0)))})).filter(e=>e.p.visible);
    anchorEntries.sort((a,b)=>a.p.y-b.p.y);
    const minY=operation?160:76,maxY=height-130,gap=close?28:25;
    let prev=minY-gap;
    anchorEntries.forEach((e,i)=>{e.y=Math.max(minY,e.p.y,prev+gap);prev=e.y;});
    const overflow=Math.max(0,prev-maxY);anchorEntries.forEach(e=>e.y-=overflow);
    for(const e of anchorEntries) {
      const x=close?Math.min(width-150,width*.69):18;
      const label=document.createElement('span');label.className='cad-part-label';label.textContent=e.text;
      label.style.left=x+'px';label.style.top=(e.y-10)+'px';labels.append(label);
      overlay.append(makeSvg('line',{x1:e.p.x,y1:e.p.y,x2:close?x-5:x+125,y2:e.y,stroke:'#7b8e84','stroke-width':1}));
      overlay.append(makeSvg('circle',{cx:e.p.x,cy:e.p.y,r:2.5,fill:'#61766b'}));
    }
    if(close) {
      const p=project(new THREE.Vector3(0,0,model.stack.position.z+.30));
      const t=makeSvg('text',{x:p.x+9,y:p.y,fill:'#477989','font-size':13,'font-weight':700});t.textContent='공통 Z축';overlay.append(t);
    }
    if(!operation) {model.friction.material.emissive.setHex(0);model.hub.children.forEach(m=>{if(m.material.emissive)m.material.emissive.setHex(0);});return;}
    const pts=model.torquePoints(state.selected),lens=[],cum=[0];let total=0;
    for(let i=0;i<pts.length-1;i++){const len=pts[i].distanceTo(pts[i+1]);lens.push(len);total+=len;cum.push(total);}
    const d=pts.map(p=>project(p));
    const path=d.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
    overlay.append(makeSvg('path',{d:path,fill:'none',stroke:'#ac6600','stroke-width':7,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.8}));
    overlay.append(makeSvg('path',{d:path,fill:'none',stroke:'#ffd12f','stroke-width':4.5,'stroke-linecap':'round','stroke-linejoin':'round'}));
    const u=(state.time/9)%1;
    function point(v) {const dist=v*total;let j=0;while(j<lens.length-1&&dist>cum[j+1])j++;return project(pts[j].clone().lerp(pts[j+1],(dist-cum[j])/lens[j]));}
    for(let i=7;i>=0;i--){const v=u-i*.019;if(v<0)continue;const p=point(v);if(i===0)overlay.append(makeSvg('circle',{cx:p.x,cy:p.y,r:15,fill:'#ffc12a',opacity:.24}));overlay.append(makeSvg('circle',{cx:p.x,cy:p.y,r:i===0?9:6-i*.35,fill:i===0?'#fff5a0':'#ffc72b',stroke:i===0?'#bb7600':'none','stroke-width':2,opacity:1-i*.08}));}
    const couplingU=cum[5]/total,highlight=Math.max(0,1-Math.abs(u-couplingU)/.065);
    model.friction.material.emissive.setHex(highlight>0?0xb67813:0);
    model.hub.children.forEach(m=>{if(m.material.emissive)m.material.emissive.setHex(highlight>0?0x8a5712:0);});
    const ringPos=project(world(model.friction));
    if(highlight>0) overlay.append(makeSvg('circle',{cx:ringPos.x,cy:ringPos.y,r:22+8*(1-highlight),fill:'none',stroke:'#ffb30a','stroke-width':4,opacity:highlight}));
  }
  root.querySelectorAll('[data-cad-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.cadMode)));
  q('cadPlay').addEventListener('click',()=>{state.playing=!state.playing;q('cadPlay').textContent=state.playing?'일시정지':'재생';dirty=true;});
  q('cadResetCamera').addEventListener('click',fitCamera);
  q('cadLayer').innerHTML=model.layerObjs.map((_,i)=>'<option value="'+i+'">'+(i+1)+'층</option>').join('');
  q('cadLayer').value='9';q('cadLayer').addEventListener('change',e=>selectLayer(Number(e.target.value)));
  q('cadSpeed').addEventListener('input',e=>{state.speed=Number(e.target.value)/100;updateReadout();});
  q('cadVariation').addEventListener('input',e=>{state.variation=Number(e.target.value)/100;applyFactors();});
  q('cadExplode').addEventListener('input',e=>{state.explode=Number(e.target.value)/100;model.updateStack(state.selected,state.mode,state.explode);updateReadout();dirty=true;});
  controls.addEventListener('change',()=>dirty=true);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
  surface.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
  surface.addEventListener('pointerup',e=>{
    if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6){down=null;return;}
    const r=surface.getBoundingClientRect();pointer.set(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height);
    raycaster.setFromCamera(pointer,camera);
    const hits=raycaster.intersectObjects(model.layerObjs.filter(l=>l.group.visible).flatMap(l=>[...l.tubes,l.hub]),false);
    if(hits.length)selectLayer(hits[0].object.userData.layerIndex);down=null;
  });
  function resize() {const r=view.getBoundingClientRect();width=r.width;height=r.height;if(!width||!height)return;renderer.setSize(width,height,false);overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);camera.aspect=width/height;camera.updateProjectionMatrix();fitCamera();}
  const observer=new ResizeObserver(resize);observer.observe(view);
  resize();applyFactors();setMode('exterior');
  function draw() {renderOverlay();renderer.render(model.scene,camera);root.dataset.renderer=software?'software':'webgl';root.dataset.mode=state.mode;root.dataset.ready='1';dirty=false;}
  draw();
  let last=performance.now();
  function frame(now) {
    const dt=Math.min(.15,(now-last)/1000);last=now;
    if(state.playing&&!document.hidden){model.step(state.selected,state.speed*.42*dt,state.mode);state.time+=dt;dirty=true;}
    controls.update();
    if(dirty&&(!software||now-lastRender>90)){try{draw();lastRender=now;}catch(err){cancelAnimationFrame(frameId);window.dispatchEvent(new CustomEvent('cadFailure',{detail:'3D 표시 중 오류가 발생했습니다.'}));return;}}
    frameId=requestAnimationFrame(frame);
  }
  frameId=requestAnimationFrame(frame);
  if(!software)surface.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(frameId);window.dispatchEvent(new CustomEvent('cadFailure',{detail:'3D 그래픽 연결이 중단되었습니다.'}));});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(frameId);controls.dispose();observer.disconnect();});
}
