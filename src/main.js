import * as THREE from 'three';
import { createViewer } from './scene.js';
import { createUI } from './ui.js';
import { generateTree, disposeTree } from './tree/generate.js';
import {
  DEFAULTS,
  PARAM_META,
  PRESETS,
  buildShareUrl,
  clampParam,
  cleanPresetName,
  createCustomPreset,
  decodeState,
  getPreset,
  loadCustomPresets,
  parsePresetFile,
  saveCustomPresets,
  serializePresets,
} from './state.js';
import { randomSeed } from './rng.js';

const fromUrl = decodeState(window.location.hash.slice(1));
// A shared link loads its state into the studio, then the hash is stripped so
// the address bar keeps the clean site URL.
clearUrlState();
const reference = getPreset('reference');
let customPresets = loadCustomPresets();

function findPreset(id) {
  if (!id) return null;
  return customPresets.find((preset) => preset.id === id) ?? PRESETS.find((preset) => preset.id === id) ?? null;
}

const initialPresetId = fromUrl
  ? findPreset(fromUrl.presetId)
    ? fromUrl.presetId
    : null
  : 'reference';

const state = {
  params: fromUrl ? { ...fromUrl.params } : { ...reference.params },
  presetId: initialPresetId,
  basePresetId: initialPresetId ?? 'reference',
};

const VIEW_STORAGE_KEY = 'canopytree-view-v1';

function normalizeView(input = {}) {
  return {
    hideLeaves: Boolean(input.hideLeaves),
    hideBranches: Boolean(input.hideBranches),
    shading: input.shading === 'gray' || input.shading === 'wire' ? input.shading : 'natural',
  };
}

function loadView() {
  try {
    return normalizeView(JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) || '{}'));
  } catch {
    return normalizeView();
  }
}

let view = loadView();

const viewport = document.getElementById('viewport');
let viewer;
try {
  viewer = createViewer(viewport);
} catch (error) {
  console.error(error);
  viewport.innerHTML = `
    <div class="webgl-error">
      <h1>CanopyTree needs WebGL</h1>
      <p>This browser could not create a WebGL context. Try a recent version of Chrome, Edge, Firefox, or Safari with hardware acceleration enabled.</p>
    </div>`;
  throw error;
}

viewer.setSun(state.params.sunAzimuth, state.params.sunElevation, state.params.sunIntensity);
viewer.setBackdrop(state.params.backdrop);

let currentTree = null;
let rebuildTimer = null;
let pendingFrame = false;
let pendingGust = false;
let buildToken = 0;
let pendingPresetThumbnail = null;

const ui = createUI({
  getParams: () => state.params,
  getPresetId: () => state.presetId,
  onParamChange: handleParamChange,
  onSeedChange: handleSeedChange,
  onRegenerate: regenerate,
  onPresetSelect: (id) => applyPreset(id),
  onSurprise: surprise,
  onReset: resetToBase,
  onShare: async () => buildShareUrl(state.params, state.presetId),
  onExport: exportCurrent,
  onToggleTurntable: (enabled) => viewer.setAutoRotate(enabled),
  onToggleHidden: () => {},
  onThemeChange: () => applyBackdrop(),
  onSavePreset: saveCustomPreset,
  onImportPresets: importPresetFile,
  onDeletePreset: deleteCustomPreset,
  view,
  onViewChange: setViewState,
});

ui.registerFrameHandler(() => {
  if (currentTree) viewer.frame(currentTree.bounds);
});
ui.setCustomPresets(customPresets);
ui.syncParams(state.params, state.presetId);
// The theme is restored from storage inside createUI, so apply the matching
// backdrop variant once the document theme is known.
applyBackdrop();

if (import.meta.env.DEV) {
  window.__canopy = {
    get viewer() {
      return viewer;
    },
    get tree() {
      return currentTree;
    },
    get params() {
      return state.params;
    },
    get state() {
      return state;
    },
    ui,
    rebuild: regenerate,
    export: exportCurrent,
    render: () => viewer.renderOnce(),
    frame: () => {
      if (currentTree) viewer.frame(currentTree.bounds);
    },
    look: (position, target = [0, 3, 0]) => {
      viewer.camera.position.set(...position);
      viewer.controls.target.set(...target);
      viewer.controls.update();
      viewer.renderOnce();
    },
  };
}

