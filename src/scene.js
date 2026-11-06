import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Rng } from './rng.js';

const BACKDROPS = {
  studio: {
    light: {
      top: '#f1ebe4',
      middle: '#e9e2da',
      bottom: '#e1d9d0',
    },
    dark: {
      top: '#343a33',
      middle: '#272b24',
      bottom: '#1c1f1a',
    },
  },
  warm: {
    light: {
      top: '#f6ede1',
      middle: '#ebddcb',
      bottom: '#e2d1ba',
    },
    dark: {
      top: '#3a3228',
      middle: '#2b241c',
      bottom: '#1f1a14',
    },
  },
  charcoal: {
    light: {
      top: '#3d433a',
      middle: '#2c3129',
      bottom: '#23271f',
    },
    dark: {
      top: '#3d433a',
      middle: '#2c3129',
      bottom: '#23271f',
    },
  },
};

function backdropPalette(kind, dark = false) {
  const entry = BACKDROPS[kind] ?? BACKDROPS.studio;
  return dark ? entry.dark : entry.light;
}

function createBackgroundTexture(kind, dark = false) {
  const palette = backdropPalette(kind, dark);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, palette.top);
  gradient.addColorStop(0.48, palette.middle);
  gradient.addColorStop(1, palette.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft falloff from the top-left, like a studio wall.
  const light = ctx.createRadialGradient(180, 210, 10, 180, 210, 700);
  light.addColorStop(0, 'rgba(255,255,255,0.16)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Soft-edged round floor that hides the buried base and fades into the sweep. */
function createFloorTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.34, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.86)');
  gradient.addColorStop(0.82, 'rgba(255,255,255,0.4)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createShadowTexture(variant = 0) {
  const rng = new Rng(`tree-studio-shadow-${variant}`);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  for (let i = 0; i < 11; i++) {
    const x = 256 + rng.range(-58, 58);
    const y = 256 + rng.range(-34, 34);
    const radius = rng.range(110, 235);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(28,24,18,${rng.range(0.06, 0.16)})`);
    gradient.addColorStop(0.55, `rgba(28,24,18,${rng.range(0.03, 0.08)})`);
    gradient.addColorStop(1, 'rgba(28,24,18,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'tree-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  let backgroundTexture = createBackgroundTexture('studio');
  scene.background = backgroundTexture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 220);
  camera.position.set(0.5, 4.4, 12);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = true;
  controls.panSpeed = 1.0;
  // Screen-space panning: the scene follows the cursor in both axes, like
  // grabbing the canvas. Ground-plane panning reads as "walking" instead.
  controls.screenSpacePanning = true;
  controls.minDistance = 3.2;
  controls.maxDistance = 28;
  controls.minPolarAngle = 0.28;
  controls.maxPolarAngle = Math.PI * 0.505;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.85;
  controls.target.set(0, 3.2, 0);

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa39a84, 0.85);
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xfff3df, 2.2);
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight(0xf1e4d2, 0.34);
  fill.position.set(10, 5, 7);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffedc6, 0.5);
  rim.position.set(2, 9, -11);
  scene.add(rim);

  const shadowGroup = new THREE.Group();
  const shadowTextureA = createShadowTexture(1);
  const shadowTextureB = createShadowTexture(2);
  const shadowMaterialA = new THREE.MeshBasicMaterial({
    map: shadowTextureA,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
  });
  const shadowMaterialB = new THREE.MeshBasicMaterial({
    map: shadowTextureB,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    toneMapped: false,
  });
  const shadowA = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterialA);
  shadowA.rotation.x = -Math.PI / 2;
  shadowA.scale.set(6.0, 3.6, 1);
  shadowA.position.set(0.3, 0.006, 0.15);
  shadowA.renderOrder = 1;
  const shadowB = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterialB);
  shadowB.rotation.x = -Math.PI / 2;
  shadowB.scale.set(2.8, 1.8, 1);
  shadowB.position.set(0.08, 0.008, 0.06);
  shadowB.renderOrder = 2;
  shadowGroup.add(shadowA, shadowB);
  scene.add(shadowGroup);

  // A matte studio floor just above the contact plane. It hides the buried
  // trunk base and gives the roots a surface to meet, then fades into the
  // backdrop so there is no horizon line.
  const floorMaterial = new THREE.MeshBasicMaterial({
    map: createFloorTexture(),
    color: backdropPalette('studio').middle,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.renderOrder = 0;
  scene.add(floor);

  let viewBox = new THREE.Box3(new THREE.Vector3(-3.5, 0, -3.5), new THREE.Vector3(3.5, 7, 3.5));

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function setSun(azimuthDegrees, elevationDegrees, intensity) {
    const azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
    const elevation = THREE.MathUtils.degToRad(elevationDegrees);
    const distance = 18;
    key.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance + viewBox.getCenter(new THREE.Vector3()).y,
      Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    key.target.position.set(0, viewBox.getCenter(new THREE.Vector3()).y * 0.72, 0);
    key.target.updateMatrixWorld();
    key.intensity = intensity;
  }

  function setBackdrop(kind, dark = false) {
    const previousBackground = backgroundTexture;
    backgroundTexture = createBackgroundTexture(kind, dark);
    scene.background = backgroundTexture;
    previousBackground?.dispose();
    const palette = backdropPalette(kind, dark);
    floorMaterial.color.set(palette.middle);
    const darkScene = dark || kind === 'charcoal';
    if (darkScene) {
      shadowMaterialA.opacity = 0.4;
      shadowMaterialB.opacity = 0.5;
      hemisphere.color.set('#d9e4d4');
      hemisphere.groundColor.set('#1d211b');
    } else {
      shadowMaterialA.opacity = 0.55;
      shadowMaterialB.opacity = 0.65;
      hemisphere.color.set('#ffffff');
      hemisphere.groundColor.set('#a39a84');
    }
  }

  function frame(box) {
    if (!box || box.isEmpty()) return;
    viewBox.copy(box);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const limiting = Math.min(vFov, hFov);
    const distance = (sphere.radius / Math.sin(limiting / 2)) * 0.92;
    const target = sphere.center.clone();
    target.y -= sphere.radius * 0.06;

    controls.target.copy(target);
    const direction = new THREE.Vector3(0.05, 0.025, 1).normalize();
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.near = Math.max(0.1, distance * 0.04);
    camera.far = distance * 8;
    camera.updateProjectionMatrix();
    controls.update();
  }

  let windUniforms = [];
  let gust = 0;

  function setWindUniforms(uniforms) {
    windUniforms = uniforms ?? [];
  }

  function setWind(value) {
    for (const uniforms of windUniforms) uniforms.uWind.value = value;
  }

  function triggerGust() {
    gust = 1;
  }

  let running = true;
  let lastTime = performance.now();
  const clock = { elapsed: 0 };

  function animate(now) {
    if (!running) return;
    requestAnimationFrame(animate);
    const delta = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    clock.elapsed += delta;
    controls.update();
    gust *= Math.exp(-delta * 2.15);
    for (const uniforms of windUniforms) {
      uniforms.uTime.value = clock.elapsed;
      uniforms.uGust.value = gust;
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  function setAutoRotate(value) {
    controls.autoRotate = Boolean(value);
    controls.autoRotateSpeed = 0.65;
  }

  /** Draw one frame immediately, even when the animation loop is suspended. */
  function renderOnce() {
    renderer.render(scene, camera);
  }

  function setHidden(hidden) {
    running = !hidden;
    if (!hidden) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  }

  function capture({ scale = 2, width = null, height = null, transparent = false } = {}) {
    const viewWidth = Math.max(1, container.clientWidth);
    const viewHeight = Math.max(1, container.clientHeight);
    const fixed = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    const outputWidth = fixed ? Math.round(width) : viewWidth * scale;
    const outputHeight = fixed ? Math.round(height) : viewHeight * scale;
    const outputAspect = fixed ? outputWidth / outputHeight : viewWidth / viewHeight;
    const oldBackground = scene.background;
    const shadowVisible = shadowGroup.visible;
    const floorVisible = floor.visible;
    const oldSize = new THREE.Vector2();
    renderer.getSize(oldSize);
    const oldRatio = renderer.getPixelRatio();

    renderer.setPixelRatio(1);
    renderer.setSize(outputWidth, outputHeight, false);
    camera.aspect = outputAspect;
    camera.updateProjectionMatrix();

    if (transparent) {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      shadowGroup.visible = false;
      floor.visible = false;
    }

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');

    scene.background = oldBackground;
    shadowGroup.visible = shadowVisible;
    floor.visible = floorVisible;
    renderer.setPixelRatio(oldRatio);
    renderer.setSize(viewWidth, viewHeight, false);
    camera.aspect = viewWidth / viewHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return dataUrl;
  }

  return {
    renderer,
    scene,
    camera,
    controls,
    shadowGroup,
    floor,
    resize,
    frame,
    setSun,
    setBackdrop,
    setWindUniforms,
    setWind,
    triggerGust,
    setAutoRotate,
    setHidden,
    renderOnce,
    capture,
    getViewBox: () => viewBox,
    dispose: () => {
      running = false;
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}
