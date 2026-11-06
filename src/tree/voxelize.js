import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX_CELLS = 256;
const MAX_POLYGONS = 320000;
const INF = 1e12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Exact 1D squared Euclidean distance transform. Operates on `f` and writes
 * into `d`; `v`, `z` are reusable scratch buffers. Used to turn a thin surface
 * shell into a smooth signed field without a BVH query per voxel.
 */
function edt1d(n, f, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dv = q - v[k];
    d[q] = dv * dv + f[v[k]];
  }
}

/**
 * A light blur of the signed field near the surface rounds the marching-cubes
 * grid facets without touching the topology. Cells far from the surface are
 * left alone.
 */
function blurField(field, N, band) {
  const strideY = N;
  const strideZ = N * N;
  const next = new Float32Array(field.length);

  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = x + y * strideY + z * strideZ;
        if (Math.abs(field[i]) > band) {
          next[i] = field[i];
          continue;
        }

        let sum = field[i];
        let count = 1;
        if (x > 0) { sum += field[i - 1]; count++; }
        if (x < N - 1) { sum += field[i + 1]; count++; }
        if (y > 0) { sum += field[i - strideY]; count++; }
        if (y < N - 1) { sum += field[i + strideY]; count++; }
        if (z > 0) { sum += field[i - strideZ]; count++; }
        if (z < N - 1) { sum += field[i + strideZ]; count++; }
        next[i] = sum / count;
      }
    }
  }

  return next;
}

/**
 * Voxelize a closed bark mesh and reconstruct a clean surface.
 *
 * Triangles are rasterized into a thin solid shell, the air is flood-filled
 * from the grid border, and a separable distance transform gives the signed
 * field. Rasterizing first is important: the authored bark overlaps itself with
 * buried tube caps, and a nearest-surface sign per voxel would create internal
 * shells. The flood fill treats the whole wood as one solid volume.
 */
