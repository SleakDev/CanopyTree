import * as THREE from 'three';

const TAU = Math.PI * 2;
const _up = new THREE.Vector3(0, 1, 0);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

const CROWN_MASS_MAX = 12;

/**
 * Crown masses in normalized crown space, generated as a seeded spiral so the
 * canopy reads the same from every azimuth instead of being a flat billboard.
 * A crown is one top mass plus `count - 1` bodies; the bodies walk down a
 * golden-angle spiral with a dome-shaped radial profile, which packs them
 * evenly around the trunk at every height. Radii are fractions of the crown
 * half-width / full height.
 *
 * Fewer puffs means fewer, larger masses so the canopy still fills out.
 */
function createCrownLayout(count, rng, yaw) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const body = Math.max(1, count - 1);
  // Stretch the footprint a little per seed: no two trees share a silhouette.
  const stretch = rng.range(0.9, 1.1);
  const masses = [
    {
      x: Math.cos(yaw) * 0.06,
      z: Math.sin(yaw) * 0.06,
      y: 0.87 + rng.range(-0.02, 0.02),
      rx: 0.37 * rng.range(0.94, 1.06),
      ry: 0.22 * rng.range(0.92, 1.08),
      rz: 0.37 * rng.range(0.94, 1.06),
    },
  ];

  const sizeScale = count <= 6 ? 1.26 : count <= 8 ? 1.14 : count <= 10 ? 1.05 : 1;
  for (let i = 0; i < body; i++) {
    const t = (i + 0.5) / body;
    const y = 0.79 - t * 0.61 + rng.range(-0.035, 0.035);
    // Dome profile: widest around the middle, tucked in at the base and crown.
    const profile = Math.sin(Math.PI * clamp((y + 0.06) / 0.98, 0, 1));
    const radial = (0.2 + 0.42 * Math.pow(profile, 0.6)) * rng.range(0.9, 1.08);
    const azimuth = yaw + i * goldenAngle + rng.range(-0.2, 0.2);
    const rx = (0.34 - t * 0.05) * sizeScale * rng.range(0.9, 1.1);
    masses.push({
      x: Math.cos(azimuth) * radial * stretch,
      z: Math.sin(azimuth) * radial,
      y,
      rx,
      ry: (0.2 - t * 0.025) * sizeScale * rng.range(0.92, 1.1),
      rz: rx * rng.range(0.92, 1.08),
    });
  }
  return masses;
}

/** Farthest intersection of a ray with an ellipsoid. */
function rayEllipsoid(origin, direction, ellipsoid) {
  const ox = (origin.x - ellipsoid.center.x) / ellipsoid.radii.x;
  const oy = (origin.y - ellipsoid.center.y) / ellipsoid.radii.y;
  const oz = (origin.z - ellipsoid.center.z) / ellipsoid.radii.z;
  const dx = direction.x / ellipsoid.radii.x;
  const dy = direction.y / ellipsoid.radii.y;
  const dz = direction.z / ellipsoid.radii.z;

  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  return Math.max((-b - root) / (2 * a), (-b + root) / (2 * a));
}

function ellipsoidNormal(ellipsoid, point) {
  return new THREE.Vector3(
    (point.x - ellipsoid.center.x) / (ellipsoid.radii.x * ellipsoid.radii.x),
    (point.y - ellipsoid.center.y) / (ellipsoid.radii.y * ellipsoid.radii.y),
    (point.z - ellipsoid.center.z) / (ellipsoid.radii.z * ellipsoid.radii.z),
  ).normalize();
}

/**
 * Outer surface of one leaf cluster along a ray from its centre. The cluster
 * is an aggregate of overlapping ellipsoids, so the result is a bumpy,
 * cauliflower-like shell rather than a smooth ball.
 */
export function crownClusterSurface(cluster, direction) {
  let bestDistance = -Infinity;
  let bestLobe = null;
  for (const lobe of cluster.lobes) {
    const distance = rayEllipsoid(cluster.center, direction, lobe);
    if (distance !== null && distance > bestDistance) {
      bestDistance = distance;
      bestLobe = lobe;
    }
  }
  if (!bestLobe || bestDistance <= 0) return null;
  const position = cluster.center.clone().addScaledVector(direction, bestDistance);
  return { position, normal: ellipsoidNormal(bestLobe, position) };
}

/** True when a point is buried inside a different crown cluster. */
export function isInsideOtherCluster(crown, cluster, point, margin = 0.96) {
  for (const other of crown.clusters) {
    if (other === cluster) continue;
    const dx = (point.x - other.center.x) / (other.radii.x * margin);
    const dy = (point.y - other.center.y) / (other.radii.y * margin);
    const dz = (point.z - other.center.z) / (other.radii.z * margin);
    if (dx * dx + dy * dy + dz * dz < 1) return true;
  }
  return false;
}

