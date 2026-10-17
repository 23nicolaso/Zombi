# Times Square — Pixel Scan Lab

A local rendering prototype for viewing an existing city scan through pixelation,
depth outlines, color quantization, and an apocalypse tint. It contains no invented
Times Square geometry and no bundled city scan.

## Run

From this folder:

```powershell
python serve.py
```

Open **http://localhost:8000** in a desktop browser with WebGL enabled. Internet
access is required to load CesiumJS 1.124 from its official CDN.

Choose a source:

1. **Live Google photogrammetry:** enter a Google Maps Platform key locally in the
   page. Enable Map Tiles API, configure billing, and restrict browser usage to
   your local origin as appropriate. Google requests may incur charges. No Cesium
   ion account is required. The key is not saved to files or browser storage.
2. **Local GLB:** select a self-contained binary glTF scan with embedded textures.
   The model is opened locally with a blob URL and is not uploaded. The viewer
   frames its bounding sphere automatically. Export/crop very large scans before
   loading them. Separate `.gltf` files and loose texture folders are not supported.

Candidate: [Times Square by Brian Trepanier](https://sketchfab.com/3d-models/times-square-new-york-city-ny-usa-b1cf32ba3cf040bca21900fdfed71562).
The listing advertises CC Attribution, but its capture provenance and underlying
rights have not been verified. A listing alone is not a verified source chain.
Retain attribution required by any asset you use.

## Tune together

- Pixel / Outbreak / Original presets.
- Render width controls a screen-space downsampling grid with crisp enlargement.
  The scene is still rasterized at native resolution before postprocessing; this
  first version does not claim GPU savings from the pixel effect.
- Outlines use depth discontinuities, not object separation. They can miss facade
  details and can exaggerate noisy photogrammetry; this needs visual tuning.
- Color steps are per RGB channel, not the total number of palette colors.
- Apocalypse tint changes the colors; it does not remove scanned cars or add decay.
- Split comparison uses the same camera and source image for both looks.
- Elevation, heading, orthographic projection, pan, zoom, recenter.
- Save look settings downloads a JSON file (never the API key or scan).

Google and Cesium credits remain visible outside the pixel shader. Google tiles
are streamed through the supported endpoint, not exported, packaged, or cached by
application code. See [Google policies](https://developers.google.com/maps/documentation/tile/policies).
Check applicable terms before taking this experiment into a shipped game.

## Current verification limits

The source scan could not be acquired in the authoring environment: outbound
downloads were restricted and no browser session was available. The prototype
therefore still needs a browser run with a real scan. No screenshot, shader
compilation success, scene accuracy, or performance result is claimed yet.

## Outbreak layer

Your selected Pixel preset is now the default: 432 px, outlines 1.5, 12 color
steps per channel, and 20% apocalypse tint.

The new layer adds original pixel-sprite people, abandoned yellow cars, concrete
barricades, crates, a supply shelter, quarantine signage, and ground stains.
Zombies wander and pursue nearby survivors along a hand-authored street graph.
Survivors run toward supplies when threatened; close contact spreads infection.
Pause, reset, disable the layer, change the initial infected percentage, or click
**Focus crowd** for a closer camera. The 2D sprites face the camera and participate
in depth testing with the scan; the added scenery uses 3D Cesium geometry.

The population basis is the Times Square Alliance's approximately **220,000 daily
pedestrians in 2024**, from its [market research page](https://www.timessquarenyc.org/business-community/market-research-data).
This is pedestrian flow, not a residential census or instantaneous street count.
Scenario assumptions are a 20-minute average visit, 10% share for the local patch,
and 35% remaining after the outbreak. Calculation:

`220000 × (20 / 1440) × 0.10 × 0.35 ≈ 107 actors`

The simulation caps at 200 actors. Changing remaining population or initial
infection resets the outbreak. These are scenario estimates; no actual person is
represented, and placement is synthetic.

Google tiles automatically populate a small corridor around Times Square. Heights
are sampled from the scan, disconnected patches are excluded, and large height
differences are rejected as possible rooftops. For local GLBs, choose **Place
outbreak on a street** and click visible pavement. This placement control also
works with Google tiles. The routing is approximate: it is not a scan-derived
navigation mesh, and it cannot guarantee that intermediate path segments or props
avoid every scanned obstacle. Buildings/interiors are not destructible or enterable.

GLB placement now arms automatically after loading: click visible pavement directly.
A map banner reports pick/sampling progress or errors. Placement temporarily enables
translucent depth picking and hides existing game props so they cannot intercept
the click. When local-model height sampling returns no ground or times out, the
clicked surface plane supplies an explicitly approximate fallback. Local models
use a shorter corridor based on model size. A missing surface hit leaves placement
active so another click can retry. **Cancel street placement** restores visibility.

Run `node tests/outbreak.test.cjs` for simulation regression checks. Browser
rendering and scan alignment still require visual verification in your session.

## First-person player

After loading a scan, click **Walk the streets**, then click visible street
pavement to spawn. Player and crowd size default to **20%** of their original
dimensions to fit the imported city model. **Player & crowd size** adjusts both
from 5–100%. Eye height, movement speed, collision footprint, and step limits
scale together (standing eye height is 1.72 model units at 100%).
Use WASD or arrow keys to walk, mouse to look, Shift to sprint, Ctrl to crouch,
and R to return to the spawn. Esc or **Exit walk mode** restores the overhead
camera and its projection. **Choose player spawn** lets you move the starting point.
If automatic mouse capture is unavailable, click **Capture mouse** or hold the
left mouse button and drag to look. Movement keys are cleared when focus is lost.

Ground movement uses a small footprint of scan-height samples, with limits on step
height and drops. Added cars, barricades, and crates have simple box collision.
This is approximate collision, not a full triangle-mesh capsule solver: overhangs,
vertical scan holes, and noisy geometry may block otherwise usable pavement.
There is no jumping, combat, or building-interior traversal yet.

If your GLB cannot supply ground-height samples, enable **Flat street fallback**
before entering. This explicitly allows movement on the clicked-height plane
within 30 m of the spawn when ground hits are missing. It cannot follow slopes
in those missing areas. Sampled steep obstacles and added props still block motion.
The skybox is not used as a walking surface and there is no automatic free-flight.

Run `node tests/player.test.cjs` for controller regression checks. Actual input,
pointer capture, scan alignment, and camera rendering require browser verification.
