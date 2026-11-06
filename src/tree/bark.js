import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { Rng } from '../rng.js';
import { createNoise } from '../noise.js';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function interpolateRadius(radii, t) {
  const scaled = t * (radii.length - 1);
  const index = Math.min(radii.length - 2, Math.floor(scaled));
  const local = scaled - index;
  return THREE.MathUtils.lerp(radii[index], radii[index + 1], local);
}

/**
 * Cut the bark at the contact plane. The union-based root toes are widest just
 * below the floor; slicing them leaves the flat, planted footprint seen in the
 * reference instead of a rounded bulb hovering over the ground.
 */
function clipGeometryToGround(geometry, groundY) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const color = geometry.getAttribute('color');
  const index = geometry.index;
  if (!position || !index) return geometry;

  const vertexCount = position.count;
  const heights = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) heights[i] = position.getY(i);

  const outPositions = [];
  const outNormals = [];
  const outUvs = [];
  const outColors = [];
  const outIndices = [];
  const reused = new Map();
  const hasUv = Boolean(uv);
  const hasColor = Boolean(color);
  const triangleCount = index.count / 3;

  const pushOriginal = (i) => {
    const cached = reused.get(i);
    if (cached !== undefined) return cached;
    const next = outPositions.length / 3;
    outPositions.push(position.getX(i), heights[i], position.getZ(i));
    if (normal) outNormals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    if (hasUv) outUvs.push(uv.getX(i), uv.getY(i));
    if (hasColor) outColors.push(color.getX(i), color.getY(i), color.getZ(i));
    reused.set(i, next);
    return next;
  };

  const pushIntersection = (a, b, t) => {
    const next = outPositions.length / 3;
    outPositions.push(
      position.getX(a) + (position.getX(b) - position.getX(a)) * t,
      groundY,
      position.getZ(a) + (position.getZ(b) - position.getZ(a)) * t,
    );
    if (normal) {
      const nx = normal.getX(a) + (normal.getX(b) - normal.getX(a)) * t;
      const ny = normal.getY(a) + (normal.getY(b) - normal.getY(a)) * t;
      const nz = normal.getZ(a) + (normal.getZ(b) - normal.getZ(a)) * t;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      outNormals.push(nx / length, ny / length, nz / length);
    }
    if (hasUv) {
      outUvs.push(uv.getX(a) + (uv.getX(b) - uv.getX(a)) * t, uv.getY(a) + (uv.getY(b) - uv.getY(a)) * t);
    }
    if (hasColor) {
      outColors.push(
        color.getX(a) + (color.getX(b) - color.getX(a)) * t,
        color.getY(a) + (color.getY(b) - color.getY(a)) * t,
        color.getZ(a) + (color.getZ(b) - color.getZ(a)) * t,
      );
    }
    return next;
  };

  for (let t = 0; t < triangleCount; t++) {
    const a = index.getX(t * 3);
    const b = index.getX(t * 3 + 1);
    const c = index.getX(t * 3 + 2);
    const va = heights[a] >= groundY;
    const vb = heights[b] >= groundY;
    const vc = heights[c] >= groundY;
    if (!va && !vb && !vc) continue;
    if (va && vb && vc) {
      outIndices.push(pushOriginal(a), pushOriginal(b), pushOriginal(c));
      continue;
    }

    const source = [a, b, c];
    const above = [va, vb, vc];
    const polygon = [];
    for (let k = 0; k < 3; k++) {
      const current = source[k];
      const next = source[(k + 1) % 3];
      const currentAbove = above[k];
      const nextAbove = above[(k + 1) % 3];
      if (currentAbove) polygon.push({ source: current });
      if (currentAbove !== nextAbove) {
        const span = heights[next] - heights[current];
        const factor = Math.abs(span) < 1e-8 ? 0 : (groundY - heights[current]) / span;
        polygon.push({ a: current, b: next, t: factor });
      }
    }

    if (polygon.length < 3) continue;
    const first = polygon[0].source !== undefined
      ? pushOriginal(polygon[0].source)
      : pushIntersection(polygon[0].a, polygon[0].b, polygon[0].t);
    for (let p = 1; p < polygon.length - 1; p++) {
      const item = polygon[p];
      const following = polygon[p + 1];
      const second = item.source !== undefined
        ? pushOriginal(item.source)
        : pushIntersection(item.a, item.b, item.t);
      const third = following.source !== undefined
        ? pushOriginal(following.source)
        : pushIntersection(following.a, following.b, following.t);
      outIndices.push(first, second, third);
    }
  }

  if (!outIndices.length) return geometry;

  const clipped = new THREE.BufferGeometry();
  clipped.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3));
  if (normal) clipped.setAttribute('normal', new THREE.Float32BufferAttribute(outNormals, 3));
  if (hasUv) clipped.setAttribute('uv', new THREE.Float32BufferAttribute(outUvs, 2));
  if (hasColor) clipped.setAttribute('color', new THREE.Float32BufferAttribute(outColors, 3));
  clipped.setIndex(new THREE.BufferAttribute(new Uint32Array(outIndices), 1));
  clipped.computeBoundingSphere();
  return clipped;
}

