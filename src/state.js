import { sanitizeSeed } from './rng.js';

/**
 * Every visible and structural property of a tree lives here.
 * Keeping the tree a plain data object makes presets, URLs and thumbnails easy.
 */
export const DEFAULTS = {
  seed: 'amber-cedar-4821',

  // Trunk
  trunkHeight: 3.2,
  trunkRadius: 0.48,
  taper: 0.6,
  lean: 0.3,
  rootFlare: 1.35,
  rootLobes: 5,
  barkRidge: 0.95,
  barkTone: 0.5,

  // Branches
  limbs: 3,
  branchLevels: 4,
  spread: 0.95,
  upBias: 0.5,
  droop: 0.3,
  gnarl: 0.4,

  // Voxelization
  voxelize: false,
  voxelDepth: 2,
  voxelResolution: 192,
  voxelMeshDetail: 1.0,
  voxelPreview: false,

  // Crown
  crownWidth: 6.4,
  crownHeight: 4.6,
  crownSkew: 0.08,
  puffs: 12,
  scallop: 0.7,
  leafDensity: 0.88,

  // Leaves
  leafSize: 1.22,
  rosetteLeaves: 8,
  leafDroop: 0.34,
  leafCurl: 0.3,
  leafFold: 0.0,
  leafAlignment: 0.0,
  leafGravity: 0.0,
  leafDroopApply: 100,
  leafCurlApply: 100,
  leafFoldApply: 100,
  leafAlignmentApply: 100,
  leafGravityApply: 100,
  leafHue: 0.0,
  leafSaturation: 0.92,
  leafContrast: 0.72,

  // Scene
  wind: 0.2,
  sunAzimuth: 325,
  sunElevation: 52,
  sunIntensity: 2.3,
  backdrop: 'studio',
  quality: 'high',
};