/* ------------------------------------------------------------------ build */

function scheduleRebuild({ frame = false, gust = false, delay = 80 } = {}) {
  pendingFrame = pendingFrame || frame;
  pendingGust = pendingGust || gust;
  ui.setBusy(true);
  clearTimeout(rebuildTimer);
  const token = ++buildToken;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    // A timer rather than requestAnimationFrame: generation must still finish
    // when the tab is backgrounded or the preview pane is hidden.
    if (token === buildToken) performRebuild();
  }, delay);
}

async function performRebuild() {
  const frameTree = pendingFrame;
  const withGust = pendingGust;
  pendingFrame = false;
  pendingGust = false;
  const runToken = buildToken;

  try {
    const nextTree = await generateTree(state.params);
    if (runToken !== buildToken) {
      disposeTree(nextTree);
      return;
    }

    if (currentTree) {
      viewer.scene.remove(currentTree.group);
      disposeTree(currentTree);
    }

    currentTree = nextTree;
    viewer.scene.add(nextTree.group);
    viewer.setWindUniforms(nextTree.windUniforms);
    viewer.setWind(state.params.wind);
    applyView(nextTree);

    if (frameTree) viewer.frame(nextTree.bounds);
    applySun();
    viewer.renderOnce();

    ui.setStats(nextTree.stats);
    viewport.setAttribute('aria-busy', 'false');

    if (pendingPresetThumbnail) {
      const id = pendingPresetThumbnail;
      pendingPresetThumbnail = null;
      const preset = customPresets.find((entry) => entry.id === id);
      if (preset && !preset.thumbnail) {
        const thumbnail = capturePresetThumbnail();
        if (thumbnail) {
          preset.thumbnail = thumbnail;
          persistCustomPresets();
          ui.setPresetThumbnail(id, thumbnail);
        }
      }
    }

    if (withGust) viewer.triggerGust();

    console.info(
      `[CanopyTree] ${nextTree.stats.leaves.toLocaleString()} leaves · ${nextTree.stats.branches} limbs · ${Math.round(nextTree.stats.ms)} ms`,
    );
  } catch (error) {
    if (runToken !== buildToken) return;
    console.error(error);
    pendingPresetThumbnail = null;
    ui.setBusy(false);
    if (currentTree) ui.setStats(currentTree.stats);
    else ui.setStats({ leaves: 0, rosettes: 0, branches: 0, ms: 0 });
    ui.showToast(error?.message || 'Could not grow this tree', true);
    viewport.setAttribute('aria-busy', 'false');
  }
}

function regenerate() {
  scheduleRebuild({ frame: false, delay: 0 });
}

function handleSeedChange(seed) {
  if (state.params.seed === seed) {
    scheduleRebuild({ frame: false, delay: 0 });
    return;
  }
  if (state.presetId) state.basePresetId = state.presetId;
  state.params.seed = seed;
  scheduleRebuild({ frame: false, delay: 30 });
}

function handleParamChange(key, value, phase) {
  if (!(key in PARAM_META)) return;
  if (state.params[key] === value) {
    if (phase === 'commit' && !SCENE_ONLY_PARAMS.has(key)) {
      scheduleRebuild({ frame: false, delay: 0 });
    }
    return;
  }
  state.params[key] = value;

  if (key === 'wind') {
    viewer.setWind(value);
    return;
  }
  if (key === 'sunAzimuth' || key === 'sunElevation' || key === 'sunIntensity') {
    applySun();
    return;
  }
  if (key === 'backdrop') {
    applyBackdrop();
    return;
  }
  if (key === 'quality') {
    scheduleRebuild({ frame: false, delay: 60 });
    return;
  }
  if (key === 'voxelPreview') {
    applyView(currentTree);
    viewer.renderOnce();
    return;
  }
  // The voxel pass is expensive; wait for the slider release before rebuilding.
  if ((key === 'voxelDepth' || key === 'voxelResolution' || key === 'voxelMeshDetail') && phase === 'live') {
    return;
  }

  if (state.presetId) {
    state.basePresetId = state.presetId;
    state.presetId = null;
  }
  ui.setActivePreset(null);
  scheduleRebuild({ frame: false, delay: phase === 'live' ? 110 : 55 });
}