export function buildCrown(params, rng, noise) {
  const halfW = params.crownWidth * 0.5;
  const height = params.crownHeight;
  // Higher than the fork's surroundings: the side masses hang level with the
  // split, while the centre stays open enough to read the trunk and its forks.
  const crownBottom = params.trunkHeight - height * 0.12;
  const center = new THREE.Vector3(
    params.lean * height * 0.12 + params.crownSkew * halfW * 0.42,
    crownBottom + height * 0.5,
    0,
  );

  const count = clamp(Math.round(params.puffs), 5, CROWN_MASS_MAX);
  const clusters = [];
  const jitter = 0.03 + params.scallop * 0.045;
  // Each tree gets its own canopy orientation and mass distribution, so a new
  // seed gives a genuinely different silhouette rather than the same tree with
  // more leaves.
  const layout = createCrownLayout(count, rng, rng.range(0, TAU));

  for (let i = 0; i < count; i++) {
    const def = layout[i];
    // Slightly smaller main masses leave room for the satellite lobes to
    // protrude, which is what gives each clump a popcorn silhouette.
    const massScale = 0.82;
    const radii = new THREE.Vector3(
      def.rx * massScale * halfW * (1 + rng.range(-0.09, 0.09)),
      def.ry * massScale * height * (1 + rng.range(-0.09, 0.09)),
      def.rz * massScale * halfW * (1 + rng.range(-0.09, 0.09)),
    );
    const clusterCenter = new THREE.Vector3(
      center.x + (def.x + rng.range(-jitter, jitter)) * halfW,
      crownBottom + (def.y + rng.range(-jitter, jitter) * 0.8) * height,
      (def.z + rng.range(-jitter, jitter)) * halfW,
    );

    // Primary mass plus smaller satellites pushed toward the outside. The
    // satellites must sit far enough out to break the silhouette (offset plus
    // shrink > 1), otherwise they stay buried inside the parent ellipsoid.
    const lobes = [{ center: clusterCenter.clone(), radii: radii.clone() }];
    const satellites = 2 + (params.scallop > 0.7 ? 1 : 0);
    for (let s = 0; s < satellites; s++) {
      const azimuth = rng.range(0, TAU);
      const elevation = rng.range(-0.8, 0.85);
      const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
      const direction = new THREE.Vector3(
        Math.cos(azimuth) * horizontal,
        elevation,
        Math.sin(azimuth) * horizontal,
      );
      const offset = rng.range(0.74, 0.94);
      const shrink = rng.range(0.56, 0.72) * (0.9 + params.scallop * 0.2);
      lobes.push({
        center: new THREE.Vector3(
          clusterCenter.x + direction.x * radii.x * offset,
          clusterCenter.y + direction.y * radii.y * offset,
          clusterCenter.z + direction.z * radii.z * offset,
        ),
        radii: radii.clone().multiplyScalar(shrink),
      });
    }

    clusters.push({
      center: clusterCenter,
      radii,
      lobes,
      phase: rng.range(0, 100),
      weight: radii.x * radii.y + radii.y * radii.z + radii.z * radii.x,
    });
  }

  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxZ = 0;
  let totalLobeArea = 0;
  for (const cluster of clusters) {
    cluster.weight = 0;
    for (const lobe of cluster.lobes) {
      const area =
        lobe.radii.x * lobe.radii.y + lobe.radii.y * lobe.radii.z + lobe.radii.z * lobe.radii.x;
      cluster.weight += area;
      totalLobeArea += area;
      minY = Math.min(minY, lobe.center.y - lobe.radii.y);
      maxY = Math.max(maxY, lobe.center.y + lobe.radii.y);
      minX = Math.min(minX, lobe.center.x - lobe.radii.x);
      maxX = Math.max(maxX, lobe.center.x + lobe.radii.x);
      maxZ = Math.max(maxZ, Math.abs(lobe.center.z) + lobe.radii.z);
    }
  }

  return {
    center,
    clusters,
    totalLobeArea,
    halfW: Math.max(maxX - center.x, center.x - minX, maxZ),
    halfH: Math.max(maxY - center.y, center.y - minY),
    crownBottom: minY,
    crownTop: maxY,
    crownHeight: params.crownHeight,
    scallop: params.scallop,
    nominalBottom: crownBottom,
    nominalTop: crownBottom + height,
  };
}

