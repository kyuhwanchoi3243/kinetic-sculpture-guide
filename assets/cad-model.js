// Display proportions only. No fabrication dimensions or torque prediction.
export function createAssembly(THREE, {software = false} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f1ec);
  scene.add(new THREE.AmbientLight(0xffffff, software ? .65 : 1.25));
  const key = new THREE.DirectionalLight(0xffffff, software ? .65 : 2.2);
  key.position.set(3, -5, 7); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdde6ea, software ? .2 : .75);
  fill.position.set(-4, 2, 4); scene.add(fill);
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness:.48, metalness:.48, ...extra});
  const mats = {
    shaft:material(0x687873), layer:material(0x4c5550), hub:material(0xab725a),
    race:material(0x7ba49c), ball:material(0xc3d5cc), collar:material(0x63746e),
    spring:material(0xb39a61), friction:material(0xbd7545,{roughness:.9,metalness:.05}),
    retainer:material(0x87928b), motor:material(0x4d6c68), pulley:material(0xb69758),
    belt:material(0x292e2b,{metalness:0}), cover:material(0x3e4741), driver:material(0x467768)
  };
  const root = new THREE.Group(); root.name='assembly-Z'; scene.add(root);
  const baseGroup=new THREE.Group(), drive=new THREE.Group(), layersGroup=new THREE.Group(), stack=new THREE.Group();
  root.add(baseGroup,drive,layersGroup,stack);
  stack.name='selected-layer-stack'; stack.scale.setScalar(.6);
  // Native CylinderGeometry is Y aligned. Bake Y -> +Z once, never tilt an object.
  function cylinder(r,h,segments=36) {
    const g=new THREE.CylinderGeometry(r,r,h,segments);
    g.rotateX(Math.PI/2); return g;
  }
  // Native LatheGeometry is Y aligned. A closed profile becomes an annulus on Z.
  function ringGeometry(ri,ro,h,cone=0,half=false) {
    const profile=[new THREE.Vector2(ri,-h/2),new THREE.Vector2(ro,-h/2+cone),new THREE.Vector2(ro,h/2+cone),new THREE.Vector2(ri,h/2),new THREE.Vector2(ri,-h/2)];
    const g=new THREE.LatheGeometry(profile,software?24:48,0,half?Math.PI:2*Math.PI);
    g.rotateX(Math.PI/2);
    if(half) g.rotateZ(Math.PI/2); // keep Y >= 0, exposing the front cut on the XZ plane
    if(half) {
      const a=g.getAttribute('position'), n=g.getAttribute('normal'), p=Array.from(a.array), normals=Array.from(n.array);
      const idx=Array.from(g.index.array), base=a.count;
      // Cap both radial cut faces. The ring stays a solid section, not an open ribbon.
      for(const sign of [-1,1]) {
        const start=p.length/3;
        p.push(sign*ri,0,-h/2, sign*ro,0,-h/2+cone, sign*ro,0,h/2+cone, sign*ri,0,h/2);
        for(let j=0;j<4;j++) normals.push(0,-1,0);
        idx.push(start,start+1,start+2,start,start+2,start+3);
      }
      g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
      g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3)); g.setIndex(idx);
    }
    g.computeBoundingBox(); return g;
  }
  const parts=[];
  function ring(name,ri,ro,h,mat,z,cone=0,parent=stack) {
    const mesh=new THREE.Mesh(ringGeometry(ri,ro,h,cone),mat.clone());
    mesh.name=name; mesh.position.z=z;
    mesh.userData={coaxial:true,assembledZ:z,fullGeometry:mesh.geometry,sectionGeometry:ringGeometry(ri,ro,h,cone,true)};
    mesh.material.side=THREE.DoubleSide; parent.add(mesh); parts.push(mesh); return mesh;
  }
  const base=new THREE.Mesh(cylinder(.91,.34,64),mats.cover.clone()); base.position.z=.17; baseGroup.add(base);
  const lid=new THREE.Mesh(cylinder(.86,.035,64),mats.cover.clone()); lid.position.z=.358; baseGroup.add(lid);
  const shaft=new THREE.Mesh(cylinder(.033,4.35),mats.shaft); shaft.name='common-shaft'; shaft.position.z=2.48; root.add(shaft);
  const localShaft=new THREE.Mesh(cylinder(.055,.62),mats.shaft); localShaft.name='common-shaft-local'; stack.add(localShaft);
  localShaft.userData={coaxial:true,fullGeometry:localShaft.geometry,sectionGeometry:ringGeometry(0,.055,.62,0,true)};
  const motor=new THREE.Group(); motor.position.set(.5,0,.18); motor.name='BLDC'; drive.add(motor);
  motor.add(new THREE.Mesh(cylinder(.175,.26),mats.motor));
  const endcap=new THREE.Mesh(cylinder(.182,.025),mats.collar);endcap.position.z=-.137;motor.add(endcap);
  const spindle=new THREE.Mesh(cylinder(.03,.13),mats.shaft);spindle.position.z=.18;motor.add(spindle);
  function pulley(r,x) {
    const group=new THREE.Group();group.position.set(x,0,.39);drive.add(group);
    group.add(new THREE.Mesh(cylinder(r,.046,software?24:48),mats.pulley));
    for(const z of [-.032,.032]) {const flange=new THREE.Mesh(cylinder(r+.01,.012),mats.pulley);flange.position.z=z;group.add(flange);}
    const mark=new THREE.Mesh(new THREE.BoxGeometry(r*.7,.016,.006),mats.collar);mark.position.set(r*.45,0,.041);group.add(mark);
    return group;
  }
  const shaftPulley=pulley(.25,0),motorPulley=pulley(.12,.5);
  // External tangent of unequal pulleys. The two arcs and straight runs form one closed belt.
  const alpha=Math.acos((.25-.12)/.5),beltPts=[];
  for(let j=0;j<=32;j++){const a=alpha+j/32*(2*Math.PI-2*alpha);beltPts.push(new THREE.Vector3(.25*Math.cos(a),.25*Math.sin(a),.39));}
  for(let j=0;j<=24;j++){const a=-alpha+j/24*(2*alpha);beltPts.push(new THREE.Vector3(.5+.12*Math.cos(a),.12*Math.sin(a),.39));}
  beltPts.push(beltPts[0].clone());
  const beltCurve=new THREE.CurvePath();for(let j=0;j<beltPts.length-1;j++)beltCurve.add(new THREE.LineCurve3(beltPts[j],beltPts[j+1]));
  const belt=new THREE.Mesh(new THREE.TubeGeometry(beltCurve,100,.011,4,false),mats.belt);belt.name='timing-belt';drive.add(belt);
  for(let i=0;i<beltPts.length-1;i+=2) {const p=beltPts[i],to=beltPts[(i+1)%(beltPts.length-1)],d=to.clone().sub(p).normalize();const tooth=new THREE.Mesh(new THREE.BoxGeometry(.012,.024,.03),mats.belt);tooth.position.copy(p);tooth.rotation.z=Math.atan2(d.y,d.x);drive.add(tooth);}
  const driver=new THREE.Mesh(new THREE.BoxGeometry(.28,.25,.075),mats.driver);driver.position.set(-.48,-.23,.15);driver.name='FOC-driver';drive.add(driver);
  for(let i=0;i<4;i++){const fin=new THREE.Mesh(new THREE.BoxGeometry(.23,.015,.045),mats.collar);fin.position.set(-.48,-.31+i*.05,.206);drive.add(fin);}
  // Only this short cable connects the driver to the motor; it remains inside the base.
  const wireCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.34,-.23,.15),new THREE.Vector3(.1,-.35,.12),new THREE.Vector3(.5,-.18,.18)]);
  drive.add(new THREE.Mesh(new THREE.TubeGeometry(wireCurve,16,.012,4,false),mats.belt));
  const layerObjs=[];
  function seeded(i){const x=Math.sin((i+1)*12.9898+78.233)*43758.5453;return x-Math.floor(x);}
  const firstFactors=[.55,.90,.63,.81,.47];
  for(let i=0;i<20;i++) {
    const k=i/19,z=.95+k*3.3,size=.30+1.30*Math.pow(Math.sin(Math.PI*k),.92);
    const group=new THREE.Group();group.name=`layer-${i+1}`;group.position.z=z;group.rotation.z=i*.28;layersGroup.add(group);
    // Each planar lobe ends at the hub's outside radius. It never crosses the shaft.
    const segments=[];
    for(const start of [0,Math.PI]) {
      const pts=[];const N=software?40:72;
      let lo=0,hi=Math.PI/2;
      for(let j=0;j<32;j++){const t=(lo+hi)/2;if(Math.hypot(size*Math.sin(t),size*.54*Math.sin(2*t))<.1206)lo=t;else hi=t;}
      const entry=(lo+hi)/2;
      for(let j=0;j<=N;j++){const t=start+entry+j/N*(Math.PI-2*entry);pts.push(new THREE.Vector3(size*Math.sin(t),size*.54*Math.sin(2*t),0));}
      const line=new THREE.CatmullRomCurve3(pts,false,'centripetal');
      const tube=new THREE.Mesh(new THREE.TubeGeometry(line,N,.014,software?4:6,false),mats.layer.clone());tube.userData.layerIndex=i;group.add(tube);segments.push(tube);
    }
    const hub=new THREE.Mesh(ringGeometry(.0336,.123,.0192),mats.layer.clone());hub.name='exterior-layer-hub';hub.userData.layerIndex=i;group.add(hub);
    const factor=firstFactors[i]??(.36+seeded(i)*.58);
    layerObjs.push({group,tubes:segments,hub,z,size,baseFactor:factor,factor});
  }
  const collar=ring('shaft-collar',.056,.15,.026,mats.collar,-.064);
  const spring=ring('disc-spring',.058,.182,.007,mats.spring,-.048,.015);
  const friction=ring('friction-ring',.070,.198,.015,mats.friction,-.022);
  const bearing=new THREE.Group();bearing.name='ball-bearing';bearing.position.z=.025;stack.add(bearing);
  const inner=ring('bearing-inner-race',.056,.090,.036,mats.race,0,0,bearing);
  const outer=ring('bearing-outer-race',.119,.150,.036,mats.race,0,0,bearing);
  const balls=new THREE.Group();balls.name='bearing-balls';bearing.add(balls);
  for(let j=0;j<12;j++) {const a=j/12*2*Math.PI;const ball=new THREE.Mesh(new THREE.SphereGeometry(.014,software?8:16,software?6:10),mats.ball);ball.position.set(.1045*Math.cos(a),.1045*Math.sin(a),0);balls.add(ball);}
  const hub=new THREE.Group();hub.name='rotating-hub';hub.position.z=.026;stack.add(hub);
  const sleeve=ring('hub-bearing-seat',.150,.205,.066,mats.hub,0,0,hub);
  const face=ring('hub-friction-face',.070,.205,.014,mats.hub,-.033,0,hub);
  const retainer=ring('retainer',.056,.107,.025,mats.retainer,.064);
  const stubs=new THREE.Group();stubs.name='layer-attachments';stack.add(stubs);
  for(const [sx,sy] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
    const curve=new THREE.LineCurve3(new THREE.Vector3(sx*.14,sy*.15,0),new THREE.Vector3(sx*.29,sy*.30,0));
    stubs.add(new THREE.Mesh(new THREE.TubeGeometry(curve,1,.014,6,false),mats.layer));
  }
  // Small witness marks make shaft-side / hub-side rotation visible in close views.
  const marks=[];
  for(const [parent,r,z] of [[collar,.118,.015],[hub,.18,.036],[retainer,.089,.014]]) {
    const m=new THREE.Mesh(new THREE.BoxGeometry(.030,.012,.004),mats.belt);m.position.set(r,0,z);parent.add(m);marks.push(m);
  }
  const plane=new THREE.Mesh(new THREE.RingGeometry(.21,.34,40),new THREE.MeshBasicMaterial({color:0x9ca99b,transparent:true,opacity:.13,side:THREE.DoubleSide,depthWrite:false}));plane.position.z=0;stack.add(plane);
  const axisLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,-.36),new THREE.Vector3(0,0,.36)]),new THREE.LineDashedMaterial({color:0x67827a,dashSize:.02,gapSize:.02}));axisLine.computeLineDistances();stack.add(axisLine);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(3.6,48),new THREE.MeshBasicMaterial({color:0xe7eae3}));floor.position.z=-.008;scene.add(floor);
  function updateStack(selected,mode,explode) {
    stack.position.set(0,0,layerObjs[selected].z);
    const g=mode==='exploded'?.033*explode:0;
    collar.position.z=-.064-2*g;spring.position.z=-.048-g;friction.position.z=-.022-.2*g;
    bearing.position.z=.025+g;hub.position.z=.026+3.9*g;retainer.position.z=.064+5.6*g;
    layerObjs.forEach((l,i)=>l.group.position.z=l.z+(i===selected?3.9*g*.6:0));
    stubs.position.z=3.9*g;stubs.rotation.z=layerObjs[selected].group.rotation.z;
  }
  function setMode(selected,mode,explode) {
    const close=mode==='section'||mode==='exploded';
    drive.visible=mode==='internal'||mode==='operation';baseGroup.visible=!close;floor.visible=!close&&!software;
    stack.visible=mode!=='exterior';shaft.visible=!close;localShaft.visible=close;plane.visible=mode==='exploded';axisLine.visible=close;
    for(const m of [base,lid]){m.material.transparent=mode!=='exterior';m.material.opacity=mode==='exterior'?1:.09;m.material.depthWrite=mode==='exterior';}
    layerObjs.forEach((l,i)=>{
      l.group.visible=!close;l.hub.visible=mode==='exterior'||i!==selected;
      for(const m of [...l.tubes,l.hub]) {
        const dim=mode==='operation'&&i!==selected;
        m.material.transparent=dim||close;m.material.opacity=dim?.09:close?.32:1;m.material.depthWrite=!dim&&!close;
        m.material.color.setHex(i===selected&&mode!=='exterior'?0xa65c45:0x4c5550);
      }
    });
    for(const m of [...parts,localShaft]) m.geometry=mode==='section'?m.userData.sectionGeometry:m.userData.fullGeometry;
    balls.children.forEach(b=>b.visible=mode!=='section'||b.position.y>=-.001);
    marks.forEach(m=>m.visible=mode!=='section');
    stubs.visible=close;
    if(mode==='section') for(const m of [collar,spring,friction,inner,outer,hub,retainer,balls])m.rotation.z=0;
    else hub.rotation.z=layerObjs[selected].group.rotation.z;
    axisLine.visible=close;
    updateStack(selected,mode,explode);
  }
  function step(selected,delta,mode) {
    shaft.rotation.z+=delta;shaftPulley.rotation.z+=delta;motorPulley.rotation.z+=delta*.25/.12;
    for(const l of layerObjs) l.group.rotation.z+=delta*l.factor;
    stubs.rotation.z=layerObjs[selected].group.rotation.z;
    if(mode==='section')return; // keep the cut faces on XZ while the sculpture rotates
    for(const m of [collar,spring,friction,inner,retainer])m.rotation.z+=delta;
    const out=delta*layerObjs[selected].factor;outer.rotation.z+=out;hub.rotation.z+=out;balls.rotation.z+=(delta+out)/2;
  }
  function torquePoints(selected) {
    root.updateMatrixWorld(true);
    const l=layerObjs[selected],tip=new THREE.Vector3(l.size*Math.sin(Math.PI/4),l.size*.54,0);l.group.localToWorld(tip);
    return [new THREE.Vector3(.5,0,.18),new THREE.Vector3(.5,.12,.39),new THREE.Vector3(0,.25,.39),new THREE.Vector3(0,0,.43),new THREE.Vector3(0,0,l.z-.0132),new THREE.Vector3(.084,0,l.z-.0132),new THREE.Vector3(.123,0,l.z),tip];
  }
  return {scene,root,baseGroup,drive,stack,shaft,localShaft,layerObjs,parts,collar,spring,friction,bearing,inner,outer,balls,hub,retainer,motor,motorPulley,shaftPulley,belt,driver,updateStack,setMode,step,torquePoints};
}