export const PARAM_META = {
  trunkHeight: { label: 'Trunk height', min: 1.4, max: 4.6, step: 0.05, decimals: 2, unit: 'm', hint: 'Height of the trunk before it forks.' },
  trunkRadius: { label: 'Trunk girth', min: 0.16, max: 0.78, step: 0.01, decimals: 2, unit: 'm', hint: 'Radius of the trunk at the base.' },
  taper: { label: 'Taper', min: 0.32, max: 0.88, step: 0.01, decimals: 2, hint: 'How much slimmer the trunk gets near the fork.' },
  lean: { label: 'Lean', min: -1, max: 1, step: 0.01, decimals: 2, hint: 'Sideways lean of the trunk and crown.' },
  rootFlare: { label: 'Root flare', min: 0, max: 2, step: 0.01, decimals: 2, hint: 'Size of the buttress roots at the base.' },
  rootLobes: { label: 'Root lobes', min: 3, max: 8, step: 1, decimals: 0, hint: 'Number of root feet around the trunk.' },
  barkRidge: { label: 'Bark relief', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Depth of the carved bark ridges.' },
  barkTone: { label: 'Bark tone', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Warmth and darkness of the bark.' },

  limbs: { label: 'Main limbs', min: 2, max: 5, step: 1, decimals: 0, hint: 'Number of large branches leaving the trunk.' },
  branchLevels: { label: 'Branch depth', min: 2, max: 5, step: 1, decimals: 0, hint: 'Recursion levels used to build the branch structure.' },
  spread: { label: 'Spread', min: 0.5, max: 1.5, step: 0.01, decimals: 2, hint: 'How widely child branches fan out.' },
  upBias: { label: 'Upward bias', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Tendency for branches to grow upward.' },
  droop: { label: 'Droop', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Gravity pulling the branch tips down.' },
  gnarl: { label: 'Gnarl', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Organic wobble and crookedness in the branches.' },

  voxelize: { label: 'Voxelize wood', type: 'toggle', hint: 'Rebuild the trunk and branches as one voxelized solid so every join is seamless.' },
  voxelDepth: { label: 'Voxelize depth', min: 0, max: 5, step: 1, decimals: 0, hint: 'How many branch levels get voxelized. Deeper twigs stay as smooth tubes.' },
  voxelResolution: { label: 'Voxel resolution', min: 48, max: 256, step: 8, decimals: 0, hint: 'Grid resolution of the voxel pass. Higher captures more bark and root detail, but takes longer.' },
  voxelMeshDetail: { label: 'Mesh resolution', min: 0.05, max: 1, step: 0.01, decimals: 2, hint: 'Density of the remeshed surface, independent of the voxel grid. 1.0 keeps the full remesh; go as low as 0.05 for a very light, strongly decimated asset.' },
  voxelPreview: { label: 'Show voxel grid', type: 'toggle', hint: 'Preview the raw voxel shell of the voxelized core. Deeper branch levels stay as tubes and are not shown in this inspection view.' },

  crownWidth: { label: 'Crown width', min: 3.2, max: 9, step: 0.05, decimals: 2, unit: 'm', hint: 'Overall width of the leafy crown.' },
  crownHeight: { label: 'Crown height', min: 2.2, max: 6.8, step: 0.05, decimals: 2, unit: 'm', hint: 'Overall height of the leafy crown.' },
  crownSkew: { label: 'Asymmetry', min: -1, max: 1, step: 0.01, decimals: 2, hint: 'Push the crown to one side.' },
  puffs: { label: 'Leaf masses', min: 5, max: 12, step: 1, decimals: 0, hint: 'Number of rounded clusters forming the crown.' },
  scallop: { label: 'Scallop', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Lumpiness of the crown silhouette.' },
  leafDensity: { label: 'Leaf density', min: 0.35, max: 1.8, step: 0.01, decimals: 2, hint: 'Number of leaf rosettes across the crown.' },

  leafSize: { label: 'Leaf size', min: 0.55, max: 1.6, step: 0.01, decimals: 2, hint: 'Length of individual leaves.' },
  rosetteLeaves: { label: 'Leaves per rosette', min: 5, max: 12, step: 1, decimals: 0, hint: 'Leaves in each star-shaped cluster.' },
  leafDroop: { label: 'Leaf droop', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'How much leaf tips point downward.' },
  leafCurl: { label: 'Leaf curl', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Cup and curl along each leaf.' },
  leafFold: { label: 'Leaf fold', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Fold each blade from its pinned base so the stem stays attached to the branch while the tip angles back.' },
  leafAlignment: { label: 'Leaf alignment', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'How closely leaves follow one smooth canopy shell. Low values let each clump fan out on its own; high values comb the whole crown into a tidy outer surface.' },
  leafGravity: { label: 'Leaf gravity', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'How strongly leaf tips sag toward the ground. Each blade stays attached at its base while its tip sinks under its own weight.' },
  leafDroopApply: { label: 'Droop coverage', min: 0, max: 100, step: 1, decimals: 0, unit: '%', hint: 'Share of leaves that receive the droop. The rest keep their natural angle.' },
  leafCurlApply: { label: 'Curl coverage', min: 0, max: 100, step: 1, decimals: 0, unit: '%', hint: 'Share of leaves that receive the curl. The rest stay flatter.' },
  leafFoldApply: { label: 'Fold coverage', min: 0, max: 100, step: 1, decimals: 0, unit: '%', hint: 'Share of leaves that receive the fold. The rest keep a straight blade.' },
  leafAlignmentApply: { label: 'Alignment coverage', min: 0, max: 100, step: 1, decimals: 0, unit: '%', hint: 'Share of leaves combed into the smooth canopy shell. The rest keep their own clump angle.' },
  leafGravityApply: { label: 'Gravity coverage', min: 0, max: 100, step: 1, decimals: 0, unit: '%', hint: 'Share of leaves that sag under gravity. The rest stay lifted.' },
  leafHue: { label: 'Leaf hue', min: -2, max: 1, step: 0.01, decimals: 2, hint: 'Shift leaf color from blossom pinks through lime green toward deep green or autumn copper.' },
  leafSaturation: { label: 'Saturation', min: 0.4, max: 1.4, step: 0.01, decimals: 2, hint: 'Color richness of the foliage.' },
  leafContrast: { label: 'Light contrast', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Difference between sunlit and shaded leaves.' },

  wind: { label: 'Wind', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'Idle movement of the leaves.' },
  sunAzimuth: { label: 'Sun direction', min: 0, max: 360, step: 1, decimals: 0, unit: '°', hint: 'Horizontal angle of the key light.' },
  sunElevation: { label: 'Sun height', min: 12, max: 82, step: 1, decimals: 0, unit: '°', hint: 'Vertical angle of the key light.' },
  sunIntensity: { label: 'Sun intensity', min: 0.8, max: 4, step: 0.05, decimals: 2, hint: 'Brightness of the main studio light.' },
  backdrop: {
    label: 'Backdrop',
    type: 'options',
    options: [
      { value: 'studio', label: 'Studio', swatch: '#e9e8e4', swatchDark: '#272b24' },
      { value: 'warm', label: 'Warm', swatch: '#ede4d4', swatchDark: '#2b241c' },
      { value: 'charcoal', label: 'Charcoal', swatch: '#33372f', swatchDark: '#33372f' },
    ],
  },
  quality: {
    label: 'Quality',
    type: 'options',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
  },
};

export const PARAM_GROUPS = [
  {
    id: 'trunk',
    label: 'Trunk',
    controls: ['trunkHeight', 'trunkRadius', 'taper', 'lean', 'rootFlare', 'rootLobes', 'barkRidge', 'barkTone'],
  },
  {
    id: 'limbs',
    label: 'Limbs',
    controls: ['limbs', 'branchLevels', 'spread', 'upBias', 'droop', 'gnarl'],
  },
  {
    id: 'crown',
    label: 'Crown',
    controls: ['crownWidth', 'crownHeight', 'crownSkew', 'puffs', 'scallop'],
  },
  {
    id: 'leaves',
    label: 'Leaves',
    controls: [
      'leafDensity',
      'leafSize',
      'rosetteLeaves',
      'leafDroop',
      'leafDroopApply',
      'leafCurl',
      'leafCurlApply',
      'leafFold',
      'leafFoldApply',
      'leafAlignment',
      'leafAlignmentApply',
      'leafGravity',
      'leafGravityApply',
      'leafHue',
      'leafSaturation',
      'leafContrast',
    ],
  },
  {
    id: 'voxel',
    label: 'Voxel',
    controls: ['voxelize', 'voxelDepth', 'voxelResolution', 'voxelMeshDetail', 'voxelPreview'],
  },
  {
    id: 'scene',
    label: 'Scene',
    controls: ['wind', 'sunAzimuth', 'sunElevation', 'sunIntensity', 'backdrop', 'quality'],
  },
];

const PRESET_OVERRIDES = {
  reference: {
    name: 'Reference Oak',
    blurb: 'The studio hero: broad crown, sculpted trunk.',
    seed: 'amber-cedar-4821',
    tone: '#6ea732',
    values: {},
  },
  lush: {
    name: 'Lush Broadleaf',
    blurb: 'Fuller, larger crown with layered leaf masses.',
    seed: 'fern-hollow-217',
    tone: '#4f8f2c',
    values: {
      trunkHeight: 2.8,
      trunkRadius: 0.52,
      crownWidth: 7.1,
      crownHeight: 5.0,
      puffs: 11,
      leafDensity: 1.05,
      leafSize: 1.24,
      scallop: 0.66,
      leafSaturation: 0.98,
      sunElevation: 55,
    },
  },
  sapling: {
    name: 'Young Sapling',
    blurb: 'Slim trunk, close leaves, spring energy.',
    seed: 'spring-birch-108',
    tone: '#8cc63f',
    values: {
      trunkHeight: 2.1,
      trunkRadius: 0.21,
      taper: 0.45,
      crownWidth: 3.8,
      crownHeight: 3.2,
      puffs: 7,
      leafDensity: 1.0,
      leafSize: 1.4,
      rosetteLeaves: 10,
      branchLevels: 3,
      rootFlare: 0.7,
      rootLobes: 4,
      crownSkew: -0.1,
      leafHue: 0.05,
    },
  },
  windblown: {
    name: 'Windblown',
    blurb: 'A leaning silhouette shaped by coastal wind.',
    seed: 'wild-ridge-633',
    tone: '#7cab34',
    values: {
      lean: 0.85,
      crownSkew: 0.5,
      crownWidth: 6.8,
      crownHeight: 4.4,
      spread: 1.2,
      upBias: 0.35,
      droop: 0.55,
      leafDroop: 0.55,
      wind: 0.55,
      trunkRadius: 0.4,
      puffs: 9,
      leafSize: 1.15,
    },
  },
  bonsai: {
    name: 'Bonsai',
    blurb: 'Short, ancient, and wider than it is tall.',
    seed: 'stone-garden-908',
    tone: '#5d8f33',
    values: {
      trunkHeight: 1.35,
      trunkRadius: 0.46,
      taper: 0.78,
      rootFlare: 1.7,
      rootLobes: 6,
      crownWidth: 5.0,
      crownHeight: 2.2,
      puffs: 8,
      branchLevels: 4,
      limbs: 3,
      leafDensity: 1.15,
      leafSize: 0.95,
      rosetteLeaves: 8,
      lean: 0.45,
      crownSkew: 0.18,
      barkTone: 0.35,
      scallop: 0.65,
      sunElevation: 55,
    },
  },
  autumn: {
    name: 'Autumn',
    blurb: 'Copper foliage with a darker, older trunk.',
    seed: 'copper-dusk-341',
    tone: '#c07b2e',
    values: {
      leafHue: -0.75,
      leafSaturation: 1.05,
      leafContrast: 0.72,
      crownWidth: 6.0,
      crownHeight: 4.5,
      leafDensity: 0.95,
      leafSize: 1.18,
      trunkRadius: 0.43,
      barkTone: 0.42,
      sunElevation: 44,
    },
  },
  cherry: {
    name: 'Cherry Blossom',
    blurb: 'Soft pink blossom clouds on a compact, spreading tree.',
    seed: 'sakura-breeze-512',
    tone: '#e9a6c1',
    values: {
      trunkHeight: 2.5,
      trunkRadius: 0.34,
      taper: 0.68,
      lean: 0.22,
      rootFlare: 1.15,
      rootLobes: 5,
      barkTone: 0.34,
      branchLevels: 4,
      spread: 1.08,
      upBias: 0.42,
      droop: 0.38,
      crownWidth: 6.4,
      crownHeight: 3.9,
      crownSkew: 0.12,
      puffs: 10,
      scallop: 0.72,
      leafDensity: 1.12,
      leafSize: 0.95,
      rosetteLeaves: 9,
      leafDroop: 0.28,
      leafCurl: 0.34,
      leafFold: 0.08,
      leafAlignment: 0.25,
      leafGravity: 0.05,
      leafHue: -1.35,
      leafSaturation: 0.86,
      leafContrast: 0.58,
      wind: 0.24,
      sunAzimuth: 320,
      sunElevation: 50,
    },
  },
};

export const PRESETS = Object.entries(PRESET_OVERRIDES).map(([id, preset]) => ({
  id,
  name: preset.name,
  blurb: preset.blurb,
  tone: preset.tone,
  seed: preset.seed,
  params: {
    ...DEFAULTS,
    ...preset.values,
    seed: preset.seed,
  },
}));

export function getPreset(id) {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
}

/* --------------------------- custom presets --------------------------- */

export const CUSTOM_PRESETS_KEY = 'canopytree-custom-presets-v1';

const CUSTOM_ID_PATTERN = /^custom-[a-z0-9-]+$/;

export function isCustomPresetId(id) {
  return typeof id === 'string' && CUSTOM_ID_PATTERN.test(id);
}

export function createCustomPresetId() {
  const stamp = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 8);
  return `custom-${stamp}-${salt}`;
}

export function cleanPresetName(name) {
  const text = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42);
  return text || 'Untitled look';
}

/** A leaf colour for the rail fallback, derived from the saved foliage. */
export function presetTone(params) {
  const rawHue = params.leafHue < 0 ? 78 + params.leafHue * 80 : 78 + params.leafHue * 36;
  const hue = Math.round(((rawHue % 360) + 360) % 360);
  const saturation = Math.round(Math.min(88, Math.max(32, params.leafSaturation * 76)));
  return `hsl(${hue} ${saturation}% 42%)`;
}

export function createCustomPreset({ name, params, thumbnail = null } = {}) {
  const cleanParams = normalizeParams(params);
  return {
    id: createCustomPresetId(),
    name: cleanPresetName(name ?? cleanParams.seed),
    blurb: 'Saved in your browser.',
    tone: presetTone(cleanParams),
    seed: cleanParams.seed,
    params: cleanParams,
    ...(thumbnail ? { thumbnail } : {}),
    createdAt: Date.now(),
  };
}

function restoreCustomPreset(entry) {
  if (!entry || typeof entry !== 'object' || !entry.params || typeof entry.params !== 'object') {
    return null;
  }
  const params = normalizeParams(entry.params);
  const thumbnail =
    typeof entry.thumbnail === 'string' && entry.thumbnail.startsWith('data:image/') ? entry.thumbnail : null;
  return {
    id: isCustomPresetId(entry.id) ? entry.id : createCustomPresetId(),
    name: cleanPresetName(entry.name ?? params.seed),
    blurb: typeof entry.blurb === 'string' ? entry.blurb.slice(0, 120) : 'Saved in your browser.',
    tone: typeof entry.tone === 'string' && entry.tone ? entry.tone : presetTone(params),
    seed: params.seed,
    params,
    ...(thumbnail ? { thumbnail } : {}),
    createdAt: Number(entry.createdAt) || Date.now(),
  };
}

export function loadCustomPresets() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  const seen = new Set();
  const presets = [];
  for (const entry of stored) {
    const preset = restoreCustomPreset(entry);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
  }
  return presets;
}

export function saveCustomPresets(presets) {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch {
    // Thumbnails are the biggest part of the payload. Keep the presets even
    // when the browser is close to its storage quota.
    try {
      localStorage.setItem(
        CUSTOM_PRESETS_KEY,
        JSON.stringify(presets.map(({ thumbnail, ...rest }) => rest)),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export function serializePresets(presets) {
  return `${JSON.stringify(
    {
      format: 'canopytree-presets',
      version: 1,
      presets: presets.map((preset) => ({
        name: preset.name,
        params: preset.params,
      })),
    },
    null,
    2,
  )}\n`;
}

function presetEntries(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.presets)) return data.presets;
  if (Array.isArray(data.looks)) return data.looks;
  if (data.preset && typeof data.preset === 'object') return [data.preset];
  return [data];
}

/**
 * Read a preset file. Accepts a single preset, an array of presets, or a
 * library written by `serializePresets`, and ignores entries with no tree data.
 */
export function parsePresetFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const presets = [];
  for (const entry of presetEntries(data)) {
    if (!entry || typeof entry !== 'object') continue;
    const source =
      entry.params && typeof entry.params === 'object'
        ? entry.params
        : entry.values && typeof entry.values === 'object'
          ? entry.values
          : entry;
    const hasTreeParam = Object.keys(PARAM_META).some((key) =>
      Object.prototype.hasOwnProperty.call(source, key),
    );
    if (!hasTreeParam) continue;
    const params = normalizeParams(source);
    presets.push({
      name: cleanPresetName(entry.name ?? params.seed),
      params,
    });
  }

  if (!presets.length) throw new Error('No presets were found in that file.');
  return presets;
}

export function cloneParams(params) {
  return { ...params };
}

export function clampParam(key, value) {
  const meta = PARAM_META[key];
  if (!meta) return value;
  if (meta.type === 'toggle') {
    return value === true || value === 1 || value === 'true' || value === 'on';
  }
  if (meta.type === 'options') {
    return meta.options.some((option) => option.value === value) ? value : DEFAULTS[key];
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULTS[key];
  return Math.min(meta.max, Math.max(meta.min, number));
}

export function normalizeParams(input = {}) {
  const params = { ...DEFAULTS };
  params.seed = sanitizeSeed(input.seed ?? DEFAULTS.seed);
  for (const key of Object.keys(PARAM_META)) {
    if (input[key] !== undefined) params[key] = clampParam(key, input[key]);
  }
  return params;
}

/* ----------------------------- URL state ----------------------------- */

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '==='.slice((padded.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeState(params, presetId) {
  const overrides = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'seed') continue;
    if (params[key] !== DEFAULTS[key]) overrides[key] = params[key];
  }
  const payload = {
    v: 1,
    s: params.seed,
    p: overrides,
    ...(presetId ? { preset: presetId } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeState(hash) {
  if (!hash) return null;
  try {
    const raw = fromBase64Url(hash);
    const payload = JSON.parse(raw);
    if (!payload || payload.v !== 1) return null;
    const params = normalizeParams({ ...DEFAULTS, ...(payload.p ?? {}), seed: payload.s ?? DEFAULTS.seed });
    const presetId = typeof payload.preset === 'string' && payload.preset ? payload.preset : null;
    return { params, presetId };
  } catch {
    return null;
  }
}

/** Build a shareable URL for the current state. */
export function buildShareUrl(params, presetId) {
  const url = new URL(window.location.href);
  url.hash = encodeState(params, presetId);
  return url.toString();
}
