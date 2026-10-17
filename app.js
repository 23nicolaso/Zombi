/* Times Square scan experiment. No generated replacement scenery. */
'use strict';
const $ = id => document.getElementById(id);
const state = {pixels:432, outline:1.5, colors:12, decay:.2, pitch:45, heading:25, split:50, compare:false, original:false};
const presets = {
  pixel:{pixels:432,outline:1.5,colors:12,decay:.2,original:false},
  outbreak:{pixels:480,outline:1.05,colors:7,decay:.75,original:false},
  original:{pixels:640,outline:0,colors:32,decay:0,original:true}
};
let viewer, stage, currentAsset, localUrl, busy=false, sourceType=null, framingRadius=400;
let center, sourceReady=false;
let outbreak;
let player;
const shader = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float renderWidth;
uniform float edgeStrength;
uniform float colorSteps;
uniform float decay;
uniform float splitPosition;
uniform bool compare;
uniform bool original;
in vec2 v_textureCoordinates;
float eyeDepth(vec2 uv) {
  float d = czm_readDepth(depthTexture, uv);
  vec4 eye = czm_windowToEyeCoordinates(vec4(uv * czm_viewport.zw, d, 1.0));
  return abs(eye.z / eye.w);
}
void main() {
  vec2 uv = v_textureCoordinates;
  if (original || (compare && uv.x < splitPosition)) {
    out_FragColor = texture(colorTexture, uv); return;
  }
  vec2 grid = vec2(renderWidth, max(1.0, floor(renderWidth * czm_viewport.w / czm_viewport.z)));
  vec2 p = (floor(uv * grid) + 0.5) / grid;
  vec2 stepUV = 1.0 / grid;
  vec3 c = texture(colorTexture, p).rgb;
  float z = eyeDepth(p);
  float l = eyeDepth(clamp(p - vec2(stepUV.x,0.0),vec2(0.0),vec2(1.0)));
  float r = eyeDepth(clamp(p + vec2(stepUV.x,0.0),vec2(0.0),vec2(1.0)));
  float b = eyeDepth(clamp(p - vec2(0.0,stepUV.y),vec2(0.0),vec2(1.0)));
  float t = eyeDepth(clamp(p + vec2(0.0,stepUV.y),vec2(0.0),vec2(1.0)));
  // Second derivatives suppress outlines on smooth, sloping road surfaces.
  float discontinuity = max(abs(l + r - 2.0*z),abs(b + t - 2.0*z)) / max(z,1.0);
  float edge = smoothstep(0.002,0.025,discontinuity) * edgeStrength;
  float lum = dot(c, vec3(0.2126,0.7152,0.0722));
  vec3 tinted = mix(vec3(lum),c,0.58) * vec3(0.86,1.02,0.77);
  c = mix(c,tinted,decay);
  c = clamp((c - 0.5) * (1.05 + decay * 0.22) + 0.5,0.0,1.0);
  c = floor(c * (colorSteps-1.0) + 0.5) / (colorSteps-1.0);
  c = mix(c,vec3(0.035,0.055,0.045),clamp(edge,0.0,1.0));
  out_FragColor = vec4(c,1.0);
}`;

function status(text){ $('status').textContent=text; }
function message(text){ $('loadMessage').textContent=text; }
function syncControls(){
  for(const id of ['pixels','outline','colors','decay','pitch','heading','split']) $(id).value=state[id];
  $('pixelsOut').value=state.original?'Native':`${state.pixels} px`;
  $('outlineOut').value=state.outline.toFixed(2);
  $('colorsOut').value=state.colors;
  $('decayOut').value=`${Math.round(state.decay*100)}%`;
  $('pitchOut').value=`${state.pitch}°`;
  $('headingOut').value=`${state.heading}°`;
  $('comparison').hidden=!state.compare;
  $('comparison').style.left=`${state.split}%`;
  document.querySelector('.comparison-control').hidden=!state.compare;
  viewer?.scene.requestRender();
}
function frame(reset=false){
  if(!viewer || !center || !sourceReady) return;
  let range=framingRadius*2.6;
  if(!reset) range=Math.max(10,Cesium.Cartesian3.distance(viewer.camera.positionWC,center));
  viewer.camera.lookAt(center,new Cesium.HeadingPitchRange(Cesium.Math.toRadians(state.heading),-Cesium.Math.toRadians(state.pitch),range));
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}
function clearAsset(){
  player?.clear();
  outbreak?.clear();
  if(currentAsset){viewer.scene.primitives.remove(currentAsset);currentAsset=null;}
  if(localUrl){URL.revokeObjectURL(localUrl);localUrl=null;}
  sourceReady=false;
}
function setBusy(value){busy=value;$('connect').disabled=value;$('file').disabled=value;}
function loaded(type){
  sourceType=type;sourceReady=true;frame(true);$('sourceDialog').close();
  message('Scan loaded. Open this panel to change the source.');
  outbreak?.onSourceLoaded(type,center,currentAsset);
  player?.setSource(type);
}
async function loadGoogle(key){
  if(busy || !viewer) return;
  if(!key.trim()){message('Enter a Google Maps key with Map Tiles API enabled.');return;}
  setBusy(true);message('Connecting to Google 3D tiles…');status('Connecting to live photogrammetry…');
  try{
    // Use the documented Google endpoint directly; no Cesium ion token required.
    const asset=await Cesium.Cesium3DTileset.fromUrl(new Cesium.Resource({
      url:'https://tile.googleapis.com/v1/3dtiles/root.json',queryParameters:{key:key.trim()}
    }),{maximumScreenSpaceError:8,showCreditsOnScreen:true});
    clearAsset();currentAsset=viewer.scene.primitives.add(asset);
    viewer.scene.globe.show=false;
    center=Cesium.Cartesian3.fromDegrees(-73.9855,40.7580,20);framingRadius=300;
    loaded('google');status('Times Square · fetching visible scan tiles');
    let sawTiles=false;
    asset.tileVisible.addEventListener(()=>{if(!sawTiles){sawTiles=true;status('Times Square · live Google photogrammetry');}});
    asset.tileFailed.addEventListener(()=>status('A scan tile failed. Check key restrictions, quota, or connection.'));
    $('apiKey').value='';
  }catch(error){
    // SDK errors may contain the resource URL and key: do not print them.
    message('Could not load Google tiles. Check the key, Map Tiles API access, billing, localhost referrer restrictions, and your connection.');
    status(sourceReady?'Previous scan still loaded':'No scan loaded · connection failed');
  }finally{setBusy(false);}
}
async function loadFile(file){
  if(busy || !viewer || !file) return;
  if(!file.name.toLowerCase().endsWith('.glb')){message('Please select a self-contained .glb file.');return;}
  setBusy(true);message(`Opening ${file.name}…`);status('Loading local scan…');
  let pendingUrl;
  try{
    pendingUrl=URL.createObjectURL(file);
    const asset=await Cesium.Model.fromGltfAsync({url:pendingUrl,
      modelMatrix:Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(-73.9855,40.7580,0)),
      credit:new Cesium.Credit('Local GLB — retain the scan provider’s required attribution'),
      showCreditsOnScreen:true});
    clearAsset();localUrl=pendingUrl;pendingUrl=null;
    currentAsset=viewer.scene.primitives.add(asset);
    viewer.scene.globe.show=false;
    // Bounding sphere is reliable once Cesium has updated the first render frame.
    const onReady=()=>{
      center=Cesium.Cartesian3.clone(asset.boundingSphere.center);
      framingRadius=Math.max(asset.boundingSphere.radius,5);
      loaded('local');status(`Local scan · ${file.name}`);
    };
    if(asset.ready) onReady();else asset.readyEvent.addEventListener(onReady);
    viewer.scene.requestRender();
  }catch(error){
    if(pendingUrl) URL.revokeObjectURL(pendingUrl);
    message('Could not open the model. Export a valid GLB with embedded geometry and textures. Try a smaller crop if your GPU runs out of memory.');
    status(sourceReady?'Previous scan still loaded':'No scan loaded · model failed');
  }finally{setBusy(false);$('file').value='';}
}
function init(){
  if(!window.Cesium){message('Cesium could not download. Connect to the internet and reload this page.');status('Renderer unavailable · CDN could not load');return;}
  let startupStep='creating the WebGL viewer';
  try{
    Cesium.Ion.defaultAccessToken='';
    viewer=new Cesium.Viewer('viewport',{
      baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,
      sceneModePicker:false,navigationHelpButton:false,animation:false,timeline:false,
      fullscreenButton:false,selectionIndicator:false,infoBox:false,
      skyBox:false,skyAtmosphere:false,requestRenderMode:true,
      contextOptions:{webgl:{preserveDrawingBuffer:false}}
    });
    startupStep='configuring the scene';
    viewer.scene.backgroundColor=Cesium.Color.fromCssColorString('#17211b');
    viewer.scene.globe.show=false;
    // skyBox:false also omits the Sun and Moon primitives.
    if(viewer.scene.sun) viewer.scene.sun.show=false;
    if(viewer.scene.moon) viewer.scene.moon.show=false;
    viewer.scene.postProcessStages.fxaa.enabled=false;
    viewer.scene.highDynamicRange=false;
    viewer.clock.currentTime=Cesium.JulianDate.fromIso8601('2026-06-21T17:00:00Z');
    startupStep='installing the pixel shader';
    stage=viewer.scene.postProcessStages.add(new Cesium.PostProcessStage({
      name:'pixel-scan',fragmentShader:shader,uniforms:{
        renderWidth:()=>state.pixels,edgeStrength:()=>state.outline,colorSteps:()=>state.colors,
        decay:()=>state.decay,splitPosition:()=>state.split/100,
        compare:()=>state.compare,original:()=>state.original
      }
    }));
    viewer.scene.renderError.addEventListener(()=>{
      status('Rendering failed · reload and try a smaller scan or another browser');
      message('WebGL rendering failed. No visual result has been verified. Try reloading or use a smaller GLB.');
    });
    center=Cesium.Cartesian3.fromDegrees(-73.9855,40.7580,20);
  }catch(error){
    // Initialization runs before any API key is submitted. Expose its real error
    // instead of treating every application exception as a hardware problem.
    const detail=String(error?.message || error).slice(0,600);
    message(`Startup failed while ${startupStep}: ${detail}`);
    status(`Startup failed · ${startupStep}`);
    return;
  }
  $('googleForm').addEventListener('submit',event=>{event.preventDefault();loadGoogle($('apiKey').value);});
  $('file').addEventListener('change',()=>loadFile($('file').files[0]));
  for(const id of ['pixels','outline','colors','decay','pitch','heading','split']){
    $(id).addEventListener('input',()=>{
      state[id]=Number($(id).value);
      if(['pixels','outline','colors','decay'].includes(id)){
        state.original=false;document.querySelectorAll('[data-preset]').forEach(button=>button.classList.remove('active'));
      }
      if(['pitch','heading'].includes(id)) frame();
      syncControls();
    });
  }
  document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{
    Object.assign(state,presets[button.dataset.preset]);
    document.querySelectorAll('[data-preset]').forEach(item=>item.classList.toggle('active',item===button));syncControls();
  }));
  $('compare').addEventListener('change',()=>{state.compare=$('compare').checked;syncControls();});
  $('ortho').addEventListener('change',()=>{
    if($('ortho').checked) viewer.camera.switchToOrthographicFrustum();else viewer.camera.switchToPerspectiveFrustum();
    frame();viewer.scene.requestRender();
  });
  $('home').addEventListener('click',()=>frame(true));
  $('settings').addEventListener('click',()=>$('sourceDialog').show());
  $('closeDialog').addEventListener('click',()=>$('sourceDialog').close());
  $('save').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({version:2,location:'Times Square',source:sourceType,settings:state,outbreak:outbreak?.settings,orthographic:$('ortho').checked},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='times-square-look.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  outbreak=new OutbreakLayer(viewer);
  player=new FirstPersonPlayer(viewer,outbreak);
  $('placeOutbreak').addEventListener('click',()=>player.cancelPlacement(),true);
  syncControls();
}
init();