const SCENE_ONLY_PARAMS = new Set(['wind', 'sunAzimuth', 'sunElevation', 'sunIntensity', 'backdrop', 'quality']);

function applySun() {
  viewer.setSun(state.params.sunAzimuth, state.params.sunElevation, state.params.sunIntensity);
}

function applyBackdrop() {
  // The swatch picks the mood; the document theme picks the light or dark
  // variant so the canvas always belongs to the surrounding interface.
  const dark = document.documentElement.dataset.theme === 'dark';
  viewer.setBackdrop(state.params.backdrop, dark);
}

/* ----------------------------------------------------------- view modes */

function snapshotViewMaterials(tree) {
  const entries = [
    { material: tree.bark.material, leaf: false },
    { material: tree.foliage.core.material, leaf: false },
    { material: tree.foliage.material, leaf: true },
  ];
  return entries.map(({ material, leaf }) => ({
    material,
    leaf,
    color: material.color.clone(),
    map: material.map,
    bumpMap: 'bumpMap' in material ? material.bumpMap : null,
    normalMap: 'normalMap' in material ? material.normalMap : null,
    vertexColors: material.vertexColors,
    wireframe: material.wireframe,
  }));
}

function setViewState(next) {
  view = normalizeView({ ...view, ...next });
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* storage can be unavailable */
  }
  applyView(currentTree);
  viewer.renderOnce();
}

function applyView(tree) {
  if (!tree) return;
  if (!tree.viewOriginals) tree.viewOriginals = snapshotViewMaterials(tree);

  // Restore the authored materials first, then layer the preview mode on top.
  for (const record of tree.viewOriginals) {
    const material = record.material;
    material.color.copy(record.color);
    if (material.map !== record.map) {
      material.map = record.map;
      material.needsUpdate = true;
    }
    if ('bumpMap' in material && material.bumpMap !== record.bumpMap) {
      material.bumpMap = record.bumpMap;
      material.needsUpdate = true;
    }
    if ('normalMap' in material && material.normalMap !== record.normalMap) {
      material.normalMap = record.normalMap;
      material.needsUpdate = true;
    }
    if (material.vertexColors !== record.vertexColors) {
      material.vertexColors = record.vertexColors;
      material.needsUpdate = true;
    }
    material.wireframe = record.wireframe;
  }

  if (view.shading === 'gray' || view.shading === 'wire') {
    const wire = view.shading === 'wire';
    const tint = new THREE.Color(wire ? '#8fae67' : '#b8bbb3');
    for (const record of tree.viewOriginals) {
      const material = record.material;
      material.color.copy(tint);
      material.wireframe = wire;
      if (record.leaf) {
        // The leaf map stays for its alpha cutout and grayscale shading.
        material.vertexColors = false;
      } else {
        material.map = null;
        if ('bumpMap' in material) material.bumpMap = null;
        if ('normalMap' in material) material.normalMap = null;
      }
      material.needsUpdate = true;
    }
  }

  tree.foliage.mesh.visible = !view.hideLeaves;
  tree.foliage.core.mesh.visible = !view.hideLeaves;
  const showVoxels = Boolean(
    state.params.voxelize && state.params.voxelPreview && tree.bark.voxelMesh,
  );
  tree.bark.mesh.visible = !view.hideBranches && !showVoxels;
  if (tree.bark.voxelMesh) {
    tree.bark.voxelMesh.visible = !view.hideBranches && showVoxels;
  }
}