function buildTrunk(params, rng, noise) {
  const height = params.trunkHeight;
  // Only a shallow plug sits under the contact plane; the trunk shape rounds
  // under there rather than showing a tall cylindrical skirt.
  const baseY = 0.0;
  const count = 10;
  const points = [];
  const radii = [];
  const leanX = params.lean * height * 0.34;
  const leanZ = rng.range(-0.06, 0.06);
  const wobbleSeed = rng.range(0, 100);

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const y = baseY + (height - baseY) * t;
    const bend = Math.pow(t, 1.45);
    const wobble = smoothstep(0, 0.22, t) * (1 - smoothstep(0.82, 1, t));
    const x =
      leanX * bend +
      (noise.fbm(wobbleSeed + t * 1.6, 0.5, 2.3, 2) * 0.075 + params.gnarl * 0.035 * Math.sin(t * 5.2)) * wobble;
    const z =
      leanZ * bend +
      (noise.fbm(1.7, wobbleSeed + t * 1.3, 8.4, 2) * 0.06 + params.gnarl * 0.025 * Math.cos(t * 4.4)) * wobble;
    points.push(new THREE.Vector3(x, y, z));
    const taperT = Math.pow(t, 0.82);
    let radius = THREE.MathUtils.lerp(params.trunkRadius, params.trunkRadius * params.taper, taperT);
    // A slight upward swelling just below the fork reads as tension in the wood.
    radius *= 1 + 0.05 * Math.exp(-Math.pow((t - 0.86) / 0.12, 2));
    radii.push(radius);
  }

  const fork = points[points.length - 1].clone();
  const topRadius = radii[radii.length - 1];
  return { points, radii, fork, topRadius };
}

function clampToCrown(point, crown, marginX = 0.9, marginY = 0.92) {
  const dx = (point.x - crown.center.x) / (crown.halfW * marginX);
  const dy = (point.y - crown.center.y) / (crown.halfH * marginY);
  const dz = point.z / (crown.halfW * marginX);
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length > 1) {
    const scale = 1 / length;
    point.x = crown.center.x + (point.x - crown.center.x) * scale;
    point.y = crown.center.y + (point.y - crown.center.y) * scale;
    point.z *= scale;
  }
  return point;
}

function sampleAlong(points, t) {
  if (points.length === 1) return points[0].clone();
  const scaled = t * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - index;
  return points[index].clone().lerp(points[index + 1], local);
}

function directionAt(points, t) {
  const a = sampleAlong(points, Math.max(0, t - 0.02));
  const b = sampleAlong(points, Math.min(1, t + 0.02));
  return b.sub(a).normalize();
}

/**
 * Grow a recursive branch. The crown envelope gently folds wandering tips back inside
 * so the silhouette stays rounded instead of shooting off into space.
 */