/** A neutral, grayscale bark texture tinted by the material color. */
function createBarkTexture(seed) {
  const width = 512;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const rng = new Rng(`${seed}:bark-texture`);

  ctx.fillStyle = '#e8dcc9';
  ctx.fillRect(0, 0, width, height);

  // Broad tonal drift, so the bark is not a flat wall of color.
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, width);
    const y = rng.range(0, height);
    const r = rng.range(40, 190);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng.chance(0.55);
    gradient.addColorStop(0, dark ? 'rgba(66,53,43,0.055)' : 'rgba(255,248,238,0.05)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Long vertical fibers.
  for (let i = 0; i < 420; i++) {
    const x = rng.range(-20, width + 20);
    const y = rng.range(-80, height + 80);
    const length = rng.range(60, 380);
    const widthLine = rng.range(0.7, 5.2);
    const dark = rng.chance(0.68);
    const alpha = rng.range(0.06, dark ? 0.42 : 0.22);
    const drift = rng.range(-14, 14);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + drift * 0.4,
      y + length * 0.3,
      x - drift * 0.3,
      y + length * 0.7,
      x + drift,
      y + length,
    );
    ctx.strokeStyle = dark ? `rgba(52,41,33,${alpha})` : `rgba(255,247,235,${alpha})`;
    ctx.lineWidth = widthLine;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Short cracks and broken ridges.
  for (let i = 0; i < 150; i++) {
    const x = rng.range(0, width);
    const y = rng.range(0, height);
    const length = rng.range(20, 110);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + rng.range(-7, 7),
      y + length * 0.35,
      x + rng.range(-10, 10),
      y + length * 0.7,
      x + rng.range(-5, 5),
      y + length,
    );
    ctx.strokeStyle = `rgba(43,34,27,${rng.range(0.14, 0.42)})`;
    ctx.lineWidth = rng.range(0.5, 1.6);
    ctx.stroke();
  }

  // Fine grain.
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (rng.float() - 0.5) * 26;
    data[i] = clamp(data[i] + grain, 0, 255);
    data[i + 1] = clamp(data[i + 1] + grain, 0, 255);
    data[i + 2] = clamp(data[i + 2] + grain, 0, 255);
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Mirror instead of repeat: the painted fibers do not tile edge-to-edge, and a
  // mirrored copy hides that seam so the trunk has no horizontal band.
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Hand-built trunk so the buttress lobes stay locked to world-space angles. */
function createTrunkGeometry(params, trunk, noise, seedPhase) {
  const radialSegments = 40;
  const rings = 96;
  const curve = new THREE.CatmullRomCurve3(trunk.points, false, 'catmullrom', 0.45);
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const ridgeCount = 9 + Math.round(params.barkRidge * 4);

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const center = curve.getPoint(t);
    const radiusBase = interpolateRadius(trunk.radii, t);
    const groundDistance = Math.max(0, center.y);
    const ao = 0.76 + 0.24 * smoothstep(0, 1.5, groundDistance);
    // Let the geometry noise fade out near the base, where the root sleeve
    // takes over, so the two surfaces can meet cleanly.
    const surfaceNoise = smoothstep(0.9, 1.3, groundDistance);

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * TAU;
      const ridgeNoise = noise.fbm(Math.cos(theta) * 1.9, center.y * 0.55, Math.sin(theta) * 1.9, 3);
      const ridgeWave = Math.sin(theta * ridgeCount + ridgeNoise * 4.5);
      const fineWave = Math.sin(theta * (ridgeCount * 2.3) + center.y * 0.8 + ridgeNoise * 6);
      // Deep carved furrows: the grooves catch shadow and sell the bark even
      // when the texture map is too small to see.
      const ridgeFactor = params.barkRidge * (0.085 * ridgeWave + 0.028 * fineWave);

      const radial = radiusBase * (1 + ridgeFactor);
      const x = center.x + Math.cos(theta) * radial;
      const z = center.z + Math.sin(theta) * radial;
      const y =
        center.y +
        noise.fbm(theta * 2.2, t * 5.5, seedPhase, 2) * 0.018 * (1 - t * 0.6) * surfaceNoise;

      positions.push(x, y, z);
      uvs.push((j / radialSegments) * 2.4, center.y * 0.62 + ridgeNoise * 0.012);

      const groove = ridgeWave * 0.5 + 0.5;
      const shade = (0.58 + groove * 0.42 + 0.04 * fineWave) * ao;
      colors.push(shade, shade, shade);
    }
  }

  // Rounded fork head. The trunk closes into a domed knuckle instead of a flat
  // lid, so the primary limbs appear to grow out of solid wood.
  const domeRings = 4;
  const topRadius = interpolateRadius(trunk.radii, 1);
  const domeHeight = topRadius * 0.3;
  const topCenter = curve.getPoint(1);
  const topRingStart = positions.length / 3;

  for (let k = 1; k <= domeRings; k++) {
    const s = k / domeRings;
    const domeRadius = topRadius * Math.pow(Math.cos((s * Math.PI) / 2), 0.75);
    const domeY = topCenter.y + Math.sin((s * Math.PI) / 2) * domeHeight;
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * TAU;
      const ridgeNoise = noise.fbm(Math.cos(theta) * 1.9, topCenter.y * 0.55, Math.sin(theta) * 1.9, 3);
      const ridgeWave = Math.sin(theta * ridgeCount + ridgeNoise * 4.5);
      const radial = domeRadius * (1 + params.barkRidge * 0.03 * ridgeWave);
      positions.push(topCenter.x + Math.cos(theta) * radial, domeY, topCenter.z + Math.sin(theta) * radial);
      uvs.push((j / radialSegments) * 2.4, domeY * 0.62 + ridgeNoise * 0.012);
      const shade = (0.66 + (ridgeWave * 0.5 + 0.5) * 0.28) * 0.94;
      colors.push(shade, shade, shade);
    }
  }

  // Floor cap on the buried base ring. It normally sits under the contact
  // shadow, but it keeps a low orbit from ever seeing into the trunk.
  const baseCenter = curve.getPoint(0);
  const baseCap = positions.length / 3;
  positions.push(baseCenter.x, baseCenter.y, baseCenter.z);
  uvs.push(0.5, 0);
  colors.push(0.5, 0.5, 0.5);
  for (let j = 0; j < radialSegments; j++) {
    indices.push(j, j + 1, baseCap);
  }

  // Rings run counter-clockwise in XZ (cos, sin) while ring index grows upward,
  // so the quads are wound a, c, b / b, c, d to keep the normals pointing out.
  const stride = radialSegments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = i * stride + j + 1;
      const c = (i + 1) * stride + j;
      const d = (i + 1) * stride + j + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Stitch the main tube into the dome.
  for (let k = 0; k < domeRings; k++) {
    const ringA = k === 0 ? rings * stride : topRingStart + (k - 1) * stride;
    const ringB = topRingStart + k * stride;
    for (let j = 0; j < radialSegments; j++) {
      const a = ringA + j;
      const b = ringA + j + 1;
      const c = ringB + j;
      const d = ringB + j + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Dome apex.
  const apex = positions.length / 3;
  positions.push(topCenter.x, topCenter.y + domeHeight, topCenter.z);
  uvs.push(0.5, 0.5);
  colors.push(0.92, 0.92, 0.92);
  const domeLastRing = topRingStart + (domeRings - 1) * stride;
  for (let j = 0; j < radialSegments; j++) {
    indices.push(domeLastRing + j + 1, domeLastRing + j, apex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function orthonormal(tangent) {
  const reference = Math.abs(tangent.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3().crossVectors(reference, tangent).normalize();
}

/** Generic swept tube with parallel transport frames. */
function createBranchGeometry(branch, params, noise, seedPhase) {
  const curve = new THREE.CatmullRomCurve3(branch.points, false, 'catmullrom', 0.4);
  const length = Math.max(0.12, curve.getLength());
  const radialSegments = branch.depth === 1 ? 14 : branch.depth === 2 ? 10 : branch.depth === 3 ? 8 : 6;
  const rings = clamp(Math.ceil(length * 7) + 3, 5, 22);
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  let previousTangent = curve.getTangent(0).normalize();
  let normal = orthonormal(previousTangent);
  const quaternion = new THREE.Quaternion();

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    quaternion.setFromUnitVectors(previousTangent, tangent);
    normal.applyQuaternion(quaternion);
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    previousTangent = tangent;

    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    let radius = interpolateRadius(branch.radii, t);
    // Root flare where the branch grows out of its parent. The first ring is
    // fully buried in the parent, so the swelling peaks just as the tube breaks
    // through that surface. It fills the crotch with a fillet instead of
    // butting a uniform tube against the trunk. The flare is strongest on the
    // upper side of the tube, which is the crotch that needs filling; the
    // underside keeps a tighter, more bark-like ridge.
    const flareStrength = branch.depth === 1 ? 0.5 : branch.depth === 2 ? 0.16 : 0.1;
    const flare = Math.sin(Math.PI * clamp(t / 0.42, 0, 1));
    const flareAmount = flareStrength * flare * flare;
    radius *= 1 - 0.18 * smoothstep(0.92, 1, t);

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * TAU;
      const ridgeNoise = noise.fbm(Math.cos(theta) * 1.6 + seedPhase, center.y * 0.8, Math.sin(theta) * 1.6, 2);
      const ridge = Math.sin(theta * 8 + ridgeNoise * 3.4);
      const upness = normal.y * Math.cos(theta) + binormal.y * Math.sin(theta);
      const spread = 1 + flareAmount * (0.3 + 0.7 * Math.max(0, upness));
      const radial = radius * spread * (1 + params.barkRidge * 0.014 * ridge);
      const x = center.x + (normal.x * Math.cos(theta) + binormal.x * Math.sin(theta)) * radial;
      const y = center.y + (normal.y * Math.cos(theta) + binormal.y * Math.sin(theta)) * radial;
      const z = center.z + (normal.z * Math.cos(theta) + binormal.z * Math.sin(theta)) * radial;

      positions.push(x, y, z);
      uvs.push((j / radialSegments) * 1.4, t * length * 0.55 + seedPhase * 0.01);
      const shade = 0.78 + (ridge * 0.5 + 0.5) * 0.22;
      colors.push(shade, shade, shade);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = i * stride + j + 1;
      const c = (i + 1) * stride + j;
      const d = (i + 1) * stride + j + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  // Cap the embedded start of the tube so no backface is ever visible where it
  // meets its parent.
  const startCenter = curve.getPoint(0);
  const startCapIndex = positions.length / 3;
  positions.push(startCenter.x, startCenter.y, startCenter.z);
  uvs.push(0.5, 0);
  colors.push(0.7, 0.7, 0.7);
  for (let j = 0; j < radialSegments; j++) {
    indices.push(j + 1, j, startCapIndex);
  }

  // Tip cap.
  const tipCenter = curve.getPoint(1);
  const capIndex = positions.length / 3;
  positions.push(tipCenter.x, tipCenter.y, tipCenter.z);
  uvs.push(0.5, 1);
  colors.push(0.62, 0.62, 0.62);
  const lastRing = rings * stride;
  for (let j = 0; j < radialSegments; j++) {
    indices.push(lastRing + j, lastRing + j + 1, capIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/* --------------------------------------------------------- root sleeve */

/**
 * The root flare is an implicit smooth union of the lower trunk and five toe
 * chains, polygonised with marching cubes. A small inward inset keeps the skin
 * under the trunk's surface except where a toe protrudes, so the toes grow out
 * of the trunk as one continuous surface instead of separate welded tubes.
 */
function createRootSleeve(params, skeleton, noise, phase, rng) {
  const trunk = skeleton.trunk;
  const base = trunk.points[0];
  const rootRng = rng.fork('roots');
  const rootCount = clamp(Math.round(params.rootLobes), 3, 8);
  const flareScale = 0.35 + 0.48 * params.rootFlare;
  // Only the lower trunk contributes to the base union; trim the rest.
  let trunkSlice = trunk.points.length;
  for (let i = 0; i < trunk.points.length; i++) {
    if (trunk.points[i].y > 1.9) {
      trunkSlice = i + 1;
      break;
    }
  }
  const chains = [packChain(trunk.points.slice(0, trunkSlice), trunk.radii.slice(0, trunkSlice))];
  let maxReach = 0;
  let maxThick = 0;

  for (let i = 0; i < rootCount; i++) {
    const angle = (TAU * i - phase) / rootCount + rootRng.range(-0.16, 0.16) * (TAU / rootCount);
    const thick = params.trunkRadius * rootRng.range(0.38, 0.5) * flareScale;
    const reach = params.trunkRadius * rootRng.range(1.35, 1.65) * flareScale;
    const ankle = (0.4 + params.trunkRadius * 0.35) * rootRng.range(0.82, 1.12);
    const top = ankle + params.trunkRadius * rootRng.range(0.7, 1.0);
    maxReach = Math.max(maxReach, reach + thick * 0.6);
    maxThick = Math.max(maxThick, thick);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const toe = new THREE.Vector3(
      base.x + ca * reach,
      thick * 0.12,
      base.z + sa * reach,
    );
    const nose = toe
      .clone()
      .add(new THREE.Vector3(ca * 0.32, -0.2, sa * 0.32).multiplyScalar(thick));
    const points = [
      new THREE.Vector3(base.x + ca * params.trunkRadius * 0.05, top, base.z + sa * params.trunkRadius * 0.05),
      new THREE.Vector3(base.x + ca * params.trunkRadius * 0.55, ankle * 0.7, base.z + sa * params.trunkRadius * 0.55),
      new THREE.Vector3(base.x + ca * params.trunkRadius * 0.9, ankle * 0.25, base.z + sa * params.trunkRadius * 0.9),
      toe,
      nose,
    ];
    const radii = [
      thick * 0.15,
      thick,
      thick * 0.92,
      thick * 0.82,
      thick * 0.38,
    ];
    chains.push(packChain(points, radii));
  }

  const centerY = 0.35;
  const radius = THREE.MathUtils.clamp(Math.max(maxReach + 0.2, 0.9), 0.85, 1.5);
  const blend = Math.max(0.12, params.trunkRadius * 0.62, maxThick * 1.15);
  const resolution = radius > 1.35 ? 88 : radius > 1.0 ? 72 : 64;
  const ridgeCount = 9 + Math.round(params.barkRidge * 4);
  const forkY = Math.max(0.001, trunk.fork.y);

  const material = new THREE.MeshBasicMaterial();
  const cubes = new MarchingCubes(resolution, material, false, false, 120000);
  cubes.isolation = 0;

  const half = resolution / 2;
  let index = 0;
  for (let z = 0; z < resolution; z++) {
    const wz = base.z + ((z - half) / half) * radius;
    for (let y = 0; y < resolution; y++) {
      const wy = centerY + ((y - half) / half) * radius;
      for (let x = 0; x < resolution; x++, index++) {
        const wx = base.x + ((x - half) / half) * radius;
        let distance = chainDistance(chains[0], wx, wy, wz);
        for (let c = 1; c < chains.length; c++) {
          distance = smoothMin(distance, chainDistance(chains[c], wx, wy, wz), blend);
        }
        // Stay just under the trunk's groove line in the root zone, then dive
        // deeper near the top of the sleeve so its edge is completely hidden.
        const depth = 0.006 + 0.05 * smoothstep(0.9, 1.35, wy);
        let field = -(distance + depth);
        // Follow the trunk's carved ridges, so the overlap disappears into the
        // same furrows instead of reading as a clean horizontal boundary.
        if (Math.abs(distance + depth) < 0.12) {
          const theta = Math.atan2(wz - base.z, wx - base.x);
          const radiusBase = interpolateRadius(trunk.radii, clamp(wy / forkY, 0, 1));
          const ridgeNoise = noise.fbm(Math.cos(theta) * 1.9, wy * 0.55, Math.sin(theta) * 1.9, 3);
          const ridgeWave = Math.sin(theta * ridgeCount + ridgeNoise * 4.5);
          const fineWave = Math.sin(theta * (ridgeCount * 2.3) + wy * 0.8 + ridgeNoise * 6);
          field += params.barkRidge * (0.085 * ridgeWave + 0.028 * fineWave) * radiusBase;
        }
        cubes.field[index] = field;
      }
    }
  }

  cubes.update();

  const count = cubes.count;
  if (!count) {
    cubes.geometry.dispose();
    material.dispose();
    return null;
  }

  const sourcePositions = cubes.positionArray;
  const sourceNormals = cubes.normalArray;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = base.x + sourcePositions[o] * radius;
    const y = centerY + sourcePositions[o + 1] * radius;
    const z = base.z + sourcePositions[o + 2] * radius;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;

    const nx = sourceNormals[o];
    const ny = sourceNormals[o + 1];
    const nz = sourceNormals[o + 2];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals[o] = nx / length;
    normals[o + 1] = ny / length;
    normals[o + 2] = nz / length;

    const theta = Math.atan2(z - base.z, x - base.x);
    const u = (((theta / TAU) % 1) + 1) % 1;
    uvs[i * 2] = u * 2.4;
    uvs[i * 2 + 1] = y * 0.62;

    const ridgeNoise = noise.fbm(Math.cos(theta) * 1.9, y * 0.55, Math.sin(theta) * 1.9, 3);
    const ridgeWave = Math.sin(theta * ridgeCount + ridgeNoise * 4.5);
    const fineWave = Math.sin(theta * (ridgeCount * 2.3) + y * 0.8 + ridgeNoise * 6);
    const groove = ridgeWave * 0.5 + 0.5;
    const ao = 0.76 + 0.24 * smoothstep(0, 1.5, y);
    const shade = (0.58 + groove * 0.42 + 0.04 * fineWave) * ao;
    colors[o] = shade;
    colors[o + 1] = shade;
    colors[o + 2] = shade;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  cubes.geometry.dispose();
  material.dispose();
  return geometry;
}

/* ------------------------------------------------------- fork blending */

/**
 * Pack a polyline into a flat list of tapered cylinder segments. The distance
 * functions below only need endpoints, direction, radius, and inverse length,
 * so keeping this in one typed array avoids allocations inside the field loop.
 */
function packChain(points, radii) {
  const count = Math.max(0, points.length - 1);
  const data = new Float32Array(count * 10);
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const lengthSq = Math.max(1e-8, dx * dx + dy * dy + dz * dz);
    const o = i * 10;
    data[o] = a.x;
    data[o + 1] = a.y;
    data[o + 2] = a.z;
    data[o + 3] = dx;
    data[o + 4] = dy;
    data[o + 5] = dz;
    data[o + 6] = radii[i];
    data[o + 7] = radii[i + 1];
    data[o + 8] = 1 / lengthSq;
  }
  return { data, count };
}

function chainDistance(chain, x, y, z) {
  const data = chain.data;
  let best = Infinity;
  for (let i = 0, o = 0; i < chain.count; i++, o += 10) {
    const ax = data[o];
    const ay = data[o + 1];
    const az = data[o + 2];
    const vx = data[o + 3];
    const vy = data[o + 4];
    const vz = data[o + 5];
    let t = ((x - ax) * vx + (y - ay) * vy + (z - az) * vz) * data[o + 8];
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = x - (ax + vx * t);
    const dy = y - (ay + vy * t);
    const dz = z - (az + vz * t);
    const radius = data[o + 6] + (data[o + 7] - data[o + 6]) * t;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
    if (distance < best) best = distance;
  }
  return best;
}

function smoothMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * The trunk and each primary limb are authored as separate swept tubes. Where
 * they intersect, the two surfaces cut through each other and read as sticks
 * pushed into a post. This polygonises a smooth implicit union of the same
 * centre lines and insets it slightly. Most of that skin hides inside the
 * tubes; only the concave crotch, where the union bulges outward, rises above
 * the bark. The patch therefore meets the original surfaces from underneath
 * instead of ending in a collar around the trunk, and the branch roots flow
 * into the trunk as one piece of wood.
 */
function createForkSleeve(skeleton, noise) {
  const trunk = skeleton.trunk;
  const limbs = skeleton.branches.filter((branch) => branch.depth === 1);
  if (limbs.length < 2) return null;

  const fork = trunk.fork;
  let maxLimbRadius = 0;
  for (const limb of limbs) maxLimbRadius = Math.max(maxLimbRadius, limb.radii[0]);

  // A box big enough to contain the crotch and the first stretch of every
  // primary limb. The skin dives inside the tubes before reaching its walls.
  const radius = THREE.MathUtils.clamp(
    Math.max(0.5, trunk.topRadius * 3.0, maxLimbRadius * 3.0),
    0.45,
    0.85,
  );
  const blend = Math.max(0.075, trunk.topRadius * 1.3, maxLimbRadius * 1.1);
  // Hide under the bark of the thickest tube at the joint, not just the trunk.
  const inset = Math.max(0.012, Math.max(trunk.topRadius, maxLimbRadius) * 0.22);
  const resolution = radius > 0.75 ? 88 : radius > 0.55 ? 72 : 56;

  const chains = [packChain(trunk.points, trunk.radii)];
  for (const limb of limbs) chains.push(packChain(limb.points, limb.radii));

  const material = new THREE.MeshBasicMaterial();
  const cubes = new MarchingCubes(resolution, material, false, false, 80000);
  cubes.isolation = 0;

  const half = resolution / 2;
  let index = 0;
  for (let z = 0; z < resolution; z++) {
    const wz = fork.z + ((z - half) / half) * radius;
    for (let y = 0; y < resolution; y++) {
      const wy = fork.y + ((y - half) / half) * radius;
      for (let x = 0; x < resolution; x++, index++) {
        const wx = fork.x + ((x - half) / half) * radius;
        // Blend only the two closest surfaces. Chaining a smooth minimum over
        // every limb would add a little extra thickness for each one and turn
        // the fork into a bulb.
        let first = Infinity;
        let second = Infinity;
        for (let c = 0; c < chains.length; c++) {
          const distance = chainDistance(chains[c], wx, wy, wz);
          if (distance < first) {
            second = first;
            first = distance;
          } else if (distance < second) {
            second = distance;
          }
        }
        const distance = smoothMin(first, second, blend);
        // A constant inward inset hides the skin inside both tubes everywhere
        // except the concave crotch, where the smooth union bulges outward. The
        // patch therefore meets the bark from underneath instead of ending in
        // a visible cuff around the trunk.
        cubes.field[index] = -(distance + inset);
      }
    }
  }

  cubes.update();

  const count = cubes.count;
  if (!count) {
    cubes.geometry.dispose();
    material.dispose();
    return null;
  }

  const sourcePositions = cubes.positionArray;
  const sourceNormals = cubes.normalArray;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = fork.x + sourcePositions[o] * radius;
    const y = fork.y + sourcePositions[o + 1] * radius;
    const z = fork.z + sourcePositions[o + 2] * radius;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;

    const nx = sourceNormals[o];
    const ny = sourceNormals[o + 1];
    const nz = sourceNormals[o + 2];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals[o] = nx / length;
    normals[o + 1] = ny / length;
    normals[o + 2] = nz / length;

    // One continuous cylindrical mapping around the trunk. Sampling each
    // vertex's own nearest limb would jump between frames and paint visible
    // swirled bands across the crotch.
    const theta = Math.atan2(z - fork.z, x - fork.x);
    const u = (((theta / TAU) % 1) + 1) % 1;
    uvs[i * 2] = u * 2.4;
    uvs[i * 2 + 1] = y * 0.62;

    const ridgeNoise = noise.fbm(Math.cos(theta) * 1.9, y * 0.55, Math.sin(theta) * 1.9, 3);
    const ridgeWave = Math.sin(theta * 11 + ridgeNoise * 4.5);
    const shade = 0.72 + (ridgeWave * 0.5 + 0.5) * 0.24;
    colors[o] = shade;
    colors[o + 1] = shade;
    colors[o + 2] = shade;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  cubes.geometry.dispose();
  material.dispose();
  return geometry;
}

export async function createBarkMesh(params, skeleton, seed) {
  const rng = new Rng(`${seed}:bark`);
  const noise = createNoise(`${seed}:bark-noise`);
  const phase = rng.range(0, TAU);
  const coreParts = [createTrunkGeometry(params, skeleton.trunk, noise, phase)];
  const tipParts = [];
  const voxelDepth = params.voxelize ? Math.max(0, Math.round(params.voxelDepth)) : Infinity;

  for (let i = 0; i < skeleton.branches.length; i++) {
    const branch = skeleton.branches[i];
    const geometry = createBranchGeometry(branch, params, noise, phase + i * 1.73);
    if (branch.depth > voxelDepth) tipParts.push(geometry);
    else coreParts.push(geometry);
  }

  // The base is one smooth implicit union of the trunk and root toes, so the
  // buttresses grow seamlessly out of the trunk.
  const rootSleeve = createRootSleeve(params, skeleton, noise, phase, rng);
  if (rootSleeve) coreParts.push(rootSleeve);

  // One blended skin over the primary fork hides the tube intersections.
  const sleeve = createForkSleeve(skeleton, noise);
  if (sleeve) coreParts.push(sleeve);

  let coreGeometry = mergeGeometries(coreParts, false);
  for (const geometry of coreParts) geometry.dispose();

  let finalGeometry = coreGeometry;
  let voxelMesh = null;
  if (params.voxelize) {
    const { voxelizeBark } = await import('./voxelize.js');
    const result = await voxelizeBark(coreGeometry, {
      resolution: params.voxelResolution,
      meshDetail: params.voxelMeshDetail,
      base: skeleton.trunk.points[0],
      noise,
      barkRidge: params.barkRidge,
    });
    if (result) {
      finalGeometry = result.geometry;
      voxelMesh = result.voxelMesh;
      coreGeometry.dispose();
    }
  }

  // Branches deeper than the chosen level keep their authored tubes, so thin
  // twigs survive coarse voxel grids.
  if (tipParts.length) {
    const tipGeometry = mergeGeometries(tipParts, false);
    for (const geometry of tipParts) geometry.dispose();
    const merged = mergeGeometries([finalGeometry, tipGeometry], false);
    finalGeometry.dispose();
    tipGeometry.dispose();
    finalGeometry = merged;
  }

  // The root toes are widest just under the contact plane. Slicing the final
  // wood there gives the flat, planted footprint from the reference.
  const clipped = clipGeometryToGround(finalGeometry, 0.003);
  if (clipped !== finalGeometry) {
    finalGeometry.dispose();
    finalGeometry = clipped;
  }

  const map = createBarkTexture(seed);
  const bumpMap = map.clone();
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.needsUpdate = true;

  const barkColor = new THREE.Color().setHSL(
    (33 - params.barkTone * 4) / 360,
    0.52 + params.barkTone * 0.16,
    0.55 + params.barkTone * 0.15,
    THREE.SRGBColorSpace,
  );

  const material = new THREE.MeshStandardMaterial({
    color: barkColor,
    map,
    bumpMap,
    bumpScale: 0.1,
    roughness: 0.82,
    metalness: 0,
    vertexColors: true,
  });

  const mesh = new THREE.Mesh(finalGeometry, material);
  mesh.name = 'bark';
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return { mesh, material, map, bumpMap, voxelMesh };
}
