import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, hashString } from '../rng.js';
import { createNoise } from '../noise.js';

const TAU = Math.PI * 2;
const LEAF_LENGTH = 0.52;
const LEAF_HALF_WIDTH = 0.152;

const QUALITY = {
  low: { rosettes: 250, leafRows: 4 },
  medium: { rosettes: 440, leafRows: 5 },
  high: { rosettes: 620, leafRows: 7 },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** True when a sampled lobe point has been swallowed by another lobe. */
function isBuried(crown, cluster, selected, point) {
  for (const other of crown.clusters) {
    const margin = other === cluster ? 1.0 : 1.02;
    for (const lobe of other.lobes) {
      if (lobe === selected) continue;
      const dx = (point.x - lobe.center.x) / (lobe.radii.x * margin);
      const dy = (point.y - lobe.center.y) / (lobe.radii.y * margin);
      const dz = (point.z - lobe.center.z) / (lobe.radii.z * margin);
      if (dx * dx + dy * dy + dz * dz < 1) return true;
    }
  }
  return false;
}

/**
 * A painted ovate leaf. The silhouette lives in the texture, so leaves stay
 * smooth and readable at any distance instead of turning into hard triangles.
 */
function createLeafTexture() {
  const width = 160;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const path = new Path2D();
  path.moveTo(80, 250);
  path.bezierCurveTo(46, 232, 18, 190, 14, 148);
  path.bezierCurveTo(10, 100, 34, 44, 80, 8);
  path.bezierCurveTo(126, 44, 150, 100, 146, 148);
  path.bezierCurveTo(142, 190, 114, 232, 80, 250);
  path.closePath();

  ctx.fillStyle = '#ffffff';
  ctx.fill(path);

  // Shade inside the leaf only.
  ctx.save();
  ctx.clip(path);

  const vertical = ctx.createLinearGradient(0, 256, 0, 0);
  vertical.addColorStop(0, 'rgba(146,154,132,1)');
  vertical.addColorStop(0.45, 'rgba(204,212,186,1)');
  vertical.addColorStop(1, 'rgba(242,247,224,1)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);

  // Soft light pooling on the upper-left half of the blade.
  const glow = ctx.createRadialGradient(58, 84, 6, 58, 84, 150);
  glow.addColorStop(0, 'rgba(255,255,255,0.22)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Midrib and side veins.
  ctx.strokeStyle = 'rgba(150,160,140,0.42)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(80, 240);
  ctx.quadraticCurveTo(78, 130, 80, 22);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(150,160,140,0.3)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 6; i++) {
    const y = 58 + i * 31;
    const spread = 30 - Math.abs(i - 2.4) * 4;
    ctx.beginPath();
    ctx.moveTo(80, y + 12);
    ctx.quadraticCurveTo(80 - spread * 0.55, y - 4, 80 - spread, y - 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(80, y + 12);
    ctx.quadraticCurveTo(80 + spread * 0.55, y - 4, 80 + spread, y - 18);
    ctx.stroke();
  }

  // Darker rim keeps leaf edges from dissolving into the canopy.
  ctx.strokeStyle = 'rgba(120,132,108,0.38)';
  ctx.lineWidth = 5;
  ctx.stroke(path);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A curved card whose UVs map the painted leaf texture. */
function createLeafGeometry(rows, curl = 0.3, fold = 0) {
  const amount = clamp(curl, 0, 1);
  // Fold is pinned at the base: the stem stays attached to the branch and the
  // bend builds along the blade toward the tip. Nothing rotates at t = 0, so
  // the base row stays exactly where the branch attaches it.
  const foldAngle = clamp(fold, 0, 1) * 0.6;
  // The fold is a circular arc whose curvature grows from zero at the base to
  // `foldAngle` at the tip. Integrating the tangent along the midrib keeps the
  // blade's arc length intact, so the leaf swings away from its pinned base
  // instead of shrinking or bunching up as it would if each row rotated about
  // the root.
  const curvature = foldAngle / LEAF_LENGTH;
  const flat = Math.abs(curvature) < 1e-6;
  // Cup across the width and bend along the length. Tuned so the default 0.3
  // reproduces the original card exactly, while 0 lies almost flat and 1 gives
  // a strongly cupped, tip-curled blade.
  const edgeCup = 0.007 + amount * 0.07;
  const lengthBend = amount * amount * 0.12;
  const sections = Math.max(4, rows);
  const columns = 5;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const angle = foldAngle * t;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const arc = t * LEAF_LENGTH;
    // Centerline of the bent midrib (zero at the base, t = 1 at the tip).
    const coreY = flat ? arc : Math.sin(curvature * arc) / curvature;
    const coreZ = flat ? 0 : (Math.cos(curvature * arc) - 1) / curvature;
    for (let j = 0; j < columns; j++) {
      const u = (j / (columns - 1)) * 2 - 1;
      const edge = Math.abs(u);
      const x = u * LEAF_HALF_WIDTH;
      const bladeZ = 0.01 * (1 - edge) - edgeCup * Math.pow(edge, 1.6) - lengthBend * t * t;
      // The blade's local depth rides the rotated frame, so the cup and tip
      // curl follow the fold rather than fighting it.
      const y = coreY + bladeZ * sin;
      const z = coreZ + bladeZ * cos;
      positions.push(x, y, z);
      uvs.push((u + 1) * 0.5, t);
      const shade = 0.92 + t * 0.08;
      colors.push(shade, shade, shade);
    }
  }

  for (let i = 0; i < sections; i++) {
    for (let j = 0; j < columns - 1; j++) {
      const a = i * columns + j;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeBasis(normal) {
  const n = normal.clone().normalize();
  const helper = Math.abs(n.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3().crossVectors(helper, n).normalize();
  const b = new THREE.Vector3().crossVectors(n, t).normalize();
  return { n, t, b };
}

function leafHue(params, exposure, variation) {
  const base = params.leafHue < 0 ? 78 + params.leafHue * 80 : 78 + params.leafHue * 36;
  return base + (1 - exposure) * 16 + variation;
}

function createFollicleMaterial(params, uniforms, map) {
  const leafMaterial = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.45,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const windUniforms = {
    uTime: { value: 0 },
    uWind: { value: params.wind },
    uGust: { value: 0 },
  };
  uniforms.push(windUniforms);

  leafMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.uniforms.uGust = windUniforms.uGust;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWind;
        uniform float uGust;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swayPhase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].y * 2.3 + instanceMatrix[3].z * 1.1;
          float bendAmount = clamp(position.y * 1.42, 0.0, 1.0);
          bendAmount *= bendAmount;
          float sway = sin(uTime * 1.9 + swayPhase) * 0.075 + sin(uTime * 3.3 + swayPhase * 1.7) * 0.034;
          sway *= uWind;
          sway += sin(uTime * 7.3 + swayPhase * 2.1) * uGust * 0.1;
          transformed.x += sway * bendAmount;
          transformed.z += cos(uTime * 1.4 + swayPhase * 1.3) * uWind * 0.038 * bendAmount;
        #endif`,
      );
  };

  leafMaterial.customProgramCacheKey = () => 'tree-leaf-wind-v1';
  return leafMaterial;
}

export function createFoliage(params, skeleton, seed) {
  const quality = QUALITY[params.quality] ?? QUALITY.high;
  const rng = new Rng(`${seed}:foliage`);
  const noise = createNoise(`${seed}:foliage-noise`);
  const crown = skeleton.crown;
  const azimuth = THREE.MathUtils.degToRad(params.sunAzimuth);
  const elevation = THREE.MathUtils.degToRad(params.sunElevation);
  const sunDirection = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();

  const totalRosettes = Math.max(48, Math.round(quality.rosettes * params.leafDensity));

  // Coverage is the share of leaves that receive a deformation. The per-leaf
  // decision comes from the stateless noise field, not the rng stream, so
  // changing coverage never reshuffles the rest of the foliage layout.
  const coverage = {
    droop: clamp((params.leafDroopApply ?? 100) / 100, 0, 1),
    curl: clamp((params.leafCurlApply ?? 100) / 100, 0, 1),
    fold: clamp((params.leafFoldApply ?? 100) / 100, 0, 1),
    alignment: clamp((params.leafAlignmentApply ?? 100) / 100, 0, 1),
    gravity: clamp((params.leafGravityApply ?? 100) / 100, 0, 1),
  };
  // A small integer hash keeps the split uniform and independent per setting.
  // It is seeded once so different trees vary, but it never touches the rng
  // stream that lays out the foliage.
  const coverageSeed = hashString(`${seed}:foliage-coverage`);
  const coverageHash = (leafIndex, salt) => {
    let h = (coverageSeed + Math.imul(leafIndex + 1, 0x9e3779b1) + Math.imul(salt, 0x85ebca6b)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const SALT = { droop: 1, curl: 2, fold: 3, alignment: 4, gravity: 5 };
  const covers = (leafIndex, salt, amount) => {
    if (amount >= 1) return true;
    if (amount <= 0) return false;
    return coverageHash(leafIndex, salt) < amount;
  };

  const anchors = [];
  const rayDirection = new THREE.Vector3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const fork = skeleton.trunk.fork;

  // Rosettes are placed on individual lobes, then culled where that lobe is
  // buried inside a neighbour. Sampling the union instead paints a continuous
  // shell; sampling exposed caps leaves real seams, so each cluster reads as
  // its own rounded mass with dark crevices between them.
  for (const cluster of crown.clusters) {
    const entries = cluster.lobes.map((lobe) => ({
      lobe,
      area: lobe.radii.x * lobe.radii.y + lobe.radii.y * lobe.radii.z + lobe.radii.z * lobe.radii.x,
    }));
    const clusterArea = entries.reduce((sum, entry) => sum + entry.area, 0);
    const share = Math.max(10, Math.round((totalRosettes * clusterArea) / crown.totalLobeArea));
    const attempts = Math.round(share * 1.9);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const phase = cluster.phase + rng.range(0, TAU);
    const clusterTint = noise.n01(cluster.center.x * 0.37 + 4.1, cluster.center.y * 0.37, cluster.center.z * 0.37);
    const frontness = clamp(cluster.center.z / (crown.halfW * 0.8), -1, 1);
    const clusterExposure = frontness * 0.07 + (cluster.center.y - crown.center.y) / (crown.halfH * 2) * 0.08;

    for (let i = 0; i < attempts; i++) {
      // Pick one lobe, weighted by surface area.
      let pick = rng.float() * clusterArea;
      let selected = entries[entries.length - 1].lobe;
      for (const entry of entries) {
        pick -= entry.area;
        if (pick <= 0) {
          selected = entry.lobe;
          break;
        }
      }

      const y = 1 - ((i + 0.5) / attempts) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = i * goldenAngle + phase;
      rayDirection
        .set(
          Math.cos(angle) * ring + rng.range(-0.05, 0.05),
          y + rng.range(-0.04, 0.04),
          Math.sin(angle) * ring + rng.range(-0.05, 0.05),
        )
        .normalize();

      point.set(
        selected.center.x + rayDirection.x * selected.radii.x,
        selected.center.y + rayDirection.y * selected.radii.y,
        selected.center.z + rayDirection.z * selected.radii.z,
      );
      normal.set(
        (point.x - selected.center.x) / (selected.radii.x * selected.radii.x),
        (point.y - selected.center.y) / (selected.radii.y * selected.radii.y),
        (point.z - selected.center.z) / (selected.radii.z * selected.radii.z),
      ).normalize();

      // Reject the buried part of the lobe, including where neighbouring
      // lobes of the same cluster swallow it.
      if (isBuried(crown, cluster, selected, point)) continue;

      // Keep a window open in front of the fork. The limbs then read against
      // the shaded back of the canopy instead of disappearing into a green
      // wall, which is the strongest structural cue in the reference.
      if (point.z > 0.15 && normal.z > 0.05) {
        const fx = (point.x - fork.x) / 0.92;
        const fy = (point.y - (fork.y + 0.6)) / 0.92;
        if (fx * fx + fy * fy < 1) continue;
      }

      const lump = noise.fbm(
        point.x * 0.85 + cluster.phase,
        point.y * 0.85,
        point.z * 0.85,
        2,
      );
      point.addScaledVector(normal, 0.012 + params.scallop * lump * 0.05);

      let crowd = 0;
      for (const other of crown.clusters) {
        const ownCluster = other === cluster;
        for (const lobe of other.lobes) {
          if (lobe === selected) continue;
          const dx = (point.x - lobe.center.x) / lobe.radii.x;
          const dy = (point.y - lobe.center.y) / lobe.radii.y;
          const dz = (point.z - lobe.center.z) / lobe.radii.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const reach = ownCluster ? 1.2 : 1.35;
          if (distance < reach) crowd = Math.max(crowd, 1 - distance / reach);
        }
      }

      const size =
        (0.84 + noise.n01(point.x * 0.72, point.y * 0.72, point.z * 0.72) * 0.28) *
        rng.range(0.88, 1.12);
      const leafCount = clamp(Math.round(params.rosetteLeaves + rng.int(-1, 1)), 4, 14);
      // Each clump gets its own light gradient: bright crown, shaded underside.
      // This is what makes stacked leaf masses read as separate balls.
      const localY = clamp((point.y - cluster.center.y) / Math.max(0.001, cluster.radii.y), -1.2, 1.2);

      anchors.push({
        position: point.clone(),
        normal: normal.clone(),
        size,
        leafCount,
        kind: 'cluster',
        exposureOffset: -crowd * 0.3 + clusterExposure + (clusterTint - 0.5) * 0.14 + localY * 0.15,
        hueShift: (clusterTint - 0.5) * 18 + rng.range(-3.5, 3.5),
      });
    }
  }

  let totalLeaves = 0;
  for (const anchor of anchors) totalLeaves += anchor.leafCount;

  // A second, sparser layer of rosettes sits at the outer branch tips. Real
  // trees put their youngest, brightest leaves there, and these stars give the
  // canopy its characteristic sprigged silhouette.
  const tips = skeleton.tips ?? [];
  for (const tip of tips) {
    const outward = tip.position.clone().sub(crown.center);
    const distance = outward.length();
    if (distance < crown.halfW * 0.66) continue;
    if (tip.position.y < crown.crownBottom + 0.35) continue;

    const normal = tip.direction.clone();
    normal.y += 0.4;
    normal.normalize();
    const position = tip.position.clone().addScaledVector(normal, 0.05);
    if (position.z > 0.15 && normal.z > 0.05) {
      const fx = (position.x - fork.x) / 0.92;
      const fy = (position.y - (fork.y + 0.6)) / 0.92;
      if (fx * fx + fy * fy < 1) continue;
    }
    const size = rng.range(1.05, 1.3);
    const leafCount = clamp(Math.round(params.rosetteLeaves * 0.8 + rng.int(-1, 1)), 4, 10);

    anchors.push({
      position,
      normal,
      size,
      leafCount,
      kind: 'tip',
      exposureOffset: 0.14,
      hueShift: rng.range(-5, 5),
    });
    totalLeaves += leafCount;
  }

  const variantCounts = [0, 0, 0, 0];
  for (let leafIndex = 0; leafIndex < totalLeaves; leafIndex++) {
    const variant =
      (covers(leafIndex, SALT.curl, coverage.curl) ? 1 : 0) |
      (covers(leafIndex, SALT.fold, coverage.fold) ? 2 : 0);
    variantCounts[variant] += 1;
  }

  const leafTexture = createLeafTexture();
  const uniforms = [];
  const material = createFollicleMaterial(params, uniforms, leafTexture);

  // Curl and fold live in the blade geometry, so leaves are grouped into four
  // shape variants: neither, curl only, fold only, and both. Leaves are dealt
  // into the variants by the coverage hashes above.
  const leafGeometries = [0, 1, 2, 3].map((variant) => {
    const curl = (variant & 1) !== 0 ? params.leafCurl : 0;
    const fold = (variant & 2) !== 0 ? params.leafFold : 0;
    return createLeafGeometry(quality.leafRows, curl, fold);
  });
  const meshes = [];
  const slots = [];
  for (let variant = 0; variant < 4; variant++) {
    const count = variantCounts[variant];
    if (count === 0) {
      leafGeometries[variant].dispose();
      leafGeometries[variant] = null;
      slots[variant] = null;
      continue;
    }
    const variantMesh = new THREE.InstancedMesh(leafGeometries[variant], material, count);
    variantMesh.name = `leaves-${variant}`;
    variantMesh.castShadow = false;
    variantMesh.receiveShadow = false;
    variantMesh.frustumCulled = false;
    meshes.push(variantMesh);
    slots[variant] = { mesh: variantMesh, next: 0 };
  }

  const dummy = new THREE.Object3D();
  const region = Math.max(0.001, crown.crownTop - crown.crownBottom);
  const color = new THREE.Color();
  const basisMatrix = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const face = new THREE.Vector3();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  // Leaf alignment blends each rosette's fan from its own lobe normal (0) to a
  // single smoothed crown-shell normal (1). The small orientation jitters are
  // relaxed toward the tidy end so the canopy reads as combed rather than
  // speckled.
  const alignment = clamp(params.leafAlignment ?? 0, 0, 1);
  const gravity = clamp(params.leafGravity ?? 0, 0, 1);
  const alignedChaos = 1 - alignment * 0.9;
  const radialNormal = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  let index = 0;

  for (const anchor of anchors) {
    radialNormal.copy(anchor.position).sub(crown.center);
    if (radialNormal.lengthSq() < 1e-6) radialNormal.copy(anchor.normal);
    else radialNormal.normalize();
    // Straight-up leaves would present only their shaded backs at the top of
    // the crown, so keep some of the lobe tilt there; the flanks can fully
    // follow the smooth shell. The 0.9 cap keeps a little clump character at
    // the tidy end instead of turning the crown into a perfect topiary ball.
    const follow = alignment * 0.9 * (1 - clamp(radialNormal.y, 0, 1) * 0.65);
    const shellNormal = anchor.normal.clone().lerp(radialNormal, follow).normalize();
    const shellBasis = makeBasis(shellNormal);
    const ownBasis = makeBasis(anchor.normal);
    const rosetteScale = params.leafSize * anchor.size;

    for (let k = 0; k < anchor.leafCount; k++) {
      const aligned = covers(index, SALT.alignment, coverage.alignment);
      const { n, t, b } = aligned ? shellBasis : ownBasis;
      const chaos = aligned ? alignedChaos : 1;
      const droop = covers(index, SALT.droop, coverage.droop) ? params.leafDroop : 0;
      const gravityHere = covers(index, SALT.gravity, coverage.gravity) ? gravity : 0;
      const variant =
        (covers(index, SALT.curl, coverage.curl) ? 1 : 0) |
        (covers(index, SALT.fold, coverage.fold) ? 2 : 0);
      const slot = slots[variant];
      const target = slot.mesh;
      const instance = slot.next++;
      const azimuth = (k / anchor.leafCount) * TAU + rng.range(-0.18, 0.18) * chaos;
      const tangential = new THREE.Vector3()
        .addScaledVector(t, Math.cos(azimuth))
        .addScaledVector(b, Math.sin(azimuth));

      // The star lies against the surface but lifts its tips away, so leaves
      // read as a rosette from the side instead of a painted-on decal.
      direction
        .copy(tangential)
        .multiplyScalar(1 + (rng.range(0.82, 1.03) - 1) * chaos)
        .addScaledVector(n, 0.16 + rng.range(0, 0.3) * chaos)
        .normalize();
      direction.y -= droop * (0.4 + rng.range(-0.22, 0.22) * chaos) * 0.64;
      direction.normalize();

      // Gravity blends the blade's length axis toward hanging straight down.
      // Only the base-to-tip direction rotates, so the stem stays pinned to the
      // branch. The jitter is hashed from the leaf index so moving the slider
      // changes only the sag, never the rest of the foliage layout.
      if (gravityHere > 0) {
        const sagJitter = 0.85 + noise.n01(index * 0.731, anchor.position.x * 3.1, anchor.position.z * 3.1) * 0.3;
        direction.lerp(down, gravityHere * 0.55 * sagJitter).normalize();
      }

      face.copy(n).addScaledVector(direction, -n.dot(direction));
      if (face.lengthSq() < 1e-5) face.copy(b);
      face.normalize();
      // A little roll keeps the rosette from looking stamped on, while still
      // presenting each blade's broad face outward.
      face.applyAxisAngle(direction, rng.range(-0.45, 0.45) * chaos);

      xAxis.crossVectors(direction, face).normalize();
      zAxis.crossVectors(xAxis, direction).normalize();
      basisMatrix.makeBasis(xAxis, direction, zAxis);
      quaternion.setFromRotationMatrix(basisMatrix);

      const offset = rng.range(0.02, 0.09) * rosetteScale;
      position
        .copy(anchor.position)
        .addScaledVector(tangential, offset)
        .addScaledVector(n, rng.range(0.015, 0.05) * rosetteScale + 0.012)
        .addScaledVector(direction, rng.range(0, 0.05));
      position.y -= rng.range(0, 0.04) * droop;

      const leafScale = rosetteScale * rng.range(0.92, 1.08);
      scale.set(leafScale * rng.range(0.9, 1.1), leafScale * rng.range(0.94, 1.08), leafScale);

      dummy.position.copy(position);
      dummy.quaternion.copy(quaternion);
      dummy.scale.copy(scale);
      dummy.updateMatrix();
      target.setMatrixAt(instance, dummy.matrix);

      // Sunlight falls on the top and on the upper-left face of the crown;
      // leaves deeper inside stay a richer, darker green.
      const heightFactor = clamp((position.y - crown.crownBottom) / region, 0, 1);
      const upward = clamp(n.y * 0.8 + 0.2, 0, 1);
      const sunlit = clamp(n.dot(sunDirection) * 0.5 + 0.5, 0, 1);

      let exposure = clamp(
        0.16 + heightFactor * 0.34 + upward * 0.12 + sunlit * 0.44 + rng.range(-0.05, 0.06) + anchor.exposureOffset,
        0,
        1,
      );
      exposure = clamp(0.5 + (exposure - 0.5) * (1.0 + params.leafContrast * 0.85), 0, 1);

      const hue = leafHue(params, exposure, anchor.hueShift + rng.range(-3, 3));
      const saturation = clamp(params.leafSaturation * (0.76 + exposure * 0.18) * rng.range(0.96, 1.04), 0.25, 1.15);
      const lightness = clamp(0.13 + Math.pow(exposure, 1.12) * 0.45 + rng.range(-0.015, 0.02), 0.12, 0.56);
      color.setHSL((((hue % 360) + 360) % 360) / 360, saturation, lightness, THREE.SRGBColorSpace);
      target.setColorAt(instance, color);

      index += 1;
    }
  }

  for (const variantMesh of meshes) {
    variantMesh.instanceMatrix.needsUpdate = true;
    if (variantMesh.instanceColor) variantMesh.instanceColor.needsUpdate = true;
  }

  const leafGroup = new THREE.Group();
  leafGroup.name = 'leaves';
  for (const variantMesh of meshes) leafGroup.add(variantMesh);

  let leafTriangles = 0;
  let leafVertices = 0;
  for (const variantMesh of meshes) {
    const variantGeometry = variantMesh.geometry;
    const vertexCount = variantGeometry.getAttribute('position').count;
    const triangleCount = (variantGeometry.index ? variantGeometry.index.count : vertexCount) / 3;
    leafTriangles += triangleCount * variantMesh.count;
    leafVertices += vertexCount * variantMesh.count;
  }

  const core = createCrownCore(crown, seed, fork, params);

  return {
    mesh: leafGroup,
    meshes,
    core,
    material,
    texture: leafTexture,
    geometry: meshes[0]?.geometry ?? null,
    vertices: leafVertices,
    triangles: leafTriangles,
    uniforms,
    leafCount: totalLeaves,
    rosetteCount: anchors.length,
    anchors,
  };
}

/**
 * Dark, opaque foliage texture for the inner core. It is intentionally low
 * contrast: when a seam opens between clusters, the gap should read as shaded
 * leaves rather than a flat hole.
 */
function createCanopyTexture(seed, params) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = new Rng(`${seed}:canopy-texture`);

  // Match the painted interior leaves to the season. A green shell behind an
  // autumn crown leaks green flecks through the gaps.
  const baseHue = leafHue(params, 0.55, 0);
  const saturation = clamp(params.leafSaturation, 0.3, 1) * 100;

  // Near-black base so the gaps stay dark, then big, overlapping painted
  // leaves so the shell reads as shadowed foliage instead of flat plastic.
  ctx.fillStyle = `hsl(${baseHue}, ${Math.round(saturation * 0.5)}%, 8%)`;
  ctx.fillRect(0, 0, size, size);

  const leaf = (length) => {
    const width = length * rng.range(0.34, 0.5);
    ctx.beginPath();
    ctx.moveTo(0, -length * 0.5);
    ctx.quadraticCurveTo(width, -length * 0.05, 0, length * 0.5);
    ctx.quadraticCurveTo(-width, -length * 0.05, 0, -length * 0.5);
  };

  // Shadow layer: large dark clumps that break up the base colour.
  for (let i = 0; i < 90; i++) {
    ctx.save();
    ctx.translate(rng.range(-24, size + 24), rng.range(-24, size + 24));
    ctx.rotate(rng.range(0, TAU));
    leaf(rng.range(52, 110));
    ctx.fillStyle = `hsla(${baseHue + rng.range(-12, 12)}, ${saturation * rng.range(0.5, 0.8)}%, ${rng.range(9, 18)}%, ${rng.range(0.5, 0.9)})`;
    ctx.fill();
    ctx.restore();
  }

  // Lit layer: slightly smaller, brighter leaves scattered over the shadows.
  for (let i = 0; i < 150; i++) {
    ctx.save();
    ctx.translate(rng.range(-24, size + 24), rng.range(-24, size + 24));
    ctx.rotate(rng.range(0, TAU));
    leaf(rng.range(34, 74));
    ctx.fillStyle = `hsla(${baseHue + rng.range(-15, 15)}, ${saturation * rng.range(0.7, 1.05)}%, ${rng.range(18, 34)}%, ${rng.range(0.35, 0.8)})`;
    ctx.fill();
    ctx.restore();
  }

  // A few bright tips catch the studio key light and sell the leaf shapes.
  for (let i = 0; i < 42; i++) {
    ctx.save();
    ctx.translate(rng.range(0, size), rng.range(0, size));
    ctx.rotate(rng.range(0, TAU));
    leaf(rng.range(26, 52));
    ctx.fillStyle = `hsla(${baseHue + rng.range(-8, 8)}, ${saturation * rng.range(0.85, 1.15)}%, ${rng.range(32, 46)}%, ${rng.range(0.3, 0.6)})`;
    ctx.fill();
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Larger tiles keep the painted leaves at a believable size relative to the
  // real leaf cards draping over the shell.
  texture.repeat.set(3, 2);
  texture.anisotropy = 4;
  return texture;
}

/**
 * A dark, slightly shrunken shell inside the leaf clusters. It never pokes
 * through the foliage, but any gap between clumps reads as shaded depth
 * instead of a hole straight through to the backdrop.
 */
function createCrownCore(crown, seed, fork, params) {
  const geometries = [];
  for (const cluster of crown.clusters) {
    for (const lobe of cluster.lobes) {
      const geometry = new THREE.IcosahedronGeometry(1, 2);
      const matrix = new THREE.Matrix4().makeScale(
        lobe.radii.x * 0.95,
        lobe.radii.y * 0.95,
        lobe.radii.z * 0.95,
      );
      matrix.setPosition(lobe.center);
      geometry.applyMatrix4(matrix);
      geometries.push(geometry);
    }
  }

  const source = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();

  // Lumpy shell: a perfectly smooth hull shows through gaps between clumps as
  // a dark ball. Two noise octaves give it a cauliflower silhouette, and the
  // normals are rebuilt afterwards so the lumps actually shade instead of
  // staying a uniform dark dome.
  const coreNoise = createNoise(`${seed}:crown-core`);
  const corePosition = source.getAttribute('position');
  const coreNormal = source.getAttribute('normal');
  for (let i = 0; i < corePosition.count; i++) {
    const x = corePosition.getX(i);
    const y = corePosition.getY(i);
    const z = corePosition.getZ(i);
    const lump = coreNoise.fbm(x * 1.9 + 5.3, y * 1.9, z * 1.9, 2) * 0.2;
    const detail = coreNoise.fbm(x * 6.1 - 2.7, y * 6.1 + 4.1, z * 6.1, 1) * 0.055;
    const push = lump + detail;
    corePosition.setXYZ(
      i,
      x + coreNormal.getX(i) * push,
      y + coreNormal.getY(i) * push,
      z + coreNormal.getZ(i) * push,
    );
  }
  corePosition.needsUpdate = true;
  source.computeVertexNormals();

  // Open a matching window in the core around the fork. Without it the leaf
  // gap would reveal a smooth core shell instead of the shaded interior and
  // the limbs behind it.
  let merged = source;
  if (fork) {
    const index = source.index;
    const position = source.getAttribute('position');
    const windowRadius = 0.95;
    const windowY = fork.y + 0.6;
    const kept = [];
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      const cx = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
      const cy = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
      const cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
      const dx = (cx - fork.x) / windowRadius;
      const dy = (cy - windowY) / windowRadius;
      if (cz > 0.02 && dx * dx + dy * dy < 1) continue;
      kept.push(a, b, c);
    }
    if (kept.length !== count) {
      merged = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) {
        const attribute = source.getAttribute(name);
        if (attribute) merged.setAttribute(name, attribute.clone());
      }
      merged.setIndex(kept);
      merged.computeBoundingSphere();
      source.dispose();
    }
  }
  if (merged === source) source.computeBoundingSphere();

  const texture = createCanopyTexture(seed, params);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'crown-core';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, material, texture };
}