export async function voxelizeBark(geometry, {
  resolution = 160,
  meshDetail = 1,
  base = null,
  noise = null,
  barkRidge = 0.95,
} = {}) {
  if (!geometry || !geometry.index || !geometry.attributes.position) return null;

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return null;

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return null;

  const N = clamp(Math.round(resolution), 32, MAX_CELLS);
  const gridSize = maxDim * 1.04 + 0.05;
  const cell = gridSize / N;
  const origin = new THREE.Vector3(
    center.x - gridSize / 2,
    center.y - gridSize / 2,
    center.z - gridSize / 2,
  );
  const total = N * N * N;
  const strideY = N;
  const strideZ = N * N;

  // 1. Rasterize the triangles into a conservative surface shell.
  let surface = new Uint8Array(total);
  const position = geometry.attributes.position;
  const index = geometry.index;
  const positions = position.array;
  const indices = index.array;
  const positionStride = position.itemSize;
  const indexStride = index.itemSize;
  const triangles = index.count / 3;
  const tri = new THREE.Triangle();
  const sample = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const radiusSq = (cell * 0.9) * (cell * 0.9);

  for (let t = 0; t < triangles; t++) {
    const i0 = indices[t * 3 * indexStride] * positionStride;
    const i1 = indices[(t * 3 + 1) * indexStride] * positionStride;
    const i2 = indices[(t * 3 + 2) * indexStride] * positionStride;
    const ax = positions[i0];
    const ay = positions[i0 + 1];
    const az = positions[i0 + 2];
    const bx = positions[i1];
    const by = positions[i1 + 1];
    const bz = positions[i1 + 2];
    const cx = positions[i2];
    const cy = positions[i2 + 1];
    const cz = positions[i2 + 2];
    tri.a.set(ax, ay, az);
    tri.b.set(bx, by, bz);
    tri.c.set(cx, cy, cz);

    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);
    const minZ = Math.min(az, bz, cz);
    const maxZ = Math.max(az, bz, cz);

    const x0 = clamp(Math.floor((minX - origin.x) / cell - 0.5) - 1, 0, N - 1);
    const x1 = clamp(Math.ceil((maxX - origin.x) / cell - 0.5) + 1, 0, N - 1);
    const y0 = clamp(Math.floor((minY - origin.y) / cell - 0.5) - 1, 0, N - 1);
    const y1 = clamp(Math.ceil((maxY - origin.y) / cell - 0.5) + 1, 0, N - 1);
    const z0 = clamp(Math.floor((minZ - origin.z) / cell - 0.5) - 1, 0, N - 1);
    const z1 = clamp(Math.ceil((maxZ - origin.z) / cell - 0.5) + 1, 0, N - 1);

    for (let z = z0; z <= z1; z++) {
      const wz = origin.z + (z + 0.5) * cell;
      for (let y = y0; y <= y1; y++) {
        const wy = origin.y + (y + 0.5) * cell;
        for (let x = x0; x <= x1; x++) {
          const i = x + y * strideY + z * strideZ;
          if (surface[i]) continue;
          sample.set(origin.x + (x + 0.5) * cell, wy, wz);
          tri.closestPointToPoint(sample, closest);
          if (sample.distanceToSquared(closest) <= radiusSq) surface[i] = 1;
        }
      }
    }
  }

  // 2. Flood fill the air from the border. Anything unreachable is solid.
  let outside = new Uint8Array(total);
  let queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const seed = (x, y, z) => {
    const i = x + y * strideY + z * strideZ;
    if (!outside[i] && !surface[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      seed(x, 0, z);
      seed(x, N - 1, z);
    }
  }
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      seed(0, y, z);
      seed(N - 1, y, z);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      seed(x, y, 0);
      seed(x, y, N - 1);
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % N;
    const y = ((i / N) | 0) % N;
    const z = (i / (N * N)) | 0;
    if (x > 0) seed(x - 1, y, z);
    if (x < N - 1) seed(x + 1, y, z);
    if (y > 0) seed(x, y - 1, z);
    if (y < N - 1) seed(x, y + 1, z);
    if (z > 0) seed(x, y, z - 1);
    if (z < N - 1) seed(x, y, z + 1);
  }

  // 3. The visible shell is the solid layer next to the air. Use it to seed an
  // exact distance transform; buried internal surfaces are ignored.
  surface = null;
  queue = null;
  const shell = [];
  let dist = new Float32Array(total);
  dist.fill(INF);

  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = x + y * strideY + z * strideZ;
        if (outside[i]) continue;
        const boundary =
          x === 0 || x === N - 1 || y === 0 || y === N - 1 || z === 0 || z === N - 1 ||
          outside[i - 1] || outside[i + 1] ||
          outside[i - strideY] || outside[i + strideY] ||
          outside[i - strideZ] || outside[i + strideZ];
        if (boundary) {
          dist[i] = 0;
          shell.push(i);
        }
      }
    }
  }

  const line = new Float64Array(N);
  const result = new Float64Array(N);
  const v = new Int32Array(N);
  const zLine = new Float64Array(N + 1);

  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      const base = y * strideY + z * strideZ;
      for (let x = 0; x < N; x++) line[x] = dist[base + x];
      edt1d(N, line, result, v, zLine);
      for (let x = 0; x < N; x++) dist[base + x] = result[x];
    }
  }

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const base = x + z * strideZ;
      for (let y = 0; y < N; y++) line[y] = dist[base + y * strideY];
      edt1d(N, line, result, v, zLine);
      for (let y = 0; y < N; y++) dist[base + y * strideY] = result[y];
    }
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const base = x + y * strideY;
      for (let z = 0; z < N; z++) line[z] = dist[base + z * strideZ];
      edt1d(N, line, result, v, zLine);
      for (let z = 0; z < N; z++) dist[base + z * strideZ] = result[z];
    }
  }

  const band = cell * 2.4;
  let field = new Float32Array(total);
  const bvh = new MeshBVH(geometry, { targetLeafSize: 8 });
  const refinePoint = new THREE.Vector3();
  const refineTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

  for (let i = 0; i < total; i++) {
    const dWorld = Math.sqrt(dist[i]) * cell;
    const inside = !outside[i];
    if (dWorld < band) {
      const x = i % N;
      const y = ((i / N) | 0) % N;
      const z = (i / (N * N)) | 0;
      refinePoint.set(
        origin.x + (x + 0.5) * cell,
        origin.y + (y + 0.5) * cell,
        origin.z + (z + 0.5) * cell,
      );
      const hit = bvh.closestPointToPoint(refinePoint, refineTarget, 0, Infinity);
      if (hit) {
        field[i] = inside ? hit.distance : -hit.distance;
        continue;
      }
    }
    field[i] = inside ? dWorld : -dWorld;
  }

  dist = null;
  outside = null;
  field = blurField(field, N, band);
  field = blurField(field, N, band);

  // 4. Reconstruct with marching cubes.
  const material = new THREE.MeshBasicMaterial();
  const cubes = new MarchingCubes(N, material, false, false, MAX_POLYGONS);
  cubes.isolation = 0;
  cubes.field = field;
  cubes.update();

  const vertexCount = cubes.count;
  if (!vertexCount) {
    cubes.geometry.dispose();
    material.dispose();
    return null;
  }

  const sourcePositions = cubes.positionArray;
  const sourceNormals = cubes.normalArray;
  const remeshPositions = new Float32Array(vertexCount * 3);
  const remeshNormals = new Float32Array(vertexCount * 3);
  const half = N / 2;
  const cellOffset = cell * 0.5;

  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    remeshPositions[o] = origin.x + (sourcePositions[o] + 1) * half * cell + cellOffset;
    remeshPositions[o + 1] = origin.y + (sourcePositions[o + 1] + 1) * half * cell + cellOffset;
    remeshPositions[o + 2] = origin.z + (sourcePositions[o + 2] + 1) * half * cell + cellOffset;

    const nx = sourceNormals[o];
    const ny = sourceNormals[o + 1];
    const nz = sourceNormals[o + 2];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    remeshNormals[o] = nx / length;
    remeshNormals[o + 1] = ny / length;
    remeshNormals[o + 2] = nz / length;
  }

  cubes.geometry.dispose();
  material.dispose();

  const remesh = new THREE.BufferGeometry();
  remesh.setAttribute('position', new THREE.Float32BufferAttribute(remeshPositions, 3));
  remesh.setAttribute('normal', new THREE.Float32BufferAttribute(remeshNormals, 3));
  const remeshIndices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) remeshIndices[i] = i;
  remesh.setIndex(new THREE.BufferAttribute(remeshIndices, 1));

  // 5. Weld the marching-cubes vertices first: the addon emits independent
  // triangles, and meshopt cannot collapse unshared edges. Then optionally
  // decimate to the requested mesh resolution.
  const welded = mergeVertices(remesh);
  remesh.dispose();
  let finalGeometry = welded;
  const detail = clamp(meshDetail, 0.05, 1);
  if (detail < 0.99 && welded.attributes.position.count > 600) {
    try {
      const modifier = new SimplifyModifier();
      const removeCount = Math.floor(welded.attributes.position.count * (1 - detail));
      const simplified = await modifier.modify(welded, removeCount);
      if (simplified && simplified.attributes.position) {
        finalGeometry = simplified;
        welded.dispose();
      }
    } catch (error) {
      console.warn('Voxel remesh decimation failed', error);
    }
  }

  // 6. Continuous cylindrical bark mapping. Transferring UVs from the nearest
  // authored triangle picks up buried branch surfaces and leaves square
  // patches; a global cylinder around the trunk stays coherent.
  const finalPosition = finalGeometry.attributes.position;
  const finalCount = finalPosition.count;
  const uvs = new Float32Array(finalCount * 2);
  const colors = new Float32Array(finalCount * 3);
  const baseX = base?.x ?? 0;
  const baseZ = base?.z ?? 0;
  const ridgeCount = 9 + Math.round(barkRidge * 4);
  const TAU = Math.PI * 2;

  for (let i = 0; i < finalCount; i++) {
    const x = finalPosition.getX(i);
    const y = finalPosition.getY(i);
    const z = finalPosition.getZ(i);
    const theta = Math.atan2(z - baseZ, x - baseX);
    const u = (((theta / TAU) % 1) + 1) % 1;
    uvs[i * 2] = u * 2.4;
    uvs[i * 2 + 1] = y * 0.62;

    const ridgeNoise = noise
      ? noise.fbm(Math.cos(theta) * 1.9, y * 0.55, Math.sin(theta) * 1.9, 3)
      : Math.sin(theta * 3.1 + y * 1.7) * 0.5;
    const groove = Math.sin(theta * ridgeCount + ridgeNoise * 4.5) * 0.5 + 0.5;
    const ao = 0.76 + 0.24 * smoothstep(0, 1.5, y);
    const shade = (0.58 + groove * 0.42) * ao;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }

  finalGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (!finalGeometry.attributes.normal) finalGeometry.computeVertexNormals();
  finalGeometry.computeBoundingSphere();

  // 7. The raw voxel shell for the diagnostic preview.
  let voxelMesh = null;
  if (shell.length) {
    const box = new THREE.BoxGeometry(cell * 0.9, cell * 0.9, cell * 0.9);
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: 0xb7b0a4,
      roughness: 0.88,
      metalness: 0,
    });
    voxelMesh = new THREE.InstancedMesh(box, boxMaterial, shell.length);
    voxelMesh.name = 'voxel-preview';
    voxelMesh.visible = false;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < shell.length; i++) {
      const index = shell[i];
      const x = index % N;
      const y = ((index / N) | 0) % N;
      const z = (index / (N * N)) | 0;
      matrix.makeTranslation(
        origin.x + (x + 0.5) * cell,
        origin.y + (y + 0.5) * cell,
        origin.z + (z + 0.5) * cell,
      );
      voxelMesh.setMatrixAt(i, matrix);
    }
    voxelMesh.instanceMatrix.needsUpdate = true;
    voxelMesh.computeBoundingSphere();
  }

  return { geometry: finalGeometry, voxelMesh };
}
