'use strict';
const PlayerMath={
  movement(forward,right,heading,speed,dt){
    const length=Math.hypot(forward,right)||1;
    return {x:(Math.sin(heading)*forward+Math.cos(heading)*right)/length*speed*dt,
      y:(Math.cos(heading)*forward-Math.sin(heading)*right)/length*speed*dt};
  },
  walkable(current,next,scale=1){return Number.isFinite(next)&&next-current<=.45*scale&&next-current>=-.75*scale;},
  clampPitch(pitch){return Math.max(-Math.PI*.47,Math.min(Math.PI*.47,pitch));}
};
if(typeof module!=='undefined')module.exports=PlayerMath;

class FirstPersonPlayer{
  constructor(viewer,outbreak){
    this.viewer=viewer;this.outbreak=outbreak;this.active=false;this.placing=false;this.keys=new Set();
    this.spawn=null;this.source=null;this.cache=new Map();this.yaw=29*Math.PI/180;this.pitch=0;this.lookDrag=false;
    this.lastTime=performance.now();this.accumulator=0;
    this.bind();
    this.picker=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    this.picker.setInputAction(click=>this.pickSpawn(click.position),Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.loop=this.loop.bind(this);this.animation=requestAnimationFrame(this.loop);
  }
  say(text){
    document.getElementById('playerMessage').textContent=text;
    document.getElementById('walkStatus').textContent=text;
  }
  get scale(){return this.outbreak.settings?.characterScale??.2;}
  setSource(type){this.source=type;this.spawn=null;this.cache.clear();this.say('Choose a street spawn, then enter first person.');}
  clear(){this.exit();this.cancelPlacement();this.source=null;this.spawn=null;this.cache.clear();}
  bind(){
    const get=id=>document.getElementById(id),canvas=this.viewer.scene.canvas;
    get('walkMode').addEventListener('click',()=>{
      if(!this.source){this.say('Load a city scan first.');return;}
      if(!this.spawn){this.armPlacement(true);return;}
      this.enter();
    });
    get('placePlayer').addEventListener('click',()=>this.armPlacement(false));
    get('exitWalk').addEventListener('click',()=>this.exit());
    get('respawnPlayer').addEventListener('click',()=>this.respawn());
    get('captureMouse').addEventListener('click',()=>this.captureMouse());
    get('flatWalk').addEventListener('change',()=>this.cache.clear());
    get('characterScale').addEventListener('input',()=>{
      this.cache.clear();this.eyeHeight=1.72*this.scale;
      if(this.active){this.viewer.camera.frustum.near=.08*this.scale;this.updateCamera();}
    });
    document.addEventListener('keydown',event=>{
      if(event.code==='Escape'){
        if(this.active)this.exit();else if(this.placing)this.cancelPlacement();
        return;
      }
      if(!this.active||event.target?.matches?.('input,textarea,select'))return;
      if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','ControlLeft','ControlRight','KeyR'].includes(event.code)){
        event.preventDefault();this.keys.add(event.code);if(event.code==='KeyR')this.respawn();
      }
    });
    document.addEventListener('keyup',event=>this.keys.delete(event.code));
    window.addEventListener('blur',()=>{this.keys.clear();this.lookDrag=false;});
    document.addEventListener('visibilitychange',()=>{this.keys.clear();this.lastTime=performance.now();});
    document.addEventListener('pointerlockchange',()=>{
      if(document.pointerLockElement===canvas){this.hadPointerLock=true;return;}
      if(this.active&&this.hadPointerLock){this.hadPointerLock=false;this.exit();return;}
      if(this.active){this.keys.clear();this.say('Mouse released. Click Capture mouse, or drag the view to look.');}
    });
    document.addEventListener('mousemove',event=>{
      if(!this.active || (document.pointerLockElement!==canvas&&!this.lookDrag))return;
      this.yaw+=event.movementX*.0022;this.pitch=PlayerMath.clampPitch(this.pitch-event.movementY*.0022);
      this.updateCamera();
    });
    canvas.addEventListener('mousedown',event=>{if(this.active&&event.button===0)this.lookDrag=true;});
    document.addEventListener('mouseup',()=>{this.lookDrag=false;});
    window.addEventListener('pagehide',()=>{cancelAnimationFrame(this.animation);this.exit();});
  }
  armPlacement(enterAfter){
    if(!this.source){this.say('Load a city scan first.');return;}
    this.exit();this.cancelPlacement();
    this.outbreak.setPlacing(false);
    this.placing=true;this.enterAfterPick=enterAfter;
    this.previousShow=this.outbreak.data.show;this.outbreak.data.show=false;
    this.previousDepth=this.viewer.scene.pickTranslucentDepth;
    this.viewer.scene.useDepthPicking=true;this.viewer.scene.pickTranslucentDepth=true;
    this.viewer.scene.canvas.style.cursor='crosshair';
    const banner=document.getElementById('placementMessage');banner.hidden=false;
    banner.textContent='PLAYER SPAWN · Click visible street pavement. Esc cancels.';
    this.say('Click visible pavement to choose your player spawn.');
    this.viewer.scene.requestRender();
  }
  cancelPlacement(){
    if(!this.placing)return;
    this.placing=false;this.viewer.scene.canvas.style.cursor='';
    this.viewer.scene.pickTranslucentDepth=this.previousDepth;
    this.outbreak.data.show=this.previousShow;
    this.viewer.scene.requestRender();
  }
  async pickSpawn(screen){
    if(!this.placing||this.picking)return;
    this.picking=true;
    try{
      await this.outbreak.nextFrame();
      if(!this.placing)return;
      const scene=this.viewer.scene;
      const hit=scene.pickPositionSupported?scene.pickPosition(screen):undefined;
      if(!hit||![hit.x,hit.y,hit.z].every(Number.isFinite)){
        this.say('No surface hit. Click solid visible pavement.');
        document.getElementById('placementMessage').textContent='No surface hit. Placement remains active; try another street point.';return;
      }
      this.spawn=Cesium.Cartesian3.clone(hit);this.transform=Cesium.Transforms.eastNorthUpToFixedFrame(this.spawn);
      this.cache.clear();this.cancelPlacement();
      document.getElementById('placementMessage').hidden=true;
      this.say('Street spawn set. Click Enter first person.');
      document.getElementById('walkMode').textContent='Enter first person';
      if(this.enterAfterPick)this.enter();
    }catch(error){this.say('Could not pick a spawn. Try another street surface.');}
    finally{this.picking=false;}
  }
  enter(){
    if(this.active||!this.spawn)return;
    const camera=this.viewer.camera,controller=this.viewer.scene.screenSpaceCameraController;
    this.cancelPlacement();this.outbreak.setPlacing(false);
    this.saved={position:Cesium.Cartesian3.clone(camera.positionWC),direction:Cesium.Cartesian3.clone(camera.directionWC),up:Cesium.Cartesian3.clone(camera.upWC),frustum:camera.frustum.clone(),enableInputs:controller.enableInputs};
    camera.lookAtTransform(Cesium.Matrix4.IDENTITY);camera.switchToPerspectiveFrustum();
    camera.frustum.near=.08*this.scale;camera.frustum.fov=75*Math.PI/180;
    controller.enableInputs=false;this.active=true;this.hadPointerLock=false;this.keys.clear();
    this.position={x:0,y:0,z:0};this.yaw=29*Math.PI/180;this.pitch=-.04;this.eyeHeight=1.72*this.scale;
    this.lastTime=performance.now();this.accumulator=0;this.cameraDirty=true;
    document.body.classList.add('walking');document.getElementById('walkHUD').hidden=false;
    document.getElementById('placementMessage').hidden=true;
    this.say('WASD walk · Shift sprint · Ctrl crouch · R respawn · Esc exit');
    this.updateCamera();this.captureMouse();
  }
  captureMouse(){
    if(!this.active)return;
    try{
      const request=this.viewer.scene.canvas.requestPointerLock?.();
      if(request?.catch)request.catch(()=>this.say('Mouse capture unavailable. Hold left mouse and drag to look; WASD still works.'));
    }catch(error){this.say('Hold left mouse and drag to look; WASD still works.');}
  }
  exit(){
    if(!this.active)return;
    this.active=false;this.keys.clear();this.lookDrag=false;
    if(document.pointerLockElement===this.viewer.scene.canvas)document.exitPointerLock?.();
    document.body.classList.remove('walking');document.getElementById('walkHUD').hidden=true;
    const camera=this.viewer.camera;
    camera.frustum=this.saved.frustum;
    camera.setView({destination:this.saved.position,orientation:{direction:this.saved.direction,up:this.saved.up}});
    this.viewer.scene.screenSpaceCameraController.enableInputs=this.saved.enableInputs;
    this.viewer.scene.requestRender();
  }
  respawn(){
    if(!this.active)return;
    this.position={x:0,y:0,z:0};this.keys.clear();this.cache.clear();this.pitch=-.04;
    this.say('Back at your street spawn.');this.updateCamera();
  }
  world(position){return Cesium.Matrix4.multiplyByPoint(this.transform,new Cesium.Cartesian3(position.x,position.y,position.z),new Cesium.Cartesian3());}
  groundAt(position){
    const cell=.25*this.scale;
    const key=`${Math.round(position.x/cell)},${Math.round(position.y/cell)}`;
    if(this.cache.has(key))return this.cache.get(key);
    let height;
    if(this.viewer.scene.sampleHeightSupported){
      try{height=this.viewer.scene.sampleHeight(Cesium.Cartographic.fromCartesian(this.world(position)),this.outbreak.data.entities.values,.15);}catch(error){/* Missing hit handled below. */}
    }
    if(Number.isFinite(height)){
      if(this.cache.size>2000)this.cache.clear();this.cache.set(key,height);
    }
    return height;
  }
  tryStep(dx,dy){
    const next={x:this.position.x+dx,y:this.position.y+dy,z:this.position.z};
    if(this.outbreak.blocksPosition?.(this.world(next),1.72*this.scale,.25*this.scale))return 'Obstacle ahead';
    const currentHeight=Cesium.Cartographic.fromCartesian(this.world(this.position)).height;
    let centerHeight;
    // Footprint samples reject steep rises, drops, and missing scan surfaces.
    for(const [ox,oy] of [[0,0],[.22,0],[-.22,0],[0,.22],[0,-.22]]){
      const height=this.groundAt({x:next.x+ox*this.scale,y:next.y+oy*this.scale,z:next.z});
      if(!Number.isFinite(height)){
        if(document.getElementById('flatWalk').checked&&Math.hypot(next.x,next.y)<=30)continue;
        return 'No ground ahead · try another street or enable Flat street fallback';
      }
      if(!PlayerMath.walkable(currentHeight,height,this.scale))return 'Blocked by a wall, steep step, or drop';
      if(ox===0&&oy===0)centerHeight=height;
    }
    if(Number.isFinite(centerHeight))next.z+=centerHeight-currentHeight;
    this.position=next;return null;
  }
  updateCamera(){
    if(!this.active)return;
    const feet=Cesium.Cartographic.fromCartesian(this.world(this.position));
    this.viewer.camera.setView({destination:Cesium.Cartesian3.fromRadians(feet.longitude,feet.latitude,feet.height+this.eyeHeight),orientation:{heading:this.yaw,pitch:this.pitch,roll:0}});
    this.viewer.scene.requestRender();
  }
  loop(time){
    this.animation=requestAnimationFrame(this.loop);
    const dt=Math.min(Math.max((time-this.lastTime)/1000,0),.1);this.lastTime=time;
    if(!this.active||document.hidden)return;
    this.accumulator+=dt;if(this.accumulator<.05)return;
    const step=Math.min(this.accumulator,.075);this.accumulator=0;
    const down=code=>this.keys.has(code);
    const forward=Number(down('KeyW')||down('ArrowUp'))-Number(down('KeyS')||down('ArrowDown'));
    const right=Number(down('KeyD')||down('ArrowRight'))-Number(down('KeyA')||down('ArrowLeft'));
    const crouch=down('ControlLeft')||down('ControlRight');this.eyeHeight=(crouch?1.05:1.72)*this.scale;
    const sprint=down('ShiftLeft')||down('ShiftRight');
    const speed=(crouch?1.1:(sprint?4.5:2.2))*this.scale;
    if(forward||right){
      const delta=PlayerMath.movement(forward,right,this.yaw,speed,step);
      const subdivisions=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.y)/(.2*this.scale)));let blocked;
      for(let i=0;i<subdivisions;i++){blocked=this.tryStep(delta.x/subdivisions,delta.y/subdivisions);if(blocked)break;}
      this.say(blocked||`${crouch?'CROUCH':sprint?'SPRINT':'WALK'} · ${Math.hypot(this.position.x,this.position.y).toFixed(1)} m from spawn`);
    }
    this.updateCamera();
  }
}