function growBranch({
  start,
  direction,
  length,
  radius,
  depth,
  maxDepth,
  params,
  rng,
  noise,
  crown,
  branches,
  tips,
  seedOffset,
  outwardOrigin,
}) {
  const segmentCount = depth === 1 ? 6 : 4;
  const points = [start.clone()];
  const radii = [radius];
  let point = start.clone();
  let dir = direction.clone().normalize();

  for (let i = 1; i <= segmentCount; i++) {
    const t = i / segmentCount;
    const wander = new THREE.Vector3(
      noise.fbm(seedOffset + point.x * 0.7, point.y * 0.55, point.z * 0.7, 3),
      noise.fbm(point.x * 0.65, seedOffset + point.y * 0.5, point.z * 0.65, 3) * 0.55,
      noise.fbm(point.x * 0.7, point.y * 0.55, seedOffset + point.z * 0.7, 3),
    );
    dir.addScaledVector(wander, params.gnarl * 0.12);

    // Tropism: reach up, but let gravity take the tips.
    dir.y += params.upBias * 0.055;
    dir.y -= params.droop * 0.045 * t;

    // Gentle outward pressure keeps side branches spreading.
    if (depth > 1 || outwardOrigin) {
      const outward = new THREE.Vector3(point.x - crown.center.x, 0, point.z);
      if (outward.lengthSq() > 1e-6) {
        outward.normalize();
        dir.addScaledVector(outward, params.spread * 0.035);
      }
    }

    dir.normalize();
    point = point.clone().addScaledVector(dir, length / segmentCount);
    clampToCrown(point, crown, depth === 1 ? 0.88 : 0.96, depth === 1 ? 0.9 : 0.98);
    points.push(point.clone());

    const taper = 1 - t * 0.42;
    radii.push(Math.max(0.012, radius * taper));
  }

  const branch = {
    points,
    radii,
    depth,
    seedOffset,
  };
  branches.push(branch);

  if (depth >= maxDepth) {
    tips.push({
      position: points[points.length - 1].clone(),
      direction: dir.clone(),
      radius: radii[radii.length - 1],
      depth,
      parent: branch,
    });
    return;
  }

  // Children grow from the outer half of the parent.
  const baseCount = depth === 1 ? 3 : 2;
  // Extra shoots are what make two trees of the same preset read as different
  // plants, so the count is drawn per parent rather than fixed by depth.
  const childCount = baseCount + (rng.chance(depth === 1 ? 0.3 : 0.22) ? 1 : 0);
  const fractions = [];
  for (let i = 0; i < childCount; i++) {
    fractions.push(0.42 + ((i + rng.range(0.1, 0.75)) / childCount) * 0.5);
  }
  fractions.sort((a, b) => a - b);

  for (let i = 0; i < childCount; i++) {
    const t = clamp(fractions[i], 0.38, 0.94);
    const childStart = sampleAlong(points, t);
    const parentDir = directionAt(points, t);
    const axis = new THREE.Vector3().crossVectors(parentDir, new THREE.Vector3(rng.range(-1, 1), rng.range(-0.4, 1), rng.range(-1, 1)));
    if (axis.lengthSq() < 1e-5) axis.set(rng.sign(), 0.2, rng.sign());
    axis.normalize();

    const angle = params.spread * rng.range(0.42, 0.85);
    const childDir = parentDir.clone().applyAxisAngle(axis, angle);
    childDir.applyAxisAngle(parentDir, rng.range(0, TAU));
    childDir.y += params.upBias * 0.2;
    childDir.normalize();

    const childLength = length * rng.range(0.56, 0.73) * (1 - (t - 0.4) * 0.25);
    const childRadius = Math.max(0.014, radii[Math.min(radii.length - 1, Math.round(t * (radii.length - 1)))] * rng.range(0.55, 0.7));

    growBranch({
      start: childStart,
      direction: childDir,
      length: childLength,
      radius: childRadius,
      depth: depth + 1,
      maxDepth,
      params,
      rng,
      noise,
      crown,
      branches,
      tips,
      seedOffset: seedOffset + rng.range(10, 80),
      outwardOrigin,
    });
  }
}

export function buildSkeleton(params, rng, noise) {
  const crown = buildCrown(params, rng.fork('crown'), noise);
  const trunk = buildTrunk(params, rng.fork('trunk'), noise);

  const branches = [];
  const tips = [];
  const count = clamp(Math.round(params.limbs), 2, 5);
  // Fully random fork orientation per seed. The limbs then fan out over 360°,
  // so the tree has structure on every side instead of a staged front.
  const azimuthOffset = rng.range(0, TAU);
  // One limb is allowed to be the leader; the others stay shorter. This breaks
  // the symmetry that makes procedural trees look manufactured.
  const leader = rng.int(0, count - 1);
  const limbSpread = params.crownWidth * 0.5;

  for (let i = 0; i < count; i++) {
    const spacing = TAU / count;
    const azimuth = azimuthOffset + i * spacing + rng.range(-0.36, 0.36);
    // A little more upright for the first limb; side limbs fan wider.
    const polar = clamp(rng.range(0.42, 0.95) + (i === 0 ? -0.12 : 0), 0.32, 1.2);
    const direction = new THREE.Vector3(
      Math.sin(polar) * Math.cos(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.sin(azimuth),
    ).normalize();

    const dominance = i === leader ? rng.range(1.12, 1.24) : rng.range(0.88, 1.04);
    const length = limbSpread * rng.range(0.6, 0.78) * dominance;
    const radius = Math.max(
      0.09,
      trunk.topRadius * (count <= 3 ? 0.78 : 0.66) * rng.range(0.94, 1.05),
    );
    // Start each limb deep inside the top of the trunk so its first ring is
    // fully buried. The visible union is then formed where the limb swells out
    // through the trunk wall (see the base flare in bark.js), which reads as
    // one continuous piece of wood.
    const outward = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const start = trunk.fork
      .clone()
      .addScaledVector(outward, trunk.topRadius * 0.1)
      .addScaledVector(_up, -trunk.topRadius * 1.0);
    growBranch({
      start,
      direction,
      length,
      radius,
      depth: 1,
      maxDepth: clamp(Math.round(params.branchLevels), 2, 5),
      params,
      rng: rng.fork(`limb-${i}`),
      noise,
      crown,
      branches,
      tips,
      seedOffset: rng.range(0, 100),
      outwardOrigin: true,
    });
  }

  return { trunk, branches, tips, crown };
}
