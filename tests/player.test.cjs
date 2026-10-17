const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const math=require('../player.js');

function fixture(){
  const elements=new Map(),listeners={};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{checked:false,style:{},classList:{add(){},remove(){}},addEventListener(){}});
    return elements.get(id);
  };
  class Cartesian3{
    constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
    static clone(p){return new Cartesian3(p.x,p.y,p.z);}
    static fromRadians(x,y,z){return new Cartesian3(x,y,z);}
  }
  const Cesium={Cartesian3,
    Cartographic:{fromCartesian:p=>({longitude:p.x,latitude:p.y,height:p.z})},
    Transforms:{eastNorthUpToFixedFrame:p=>p},
    Matrix4:{IDENTITY:{},multiplyByPoint:(matrix,p)=>new Cartesian3(matrix.x+p.x,matrix.y+p.y,matrix.z+p.z)},
    ScreenSpaceEventHandler:class{setInputAction(fn){this.click=fn;}},ScreenSpaceEventType:{LEFT_CLICK:0}
  };
  let ground=()=>0,blocked=false;
  const camera={positionWC:new Cartesian3(10,20,300),directionWC:new Cartesian3(0,0,-1),upWC:new Cartesian3(0,1,0),
    frustum:{near:1,fov:1,clone(){return {...this};}},
    lookAtTransform(){},switchToPerspectiveFrustum(){},setView(options){this.lastView=options;}};
  const viewer={camera,scene:{canvas:{style:{},addEventListener(){},requestPointerLock(){}},requestRender(){},
    pickTranslucentDepth:false,pickPositionSupported:true,pickPosition:()=>new Cartesian3(0,0,0),
    screenSpaceCameraController:{enableInputs:true},sampleHeightSupported:true,
    sampleHeight:p=>ground(p.longitude,p.latitude)}};
  const outbreak={settings:{characterScale:1},data:{show:true,entities:{values:[]}},setPlacing(){},nextFrame:async()=>{},blocksPosition:()=>blocked};
  const context={Cesium,module:{exports:{}},performance:{now:()=>0},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    document:{getElementById:element,addEventListener(name,fn){listeners[name]=fn;},body:{classList:{add(){},remove(){}}}},window:{addEventListener(){}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../player.js'),'utf8')+'\nthis.Player=FirstPersonPlayer;',context);
  const player=new context.Player(viewer,outbreak);
  return {player,viewer,elements,listeners,outbreak,setGround(fn){ground=fn;player.cache.clear();},setBlocked(value){blocked=value;}};
}

(async()=>{
  const forward=math.movement(1,0,0,2,1);
  assert.deepEqual(forward,{x:0,y:2});
  const diagonal=math.movement(1,1,0,2,1);
  assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-2)<1e-9,'Diagonal movement does not boost speed');
  assert.equal(math.walkable(0,.46),false);assert.equal(math.walkable(0,-.76),false);
  assert.equal(math.walkable(0,.25),true);assert.equal(math.walkable(0,undefined),false);
  assert.ok(math.clampPitch(100)<Math.PI/2,'Mouse look cannot flip the player upside-down');

  const f=fixture();f.player.setSource('local');f.player.armPlacement(false);
  assert.equal(f.outbreak.data.show,false,'Game props hidden while picking spawn');
  await f.player.pickSpawn({x:20,y:30});
  assert.ok(f.player.spawn);assert.equal(f.outbreak.data.show,true);
  f.player.enter();assert.equal(f.player.active,true);assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs,false);
  assert.equal(f.viewer.camera.lastView.destination.z,1.72,'Camera begins at standing eye height');
  assert.equal(f.player.tryStep(0,.15),null,'Walks on sampled pavement');
  const previous=f.player.position.y;
  f.setGround(()=>4);assert.match(f.player.tryStep(0,.15),/wall/);
  assert.equal(f.player.position.y,previous,'Wall blocks movement');
  f.setGround(()=>-3);assert.match(f.player.tryStep(0,.15),/drop/);
  f.setGround(()=>undefined);assert.match(f.player.tryStep(0,.15),/No ground/);
  f.elements.get('flatWalk').checked=true;
  assert.equal(f.player.tryStep(0,.15),null,'Explicit fallback permits picked-plane walking');
  assert.match(f.player.tryStep(31,0),/No ground/,'Fallback cannot walk indefinitely off the model');
  f.setBlocked(true);assert.match(f.player.tryStep(0,.15),/Obstacle/,'Added props block player');f.setBlocked(false);
  f.player.respawn();assert.equal(f.player.position.y,0);
  f.player.keys.add('KeyW');f.player.exit();
  assert.equal(f.player.active,false);assert.equal(f.player.keys.size,0);
  assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs,true);
  assert.equal(f.viewer.camera.lastView.destination.z,300,'Exit restores overhead camera');
  f.outbreak.settings.characterScale=.2;f.player.enter();
  assert.ok(Math.abs(f.viewer.camera.lastView.destination.z-.344)<1e-9,'Small character has scaled eye height');
  f.player.exit();
  f.player.enter();f.player.hadPointerLock=true;f.listeners.pointerlockchange();
  assert.equal(f.player.active,false,'Browser escape from pointer lock exits walk mode');
  f.player.clear();assert.equal(f.player.spawn,null);assert.equal(f.player.source,null);
  console.log('PASS: spawn pick, eye height, movement, ground/wall/drop checks, bounded fallback, props, respawn, camera restore, pointer-lock exit');
})().catch(error=>{console.error(error);process.exitCode=1;});
