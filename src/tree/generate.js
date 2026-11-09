import * as THREE from 'three';
import { Rng } from '../rng.js';
import { createNoise } from '../noise.js';
import { buildSkeleton } from './skeleton.js';
import { createBarkMesh } from './bark.js';
import { createFoliage } from './foliage.js';

export async function generateTree(params) {
  const startedAt = performance.now();
  const rng = new Rng(params.seed);
  const noise = createNoise(params.seed);

  const skeleton = buildSkeleton(params, rng.fork('skeleton'), noise);
  const bark = await createBarkMesh(params, skeleton, params.seed);
  const foliage = createFoliage(params, skeleton, params.seed);

  const group = new THREE.Group();
  group.name = `tree-${params.seed}`;
  group.add(bark.mesh, foliage.core.mesh, foliage.mesh);
  if (bark.voxelMesh) group.add(bark.voxelMesh);

  const bounds = new THREE.Box3().setFromObject(group);
  const barkTriangles = bark.mesh.geometry.index ? bark.mesh.geometry.index.count / 3 : bark.mesh.geometry.attributes.position.count / 3;
  const leafTriangles = foliage.triangles;

  return {
    group,
    bounds,
    bark,
    foliage,
    windUniforms: foliage.uniforms,
    stats: {
      leaves: foliage.leafCount,
      rosettes: foliage.rosetteCount,
      branches: skeleton.branches.length + 1,
      vertices: bark.mesh.geometry.attributes.position.count + foliage.vertices,
      triangles: Math.round(barkTriangles + leafTriangles),
      ms: performance.now() - startedAt,
    },
  };
}

/**
 * Release every GPU resource owned by a generated tree.
 * Called on each rebuild; forgetting this leaks textures and buffers quickly.
 */
export function disposeTree(tree) {
  if (!tree) return;
  const textures = new Set();
  const materials = new Set();

  // Preview modes can detach maps from the live material. Their original
  // textures still need releasing, or gray/wireframe mode would leak them.
  if (Array.isArray(tree.viewOriginals)) {
    for (const record of tree.viewOriginals) {
      for (const key of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
        if (record[key]) textures.add(record[key]);
      }
    }
  }

  tree.group.traverse((object) => {
    if (object.isInstancedMesh) object.dispose?.();
    if (object.geometry) object.geometry.dispose();
    const material = object.material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      materials.add(item);
      for (const key of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
        if (item[key]) textures.add(item[key]);
      }
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  tree.group.clear();
  tree.windUniforms = [];
}