/**
 * Run a capture against the authored tree, then put the preview mode back.
 * The view toggles are an inspection aid and must not leak into exports.
 */
function withNaturalPreview(task) {
  const saved = view;
  const savedVoxelPreview = state.params.voxelPreview;
  const overridden =
    saved.hideLeaves ||
    saved.hideBranches ||
    saved.shading !== 'natural' ||
    savedVoxelPreview;
  if (!overridden) return task();
  view = normalizeView();
  if (savedVoxelPreview) state.params.voxelPreview = false;
  applyView(currentTree);
  try {
    return task();
  } finally {
    view = saved;
    state.params.voxelPreview = savedVoxelPreview;
    applyView(currentTree);
    viewer.renderOnce();
  }
}

/**
 * Frame the tree for the export aspect, capture it, then put the user's live
 * camera back exactly as it was. Unlike pressing F, exporting centered must not
 * disturb the orbit the user has composed on screen.
 */
function captureCenteredPng(options) {
  const camera = viewer.camera;
  const controls = viewer.controls;
  const savedPosition = camera.position.clone();
  const savedTarget = controls.target.clone();
  const savedNear = camera.near;
  const savedFar = camera.far;
  const savedAspect = camera.aspect;
  const savedViewBox = viewer.getViewBox().clone();

  try {
    // frame() measures the horizontal FOV, so match the output aspect first.
    camera.aspect = options.width / options.height;
    camera.updateProjectionMatrix();
    viewer.frame(currentTree.bounds);
    return viewer.capture({
      scale: options.scale,
      width: options.width,
      height: options.height,
      transparent: options.transparent,
    });
  } finally {
    camera.position.copy(savedPosition);
    camera.near = savedNear;
    camera.far = savedFar;
    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
    controls.target.copy(savedTarget);
    controls.update();
    viewer.getViewBox().copy(savedViewBox);
    viewer.renderOnce();
  }
}

async function exportCurrent(format, options = {}) {
  if (format === 'png') {
    // View modes are an inspection aid. Exports always use the authored look.
    return withNaturalPreview(() => {
      const canCenter =
        options.center && currentTree && Number.isFinite(options.width) && Number.isFinite(options.height);
      if (canCenter) return captureCenteredPng(options);
      return viewer.capture({
        scale: options.scale,
        width: options.width,
        height: options.height,
        transparent: options.transparent,
      });
    });
  }
  if (!currentTree) throw new Error('The tree is still growing');
  const { exportTreeGLB } = await import('./export.js');
  return exportTreeGLB(currentTree);
}

function applyPreset(id) {
  const preset = findPreset(id);
  if (!preset) return;
  const customPreset = customPresets.find((entry) => entry.id === id);
  pendingPresetThumbnail = customPreset && !customPreset.thumbnail ? id : null;
  const preserve = {
    backdrop: state.params.backdrop,
    quality: state.params.quality,
  };
  state.params = {
    ...preset.params,
    ...preserve,
  };
  state.presetId = id;
  state.basePresetId = id;
  viewer.setWind(state.params.wind);
  applySun();
  ui.syncParams(state.params, state.presetId);
  scheduleRebuild({ frame: true, gust: true, delay: 0 });
}

function resetToBase() {
  applyPreset(state.basePresetId ?? 'reference');
}

/* --------------------------------------------------------- custom presets */

