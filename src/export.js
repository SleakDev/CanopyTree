import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * Convert thousands of leaf instances from every shape variant into one static
 * geometry so the GLB opens correctly in Blender, Unity, and other glTF viewers.
 */
function bakeLeafMeshes(meshes) {
  const pairs = meshes.map((mesh) => ({ geometry: mesh.geometry, mesh }));
  let totalVertices = 0;
  let totalIndices = 0;
  for (const { geometry, mesh } of pairs) {
    const baseVertexCount = geometry.getAttribute('position').count;
    const baseIndexCount = geometry.index ? geometry.index.count : baseVertexCount;
    totalVertices += baseVertexCount * mesh.count;
    totalIndices += baseIndexCount * mesh.count;
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const colors = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);

  const matrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const vector = new THREE.Vector3();
  const instanceColor = new THREE.Color();
  const vertexColor = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const { geometry, mesh } of pairs) {
    const sourcePosition = geometry.getAttribute('position');
    const sourceNormal = geometry.getAttribute('normal');
    const sourceUv = geometry.getAttribute('uv');
    const sourceColor = geometry.getAttribute('color');
    const sourceIndex = geometry.index;
    const baseVertexCount = sourcePosition.count;

    for (let instance = 0; instance < mesh.count; instance++) {
      mesh.getMatrixAt(instance, matrix);
      normalMatrix.getNormalMatrix(matrix);
      if (mesh.instanceColor) {
        instanceColor.fromBufferAttribute(mesh.instanceColor, instance);
      } else {
        instanceColor.copy(white);
      }

      for (let i = 0; i < baseVertexCount; i++) {
        const p = vertexOffset + i;
        vector.fromBufferAttribute(sourcePosition, i).applyMatrix4(matrix);
        positions[p * 3] = vector.x;
        positions[p * 3 + 1] = vector.y;
        positions[p * 3 + 2] = vector.z;

        vector.fromBufferAttribute(sourceNormal, i).applyMatrix3(normalMatrix).normalize();
        normals[p * 3] = vector.x;
        normals[p * 3 + 1] = vector.y;
        normals[p * 3 + 2] = vector.z;

        if (sourceUv) {
          uvs[p * 2] = sourceUv.getX(i);
          uvs[p * 2 + 1] = sourceUv.getY(i);
        }

        if (sourceColor) {
          vertexColor.fromBufferAttribute(sourceColor, i).multiply(instanceColor);
          colors[p * 3] = vertexColor.r;
          colors[p * 3 + 1] = vertexColor.g;
          colors[p * 3 + 2] = vertexColor.b;
        } else {
          colors[p * 3] = instanceColor.r;
          colors[p * 3 + 1] = instanceColor.g;
          colors[p * 3 + 2] = instanceColor.b;
        }
      }

      if (sourceIndex) {
        for (let i = 0; i < sourceIndex.count; i++) {
          indices[indexOffset + i] = sourceIndex.getX(i) + vertexOffset;
        }
        indexOffset += sourceIndex.count;
      } else {
        for (let i = 0; i < baseVertexCount; i++) {
          indices[indexOffset + i] = i + vertexOffset;
        }
        indexOffset += baseVertexCount;
      }
      vertexOffset += baseVertexCount;
    }
  }

  const baked = new THREE.BufferGeometry();
  baked.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  baked.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  baked.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  baked.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  baked.setIndex(new THREE.BufferAttribute(indices, 1));
  baked.computeBoundingSphere();
  baked.computeBoundingBox();
  return baked;
}

export async function exportTreeGLB(tree) {
  if (!tree) throw new Error('There is no tree to export');

  const group = new THREE.Group();
  group.name = 'CanopyTree';

  // Preview modes mutate the live materials in place. Restore the authored
  // color and maps on the clones so a GLB never bakes gray or wireframe.
  const authoredFor = (material) =>
    tree.viewOriginals?.find((record) => record.material === material) ?? null;
  const restoreAuthored = (material, original) => {
    if (!original) return;
    material.color.copy(original.color);
    material.map = original.map;
    if ('bumpMap' in material) material.bumpMap = original.bumpMap;
    if ('normalMap' in material) material.normalMap = original.normalMap;
    material.vertexColors = Boolean(original.vertexColors);
    material.wireframe = false;
    material.needsUpdate = true;
  };

  const barkMaterial = tree.bark.material.clone();
  barkMaterial.name = 'Bark';
  restoreAuthored(barkMaterial, authoredFor(tree.bark.material));
  const barkMesh = new THREE.Mesh(tree.bark.mesh.geometry, barkMaterial);
  barkMesh.name = 'TrunkAndBranches';
  group.add(barkMesh);

  const leafGeometry = bakeLeafMeshes(tree.foliage.meshes);
  const leafMaterial = new THREE.MeshStandardMaterial({
    name: 'Leaves',
    map: tree.foliage.texture,
    alphaTest: 0.45,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.58,
    metalness: 0,
  });
  const leafMesh = new THREE.Mesh(leafGeometry, leafMaterial);
  leafMesh.name = 'Foliage';
  group.add(leafMesh);

  const coreMaterial = tree.foliage.core.material.clone();
  coreMaterial.name = 'CanopyCore';
  restoreAuthored(coreMaterial, authoredFor(tree.foliage.core.material));
  const coreMesh = new THREE.Mesh(tree.foliage.core.mesh.geometry, coreMaterial);
  coreMesh.name = 'CanopyCore';
  group.add(coreMesh);

  group.userData.canopyTree = {
    generatedWith: 'CanopyTree studio',
    leaves: tree.stats.leaves,
    rosettes: tree.stats.rosettes,
  };

  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(group, {
      binary: true,
      onlyVisible: true,
      trs: false,
    });
    return new Blob([result], { type: 'model/gltf-binary' });
  } finally {
    leafGeometry.dispose();
    leafMaterial.dispose();
    coreMaterial.dispose();
    barkMaterial.dispose();
  }
}
