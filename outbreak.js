/* Original game assets over the source scan. Units: metres, seconds. */
'use strict';
const OutbreakMath = {
  population(remaining) {
    const estimated = Math.round(220000 * (20/1440) * .10 * remaining/100);
    return {estimated, simulated:Math.min(200,Math.max(0,estimated))};
  },
  random(seed) {
    return () => {seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  },
  stepToward(x,y,tx,ty,speed,dt) {
    const dx=tx-x,dy=ty-y,d=Math.hypot(dx,dy),s=Math.min(d,speed*dt);
    return d>0?{x:x+dx/d*s,y:y+dy/d*s}:{x,y};
  }
};
if(typeof module!=='undefined') module.exports=OutbreakMath;

class OutbreakLayer {
  constructor(viewer) {
    this.viewer=viewer;
    this.settings={remaining:35,infected:80,enabled:true,paused:false,characterScale:.2};
    this.data=new Cesium.CustomDataSource('Outbreak — original game assets');
    viewer.dataSources.add(this.data);
    this.agents=[];this.nodes=[];this.generation=0;this.elapsed=0;this.last=performance.now();
    this.spriteCache=new Map();this.anchor=null;this.ready=false;this.placing=false;
    this.colliders=[];
    this.bindControls();
    this.pickHandler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    this.pickHandler.setInputAction(click=>this.pickAt(click.position),Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.timer=setInterval(()=>this.tick(),80);
  }
  note(text){
    document.getElementById('simMessage').textContent=text;
    const banner=document.getElementById('placementMessage');
    if(banner){banner.textContent=text;banner.hidden=false;}
  }
  setPlacing(value){
    this.placing=value;
    this.viewer.scene.canvas.style.cursor=value?'crosshair':'';
    const button=document.getElementById('placeOutbreak');
    button.textContent=value?'Cancel street placement':'Place outbreak on a street ↗';
    button.classList.toggle('placing',value);
    // Hide old outbreak objects so a second placement cannot pick a car/person.
    this.data.show=value?false:this.settings.enabled;
    if(value){
      this.previousTranslucentDepth=this.viewer.scene.pickTranslucentDepth;
      this.viewer.scene.useDepthPicking=true;
      this.viewer.scene.pickTranslucentDepth=true;
    }else if(this.previousTranslucentDepth!==undefined){
      this.viewer.scene.pickTranslucentDepth=this.previousTranslucentDepth;
      this.previousTranslucentDepth=undefined;
    }
    this.viewer.scene.requestRender();
  }
  nextFrame(){
    return new Promise(resolve=>{
      let remove=()=>{},timer;
      const done=()=>{remove();clearTimeout(timer);resolve();};
      remove=this.viewer.scene.postRender.addEventListener(done);
      timer=setTimeout(done,1200);this.viewer.scene.requestRender();
    });
  }
  async pickAt(screenPosition){
    if(!this.placing||this.picking)return;
    this.picking=true;
    const generation=this.generation;
    try{
      this.note('Picking the model surface…');
      await this.nextFrame();
      if(!this.placing||generation!==this.generation)return;
      const scene=this.viewer.scene;
      if(!scene.pickPositionSupported){this.note('This browser cannot read surface depth. Enable WebGL depth support or try another browser.');return;}
      const position=scene.pickPosition(screenPosition);
      if(!Cesium.defined(position)||![position.x,position.y,position.z].every(Number.isFinite)){
        this.note('No surface hit. Click visible pavement, away from holes or the background. Placement is still active.');return;
      }
      this.setPlacing(false);
      // Make the successful pick visible before starting asynchronous sampling.
      await this.setAnchor(position);
    }catch(error){
      this.note(`Surface pick failed: ${String(error?.message||error).replace(/https?:\/\/\S+/g,'[resource]').slice(0,180)}. Try another street point.`);
    }finally{this.picking=false;}
  }
  bindControls(){
    const get=id=>document.getElementById(id);
    get('characterScale').addEventListener('input',()=>{
      this.settings.characterScale=Number(get('characterScale').value)/100;
      get('characterScaleOut').value=`${get('characterScale').value}%`;
      for(const agent of this.agents){agent.entity.billboard.width=1.15*this.settings.characterScale;agent.entity.billboard.height=2.1*this.settings.characterScale;}
      this.viewer.scene.requestRender();
    });
    for(const key of ['remaining','infected']) get(key).addEventListener('input',()=>{
      this.settings[key]=Number(get(key).value);get(key+'Out').value=this.settings[key]+'%';
      this.scheduleReset();
    });
    get('showOutbreak').addEventListener('change',()=>{
      this.settings.enabled=get('showOutbreak').checked;this.data.show=this.settings.enabled;
      this.viewer.scene.requestRender();
    });
    get('pauseSim').addEventListener('click',()=>{
      this.settings.paused=!this.settings.paused;get('pauseSim').textContent=this.settings.paused?'Resume':'Pause';
    });
    get('resetSim').addEventListener('click',()=>this.rebuild());
    get('focusOutbreak').addEventListener('click',()=>{
      if(!this.anchor){this.note('Load a scan and place the outbreak first.');return;}
      this.viewer.camera.lookAt(this.anchor,new Cesium.HeadingPitchRange(25*Math.PI/180,-50*Math.PI/180,155));
      this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);this.viewer.scene.requestRender();
    });
    get('placeOutbreak').addEventListener('click',()=>{
      if(!this.sourceType){this.note('Load a city scan first.');return;}
      this.setPlacing(!this.placing);
      this.note(this.placing?'Click a road or plaza to move the outbreak there. Click this button again to cancel.':'Street placement canceled.');
    });
    window.addEventListener('pagehide',()=>{clearInterval(this.timer);clearTimeout(this.resetTimer);});
  }
  scheduleReset(){clearTimeout(this.resetTimer);this.resetTimer=setTimeout(()=>this.rebuild(),200);}
  clear(){
    this.generation++;this.ready=false;this.anchor=null;this.sourceType=null;
    this.agents=[];this.nodes=[];this.data.entities.removeAll();
    this.colliders=[];
    clearTimeout(this.resetTimer);this.setPlacing(false);this.updateStats();
  }
  onSourceLoaded(type,center,asset){
    this.sourceType=type;
    this.modelRadius=asset?.boundingSphere?.radius||200;
    if(type==='google') this.setAnchor(Cesium.Cartesian3.fromDegrees(-73.9855,40.7580,16),true);
    else {
      this.setPlacing(true);
      this.note('Street placement is active: click visible pavement in your GLB to add the outbreak.');
    }
  }
  setAnchor(position,autoGround=false){
    this.anchor=Cesium.Cartesian3.clone(position);
    this.autoGround=autoGround;
    this.transform=Cesium.Transforms.eastNorthUpToFixedFrame(this.anchor);
    return this.rebuild().catch(error=>{
      this.ready=false;this.updateStats();
      this.note(`Could not build outbreak: ${String(error?.message||error).replace(/https?:\/\/\S+/g,'[resource]').slice(0,180)}.`);
    });
  }
  world(x,y,z=0){
    // Manhattan avenue heading ≈29° east of north; hand-authored corridor.
    const a=29*Math.PI/180;
    return Cesium.Matrix4.multiplyByPoint(this.transform,new Cesium.Cartesian3(x*Math.cos(a)+y*Math.sin(a),-x*Math.sin(a)+y*Math.cos(a),z),new Cesium.Cartesian3());
  }
  async rebuild(){
    if(!this.anchor){this.note('Load a scan and choose a street to populate.');return;}
    const generation=++this.generation;
    this.ready=false;this.agents=[];this.data.entities.removeAll();this.elapsed=0;
    this.colliders=[];
    this.note('Surface picked. Sampling street heights…');
    this.data.entities.add({position:this.world(0,0,.25),point:{pixelSize:12,color:Cesium.Color.fromCssColorString('#d5f678'),outlineColor:Cesium.Color.BLACK,outlineWidth:2}});
    this.viewer.scene.requestRender();
    this.nodes=[];
    const spacing=this.sourceType==='local'?Math.max(2,Math.min(12,(this.modelRadius||200)*.06)):24;
    for(let row=0;row<7;row++) for(let lane=0;lane<3;lane++) this.nodes.push({x:(lane-1)*5,y:(row-3)*spacing,z:0,links:[]});
    const samples=this.nodes.map(n=>Cesium.Cartographic.fromCartesian(this.world(n.x,n.y)));
    let sampleTimer;
    try{
      if(this.viewer.scene.sampleHeightSupported){
        await Promise.race([
          this.viewer.scene.sampleHeightMostDetailed(samples,this.data.entities.values),
          new Promise((_,reject)=>{sampleTimer=setTimeout(()=>reject(new Error('Surface sampling timed out')),6000);})
        ]);
      }
    }catch(error){samples.fill(undefined);}
    finally{clearTimeout(sampleTimer);}
    if(generation!==this.generation) return;
    // Ellipsoid heights differ from sea-level elevations. Infer a low street
    // surface instead of assuming a fixed elevation for Google photogrammetry.
    if(this.autoGround){
      const measured=samples.map(c=>c?.height).filter(Number.isFinite).sort((a,b)=>a-b);
      if(measured.length){
        const location=Cesium.Cartographic.fromCartesian(this.anchor);
        location.height=measured[Math.floor((measured.length-1)*.2)];
        this.anchor=Cesium.Cartographic.toCartesian(location);
        this.transform=Cesium.Transforms.eastNorthUpToFixedFrame(this.anchor);
      }
    }
    let grounded=0;
    for(let i=0;i<this.nodes.length;i++){
      const h=samples[i]?.height,base=Cesium.Cartographic.fromCartesian(this.world(this.nodes[i].x,this.nodes[i].y)).height;
      // Reject rooftops and missing hits; never run agents up a building face.
      this.nodes[i].valid=Number.isFinite(h) && Math.abs(h-base)<4;
      if(this.nodes[i].valid){this.nodes[i].z=h-base+.08;grounded++;}
    }
    // Local models can render/pick correctly while the separate height query
    // returns no ground. Retain the actual clicked height as an explicit fallback.
    const planeFallback=!this.viewer.scene.sampleHeightSupported ||
      (this.sourceType==='local'&&!samples.some(c=>Number.isFinite(c?.height)));
    if(planeFallback)this.nodes.forEach(n=>{n.valid=true;n.z=.08;});
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i];if(!n.valid) continue;
      const row=Math.floor(i/3),lane=i%3;
      for(const j of [row>0?i-3:-1,row<6?i+3:-1,lane>0?i-1:-1,lane<2?i+1:-1]){
        if(j>=0 && this.nodes[j].valid && Math.abs(n.z-this.nodes[j].z)<1.6) n.links.push(j);
      }
    }
    let valid=this.nodes.map((n,i)=>i).filter(i=>this.nodes[i].valid&&this.nodes[i].links.length);
    const unseen=new Set(valid);let largest=[];
    while(unseen.size){
      const todo=[unseen.values().next().value],component=[];unseen.delete(todo[0]);
      while(todo.length){const i=todo.pop();component.push(i);for(const j of this.nodes[i].links)if(unseen.delete(j))todo.push(j);}
      if(component.length>largest.length)largest=component;
    }
    valid=largest;
    if(!valid.length){
      this.updateStats();this.note('No connected street surface found here yet. Let the scan finish loading, then use “Place outbreak on a street”.');
      return;
    }
    this.data.entities.removeAll();
    this.random=OutbreakMath.random(41247);
    this.safeNode=valid.reduce((a,b)=>this.nodes[a].y<this.nodes[b].y?a:b);
    const safe=this.nodes[this.safeNode];
    this.addProps(valid,safe);
    const population=OutbreakMath.population(this.settings.remaining);
    const infected=Math.round(population.simulated*this.settings.infected/100);
    for(let i=0;i<population.simulated;i++){
      const from=valid[Math.floor(this.random()*valid.length)],n=this.nodes[from];
      const to=n.links[Math.floor(this.random()*n.links.length)],t=this.nodes[to],u=this.random();
      const agent={id:i,infected:i<infected,from,to,progress:u,x:n.x+(t.x-n.x)*u,y:n.y+(t.y-n.y)*u,z:n.z+(t.z-n.z)*u,
        speed:.55+this.random()*.35,offset:(this.random()-.5)*1.2,variant:Math.floor(this.random()*4),frame:0,cooldown:0,escaped:false};
      agent.entity=this.data.entities.add({position:this.world(agent.x,agent.y,agent.z-.08+.08*this.settings.characterScale),billboard:{
        image:this.sprite(agent.infected,agent.variant,0),width:1.15*this.settings.characterScale,height:2.1*this.settings.characterScale,sizeInMeters:true,
        verticalOrigin:Cesium.VerticalOrigin.BOTTOM,horizontalOrigin:Cesium.HorizontalOrigin.CENTER
      }});
      this.agents.push(agent);
    }
    this.ready=true;this.last=performance.now();this.data.show=this.settings.enabled;
    this.updateStats();
    this.note(planeFallback?
      'Outbreak placed on the picked surface plane (height sampling unavailable). Use “Focus crowd”. Slopes and obstacles are approximate.':
      `Outbreak placed · ${grounded}/${this.nodes.length} surface samples grounded. Use “Focus crowd” to see people. Routes are approximate.`);
    this.viewer.scene.requestRender();
  }
  sprite(infected,variant,frame){
    const key=`${infected}-${variant}-${frame}`;
    if(this.spriteCache.has(key)) return this.spriteCache.get(key);
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=28;
    const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;
    const skin=infected?'#a2af68':['#d3a17e','#8e614b','#ebc4a0','#b27d55'][variant];
    const coat=infected?['#57684b','#716348','#4b6159','#735347'][variant]:['#cf8d46','#487b9b','#c1b59c','#8a647e'][variant];
    c.fillStyle='#101811';c.fillRect(5,1,6,7);c.fillRect(3,8,10,10);
    c.fillStyle=skin;c.fillRect(6,2,4,5);
    c.fillStyle=coat;c.fillRect(4,9,8,9);
    const stride=frame%2?2:0;
    c.fillStyle='#252d2c';c.fillRect(4,18,3,7-stride);c.fillRect(9,18,3,5+stride);
    c.fillStyle='#101511';c.fillRect(3,24-stride,4,2);c.fillRect(9,22+stride,4,2);
    c.fillStyle=skin;
    if(infected){c.fillRect(1,8,3,3);c.fillRect(12,7+stride,3,3);c.fillStyle='#8b3c32';c.fillRect(8,12,3,3);c.fillStyle='#e7e093';c.fillRect(6,4,1,1);c.fillRect(9,4,1,1);}
    else {c.fillRect(2,13+stride,2,4);c.fillRect(12,15-stride,2,4);}
    const url=canvas.toDataURL();this.spriteCache.set(key,url);return url;
  }
  box(x,y,z,w,d,h,color,heading=29){
    this.colliders.push({x,y,z,w,d,h});
    return this.data.entities.add({position:this.world(x,y,z+h/2),orientation:Cesium.Transforms.headingPitchRollQuaternion(this.world(x,y,z),new Cesium.HeadingPitchRoll(heading*Math.PI/180,0,0)),box:{dimensions:new Cesium.Cartesian3(w,d,h),material:Cesium.Color.fromCssColorString(color),outline:false}});
  }
  blocksPosition(world,height,radius=.25){
    if(!this.ready||!this.settings.enabled||!this.transform)return false;
    const inverse=Cesium.Matrix4.inverseTransformation(this.transform,new Cesium.Matrix4());
    const point=Cesium.Matrix4.multiplyByPoint(inverse,world,new Cesium.Cartesian3()),a=29*Math.PI/180;
    const x=point.x*Math.cos(a)-point.y*Math.sin(a),y=point.x*Math.sin(a)+point.y*Math.cos(a);
    return this.colliders.some(box=>Math.abs(x-box.x)<box.w/2+radius&&Math.abs(y-box.y)<box.d/2+radius&&point.z<box.z+box.h&&point.z+height>box.z);
  }
  label(x,y,z,text,color){
    this.data.entities.add({position:this.world(x,y,z),label:{text,font:'bold 13px monospace',fillColor:Cesium.Color.fromCssColorString(color),outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,420)}});
  }
  addProps(valid,safe){
    // Props sit beside the central route, leaving the center lane traversable.
    for(let i=0;i<valid.length;i+=4){
      const n=this.nodes[valid[i]],x=n.x+(i%8===0?2.5:-2.5),y=n.y+8,z=n.z;
      if(i%8===0){
        this.box(x,y,z,1.85,4.3,.8,'#a68032');this.box(x,y-.2,z+.8,1.55,2.0,.65,'#31423c');
        for(const side of [-1,1])for(const end of [-1,1])this.box(x+side*.87,y+end*1.35,z-.05,.3,.7,.55,'#171d1b');
        this.box(x,y+.8,z+.86,1.7,.4,.08,'#292d26');
      }else{
        this.box(x,y,z,2.7,.65,.95,'#898a70');
        for(let k=-1;k<=1;k++)this.box(x+k*.7,y-.34,z+.4,.3,.05,.35,'#b58e40');
        this.box(x+1.8,y+.5,z,.65,.65,.9,'#734d35');
      }
    }
    const x=safe.x-2.8,y=safe.y,z=safe.z;
    this.box(x,y,z,2.3,2.1,2.3,'#4b624c');
    this.box(x,y,z+2.3,2.7,2.5,.15,'#84936e');
    this.box(x+.1,y-1.08,z+.7,.8,.06,1.5,'#24342c');
    this.box(x+2,y,z,.7,.7,.65,'#9b8b5d');this.box(x+2,y+.8,z,.7,.7,.65,'#6e805c');
    this.label(x,y,z+2.6,'SUPPLIES +','#d5f678');
    const far=this.nodes[valid[valid.length-1]];
    this.label(far.x,far.y,far.z+2,'QUARANTINE / KEEP OUT','#dc9a64');
    // Flat stains are authored scenery; they do not change the scan textures.
    for(let i=0;i<8;i++){
      const n=this.nodes[valid[Math.floor(this.random()*valid.length)]];
      this.data.entities.add({position:this.world(n.x+(this.random()-.5)*2,n.y+(this.random()-.5)*4,n.z+.015),ellipse:{semiMajorAxis:.65+this.random()*.4,semiMinorAxis:.2+this.random()*.3,height:Cesium.Cartographic.fromCartesian(this.world(n.x,n.y,n.z+.015)).height,material:Cesium.Color.fromCssColorString('#662f26').withAlpha(.8)}});
    }
  }
  chooseNext(agent){
    const n=this.nodes[agent.to];
    let target=null,best=26*this.settings.characterScale;
    if(agent.infected){
      for(const other of this.agents){
        if(other.infected||other.escaped) continue;
        const d=Math.hypot(other.x-agent.x,other.y-agent.y);
        if(d<best){best=d;target=other;}
      }
    }else{
      let threat=false;
      for(const other of this.agents) if(other.infected&&Math.hypot(other.x-agent.x,other.y-agent.y)<18*this.settings.characterScale){threat=true;break;}
      if(threat){target=this.nodes[this.safeNode];agent.fleeing=true;}else agent.fleeing=false;
    }
    let choices=n.links.filter(i=>i!==agent.from);if(!choices.length)choices=n.links;
    if(target) choices=[...n.links].sort((a,b)=>Math.hypot(this.nodes[a].x-target.x,this.nodes[a].y-target.y)-Math.hypot(this.nodes[b].x-target.x,this.nodes[b].y-target.y));
    agent.from=agent.to;agent.to=target?choices[0]:choices[Math.floor(this.random()*choices.length)];agent.progress=0;
  }
  tick(){
    const now=performance.now(),dt=Math.min((now-this.last)/1000,.15);this.last=now;
    if(!this.ready||!this.settings.enabled||this.settings.paused||document.hidden)return;
    this.elapsed+=dt;let changed=false;
    for(const a of this.agents){
      if(a.escaped)continue;
      const n=this.nodes[a.from],t=this.nodes[a.to],length=Math.hypot(t.x-n.x,t.y-n.y);
      a.progress+=dt*(a.infected?a.speed:(a.fleeing?2.5:1.2))*this.settings.characterScale/Math.max(length,.01);
      if(a.progress>=1){this.chooseNext(a);continue;}
      const u=a.progress;a.x=n.x+(t.x-n.x)*u;a.y=n.y+(t.y-n.y)*u;a.z=n.z+(t.z-n.z)*u;
      a.entity.position=this.world(a.x+a.offset,a.y,a.z-.08+.08*this.settings.characterScale);
      const frame=Math.floor(this.elapsed*(a.infected?2:5)+a.id)%2;
      if(frame!==a.frame){a.frame=frame;a.entity.billboard.image=this.sprite(a.infected,a.variant,frame);}
      a.cooldown=Math.max(0,a.cooldown-dt);
      if(!a.infected){
        const safe=this.nodes[this.safeNode];
        if(a.fleeing&&Math.hypot(a.x-safe.x,a.y-safe.y)<2*this.settings.characterScale){a.escaped=true;a.entity.show=false;changed=true;continue;}
        for(const z of this.agents){
          if(z.infected&&!z.cooldown&&Math.hypot(z.x-a.x,z.y-a.y)<1.05*this.settings.characterScale){
            a.infected=true;a.cooldown=3;z.cooldown=3;
            a.entity.billboard.image=this.sprite(true,a.variant,a.frame);changed=true;break;
          }
        }
      }
      a.entity.name=a.infected?'Infected pedestrian':'Survivor';
    }
    if(changed)this.updateStats();
    this.viewer.scene.requestRender();
  }
  updateStats(){
    const zombies=this.agents.filter(a=>a.infected).length;
    const survivors=this.agents.filter(a=>!a.infected&&!a.escaped).length;
    const escaped=this.agents.filter(a=>a.escaped).length;
    document.getElementById('zombieCount').textContent=zombies;
    document.getElementById('survivorCount').textContent=survivors;
    const p=OutbreakMath.population(this.settings.remaining);
    document.getElementById('populationCount').textContent=`${p.estimated} estimated · ${this.agents.length} simulated${p.estimated>200?' (200 actor limit)':''}${escaped?` · ${escaped} reached supplies`:''}`;
  }
}