function uniqueCustomName(name) {
  const base = cleanPresetName(name);
  let candidate = base;
  let suffix = 2;
  const taken = new Set(customPresets.map((preset) => preset.name.toLowerCase()));
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function persistCustomPresets() {
  if (!saveCustomPresets(customPresets)) {
    ui.showToast('This browser is out of preset storage', true);
  }
}

/** Crop the live canvas into a compact thumbnail for the rail. */
function capturePresetThumbnail() {
  const bark = currentTree?.bark;
  const voxel = bark?.voxelMesh;
  const voxelVisible = voxel?.visible ?? false;
  const barkVisible = bark?.mesh.visible ?? false;
  try {
    // The saved look is the remeshed tree, never the diagnostic voxel shell.
    if (voxel) voxel.visible = false;
    if (bark?.mesh) bark.mesh.visible = true;
    viewer.renderOnce();
    const source = viewer.renderer.domElement;
    const width = 240;
    const height = 262;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const targetAspect = width / height;
    const sourceAspect = source.width / Math.max(1, source.height);
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    if (sourceAspect > targetAspect) {
      sw = source.height * targetAspect;
      sx = (source.width - sw) / 2;
    } else {
      sh = source.width / targetAspect;
      sy = (source.height - sh) * 0.5;
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (error) {
    console.warn('Could not capture a preset thumbnail', error);
    return null;
  } finally {
    if (voxel) voxel.visible = voxelVisible;
    if (bark?.mesh) bark.mesh.visible = barkVisible;
    viewer.renderOnce();
  }
}

function presetFileSlug(name) {
  const slug = cleanPresetName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'canopytree-preset';
}

function downloadPresetJson(preset) {
  const blob = new Blob([serializePresets([preset])], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${presetFileSlug(preset.name)}.canopytree.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function saveCustomPreset(name, { download = false } = {}) {
  pendingPresetThumbnail = null;
  const preset = createCustomPreset({
    name: uniqueCustomName(name),
    params: state.params,
    thumbnail: capturePresetThumbnail(),
  });
  customPresets.push(preset);
  persistCustomPresets();
  state.presetId = preset.id;
  state.basePresetId = preset.id;
  ui.setCustomPresets(customPresets);
  ui.setActivePreset(preset.id);
  if (download) downloadPresetJson(preset);
  return preset;
}

async function importPresetFile(file) {
  const text = await file.text();
  const entries = parsePresetFile(text);
  const added = [];
  for (const entry of entries) {
    const preset = createCustomPreset({
      name: uniqueCustomName(entry.name),
      params: entry.params,
    });
    customPresets.push(preset);
    added.push(preset);
  }
  persistCustomPresets();
  ui.setCustomPresets(customPresets);
  return added;
}

function deleteCustomPreset(id) {
  const index = customPresets.findIndex((preset) => preset.id === id);
  if (index < 0) return;
  customPresets.splice(index, 1);
  persistCustomPresets();
  if (state.presetId === id) {
    state.presetId = null;
  }
  if (state.basePresetId === id) state.basePresetId = 'reference';
  ui.setCustomPresets(customPresets);
  ui.setActivePreset(state.presetId);
}

function surprise() {
  const candidates = PRESETS;
  const preset = candidates[Math.floor(Math.random() * candidates.length)];
  const params = {
    ...preset.params,
    seed: randomSeed(),
    backdrop: state.params.backdrop,
    quality: state.params.quality,
  };

  const jitter = (key, amount) => {
    params[key] = clampParam(key, params[key] + (Math.random() * 2 - 1) * amount);
  };
  jitter('crownWidth', 0.55);
  jitter('crownHeight', 0.35);
  jitter('leafDensity', 0.18);
  jitter('lean', 0.16);
  jitter('trunkRadius', 0.035);
  jitter('leafHue', 0.045);
  jitter('wind', 0.08);

  state.params = params;
  state.presetId = null;
  state.basePresetId = preset.id;
  viewer.setWind(params.wind);
  applySun();
  ui.syncParams(params, null);
  scheduleRebuild({ frame: true, gust: true, delay: 0 });
}

/* -------------------------------------------------------------------- url */

/**
 * The studio no longer mirrors its parameters into the address bar. Shared
 * links still carry the encoded state in the hash, but once applied the hash is
 * removed so the URL stays on the clean site address. The Share button builds
 * a fresh link on demand.
 */
function clearUrlState() {
  if (!window.location.hash) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

/* ------------------------------------------------------------ interactions */

let pointerStart = null;
viewer.renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY };
});
viewer.renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerStart || event.button !== 0) return;
  const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  pointerStart = null;
  if (distance < 5) viewer.triggerGust();
});
viewer.renderer.domElement.addEventListener('pointercancel', () => {
  pointerStart = null;
});

