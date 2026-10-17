const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const math = require('../outbreak.js');

function fixture(sampleHeight) {
  let time=0;
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{style:{},classList:{toggle(){}},value:0,textContent:'',addEventListener(){}});
    return elements.get(id);
  };
  class Cartesian3 {
    constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
    static clone(p){return new Cartesian3(p.x,p.y,p.z);}
    static fromDegrees(x,y,z){return new Cartesian3(x,y,z);}
  }
  const entities={values:[],add(e){this.values.push(e);return e;},removeAll(){this.values=[];}};
  class Matrix4{
    static multiplyByPoint(matrix,p){return new Cartesian3(matrix.x+p.x,matrix.y+p.y,matrix.z+p.z);}
    static inverseTransformation(matrix){return {x:-matrix.x,y:-matrix.y,z:-matrix.z};}
  }
  const color={withAlpha(){return this;}};
  const Cesium={
    Cartesian3,
    defined:value=>value!==undefined&&value!==null,
    Cartographic:{fromCartesian:p=>({longitude:p.x,latitude:p.y,height:p.z}),toCartesian:p=>new Cartesian3(p.longitude,p.latitude,p.height)},
    CustomDataSource:class{constructor(){this.entities=entities;}},
    Transforms:{eastNorthUpToFixedFrame:p=>p,headingPitchRollQuaternion:()=>({})},
    Matrix4,
    ScreenSpaceEventHandler:class{setInputAction(){}},ScreenSpaceEventType:{LEFT_CLICK:0},
    Color:{fromCssColorString:()=>color,BLACK:color},
    VerticalOrigin:{BOTTOM:0},HorizontalOrigin:{CENTER:0},LabelStyle:{FILL_AND_OUTLINE:0},
    HeadingPitchRoll:class{},DistanceDisplayCondition:class{}
  };
  const renderListeners=new Set();
  const viewer={dataSources:{add(){}},scene:{canvas:{style:{}},sampleHeightSupported:true,pickPositionSupported:true,pickTranslucentDepth:false,
    postRender:{addEventListener(fn){renderListeners.add(fn);return ()=>renderListeners.delete(fn);}},
    pickPosition:()=>new Cartesian3(0,0,-20),
    sampleHeightMostDetailed:async samples=>{samples.forEach((p,i)=>{if(sampleHeight===undefined)samples[i]=undefined;else p.height=sampleHeight;});return samples;},requestRender(){for(const fn of renderListeners)queueMicrotask(fn);}}};
  const context={Cesium,document:{getElementById:element,hidden:false,
    createElement:()=>({getContext:()=>({fillRect(){}}),toDataURL:()=> 'data:image/mock'})},
    window:{addEventListener(){}},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,
    performance:{now:()=>time},module:{exports:{}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../outbreak.js'),'utf8')+'\nthis.Layer=OutbreakLayer;',context);
  const layer=new context.Layer(viewer);
  layer.anchor=new Cartesian3(0,0,16);layer.transform=layer.anchor;layer.autoGround=true;
  return {layer,elements,viewer,advance(){time+=100;layer.tick();}};
}

(async()=>{
  assert.deepEqual(math.population(35),{estimated:107,simulated:107});
  assert.deepEqual(math.population(100),{estimated:306,simulated:200});
  assert.deepEqual(math.population(0),{estimated:0,simulated:0});
  const sim=fixture(-20);
  await sim.layer.rebuild();
  assert.equal(sim.layer.ready,true);
  assert.equal(sim.layer.anchor.z,-20,'Google ellipsoid street height overrides guessed sea-level height');
  assert.equal(sim.layer.agents.length,107);
  assert.equal(sim.layer.agents.filter(a=>a.infected).length,86);
  assert.ok(sim.layer.data.entities.values.some(e=>e.box),'Three-dimensional scenery created');
  const prop=sim.layer.colliders[0];
  assert.equal(sim.layer.blocksPosition(sim.layer.world(prop.x,prop.y,prop.z+.1),1.72),true,'Player footprint collides with authored scenery');
  assert.equal(sim.layer.blocksPosition(sim.layer.world(prop.x,prop.y,prop.z+prop.h+2),1.72),false,'A player above a prop does not collide with it');
  for(const entity of sim.layer.data.entities.values)if(entity.ellipse)assert.ok(entity.ellipse.semiMajorAxis>=entity.ellipse.semiMinorAxis,'Valid ellipse geometry');
  const first=sim.layer.agents[0],initial=first.progress;
  sim.advance();assert.ok(first.progress!==initial,'Actors move during simulation');
  sim.layer.settings.paused=true;const paused=first.progress;
  sim.advance();assert.equal(first.progress,paused,'Pause freezes simulation');
  sim.layer.settings.paused=false;
  // Force a close encounter and verify infection + cooldown, rather than merely
  // checking that the initial infected count was assigned.
  const survivor=sim.layer.agents.find(a=>!a.infected);
  sim.layer.agents.forEach(a=>{a.escaped=a!==first&&a!==survivor;});
  Object.assign(survivor,{from:first.from,to:first.to,progress:first.progress,cooldown:0});
  first.cooldown=0;sim.advance();
  assert.equal(survivor.infected,true,'Zombie contact infects a survivor');
  assert.ok(survivor.cooldown>0,'Infection has a cooldown');
  sim.layer.clear();assert.equal(sim.layer.agents.length,0);assert.equal(sim.layer.data.entities.values.length,0);
  const empty=fixture(undefined);await empty.layer.rebuild();
  assert.equal(empty.layer.ready,false,'Missing surface hits do not spawn floating crowds');
  assert.equal(empty.layer.agents.length,0);
  const zero=fixture(-20);zero.layer.settings.remaining=0;await zero.layer.rebuild();
  assert.equal(zero.layer.agents.length,0,'Zero population still permits scenery');
  const local=fixture(undefined);local.layer.sourceType='local';local.layer.setPlacing(true);
  assert.equal(local.viewer.scene.pickTranslucentDepth,true,'Placement includes transparent GLB surfaces');
  await local.layer.pickAt({x:100,y:200});
  assert.equal(local.layer.ready,true,'Clicked GLB surface can populate when height sampling returns no hits');
  assert.equal(local.layer.agents.length,107);
  assert.equal(local.layer.anchor.z,-20,'Fallback uses the picked model surface height');
  assert.equal(local.viewer.scene.pickTranslucentDepth,false,'Temporary picking option is restored');
  assert.match(local.elements.get('placementMessage').textContent,/picked surface plane/,'Visible message identifies approximate fallback');
  local.layer.setPlacing(true);local.viewer.scene.pickPosition=()=>undefined;
  await local.layer.pickAt({x:100,y:200});
  assert.equal(local.layer.placing,true,'Missed click keeps placement armed');
  assert.match(local.elements.get('placementMessage').textContent,/No surface hit/);
  local.layer.setPlacing(false);
  assert.equal(local.layer.data.show,true,'Cancel restores previous outbreak visibility');
  console.log('PASS: simulation, GLB surface picking/fallback, transparent depth, miss/retry, and visible placement feedback');
})().catch(error=>{console.error(error);process.exitCode=1;});