window.addEventListener('hashchange', () => {
  // A pasted share link should load without a manual refresh.
  const next = decodeState(window.location.hash.slice(1));
  clearUrlState();
  if (!next) return;

  state.params = { ...next.params };
  state.presetId = findPreset(next.presetId) ? next.presetId : null;
  state.basePresetId = state.presetId ?? 'reference';
  viewer.setWind(state.params.wind);
  applyBackdrop();
  applySun();
  ui.syncParams(state.params, state.presetId);
  scheduleRebuild({ frame: true, gust: true, delay: 0 });
});

/* -------------------------------------------------------------- thumbnails */

function createThumbnailBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#f1f0ed');
  gradient.addColorStop(0.55, '#e9e8e4');
  gradient.addColorStop(1, '#e3e2de');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createThumbnailShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 4, 128, 128, 124);
  gradient.addColorStop(0, 'rgba(31,27,20,0.32)');
  gradient.addColorStop(0.48, 'rgba(31,27,20,0.16)');
  gradient.addColorStop(1, 'rgba(31,27,20,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let thumbnailsStarted = false;

async function generateThumbnails() {
  if (thumbnailsStarted) return;
  thumbnailsStarted = true;

  let cache = {};
  try {
    cache = JSON.parse(sessionStorage.getItem('canopytree-thumbnails-v3') || '{}');
  } catch {
    cache = {};
  }

  const missing = [];
  for (const preset of PRESETS) {
    if (cache[preset.id]) ui.setPresetThumbnail(preset.id, cache[preset.id]);
    else missing.push(preset);
  }
  if (!missing.length) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    renderer.setSize(240, 262, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
  } catch (error) {
    console.warn('Thumbnail renderer unavailable', error);
    return;
  }

  const scene = new THREE.Scene();
  const background = createThumbnailBackground();
  scene.background = background;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8b7d65, 1.3);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xfff4e2, 2.3);
  key.position.set(-4, 8, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd3e2ff, 0.7);
  fill.position.set(6, 4, -5);
  scene.add(fill);

  const shadowTexture = createThumbnailShadow();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(35, 240 / 262, 0.1, 100);
  const sphere = new THREE.Sphere();
  const direction = new THREE.Vector3(0.1, 0.08, 1).normalize();

  for (const preset of missing) {
    await new Promise((resolve) => setTimeout(resolve, 45));
    let tree;
    try {
      const params = {
        ...preset.params,
        quality: 'low',
        leafDensity: Math.min(preset.params.leafDensity, 0.9),
        wind: 0,
      };
      tree = await generateTree(params);
      scene.add(tree.group);

      tree.bounds.getBoundingSphere(sphere);
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const distance = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1;
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      camera.lookAt(sphere.center.x, sphere.center.y - sphere.radius * 0.03, sphere.center.z);

      shadow.position.set(sphere.center.x, 0.006, sphere.center.z);
      const baseRadius = Math.max(tree.bounds.max.x - tree.bounds.min.x, tree.bounds.max.z - tree.bounds.min.z);
      shadow.scale.set(baseRadius * 0.52, baseRadius * 0.34, 1);

      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      ui.setPresetThumbnail(preset.id, dataUrl);
      cache[preset.id] = dataUrl;
    } catch (error) {
      console.warn(`Could not render thumbnail for ${preset.id}`, error);
    } finally {
      if (tree) {
        scene.remove(tree.group);
        disposeTree(tree);
      }
    }
  }

  try {
    sessionStorage.setItem('canopytree-thumbnails-v3', JSON.stringify(cache));
  } catch {
    /* cache is optional */
  }

  scene.remove(shadow);
  shadow.geometry.dispose();
  shadowMaterial.dispose();
  shadowTexture.dispose();
  background.dispose();
  renderer.dispose();
}

/* ------------------------------------------------------------------- boot */

scheduleRebuild({ frame: true, delay: 0 });
window.setTimeout(generateThumbnails, 900);
