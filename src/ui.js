import {
  DEFAULTS,
  PARAM_GROUPS,
  PARAM_META,
  PRESETS,
  QUICK_CONTROLS,
  clampParam,
} from './state.js';
import { randomSeed, sanitizeSeed } from './rng.js';

const numberFormat = new Intl.NumberFormat('en-US');
const SCENE_ONLY = new Set(['wind', 'sunAzimuth', 'sunElevation', 'sunIntensity', 'backdrop', 'quality', 'voxelPreview']);
const LEAF_ICON = `
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 27V14.5m0 0c-6.5 0-9.5-4.4-9.5-9.2C12.8 5.3 16 8.3 16 14.5Zm0 3.2c6.1 0 9.4-3.8 9.4-8.3-5.6 0-9.4 3.3-9.4 8.3Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function renderValue(output, key, value) {
  const meta = PARAM_META[key];
  output.textContent = '';
  let text;
  if (key === 'leafHue') {
    text = `${value > 0 ? '+' : ''}${formatNumber(value, 2)}`;
  } else {
    text = formatNumber(value, meta.decimals ?? 2);
  }
  const span = document.createElement('span');
  span.textContent = text;
  output.appendChild(span);
  if (meta.unit) {
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = meta.unit;
    output.appendChild(unit);
  }
}

function fillPercent(key, value) {
  const meta = PARAM_META[key];
  return ((value - meta.min) / (meta.max - meta.min)) * 100;
}

export function createUI(options) {
  const {
    getParams,
    getPresetId,
    onParamChange,
    onSeedChange,
    onRegenerate,
    onPresetSelect,
    onSurprise,
    onReset,
    onShare,
    onExport,
    onToggleTurntable,
    onToggleHidden,
    onThemeChange,
    onSavePreset,
    onImportPresets,
    onDeletePreset,
    view,
    onViewChange,
  } = options;

  const dom = {
    panel: document.getElementById('panel'),
    panelScroll: document.getElementById('panel-scroll'),
    panelClose: document.getElementById('panel-close'),
    panelReset: document.getElementById('panel-reset'),
    hideLeaves: document.getElementById('hide-leaves'),
    hideBranches: document.getElementById('hide-branches'),
    viewModes: document.getElementById('view-modes'),
    looks: document.getElementById('looks'),
    looksCollapse: document.getElementById('looks-collapse'),
    quick: document.getElementById('quick-controls'),
    advancedToggle: document.getElementById('advanced-toggle'),
    advancedBody: document.getElementById('advanced-body'),
    tabs: document.getElementById('param-tabs'),
    paramPanel: document.getElementById('param-panel'),
    seedDice: document.getElementById('seed-dice'),
    seedAgain: document.getElementById('seed-again'),
    seedInput: document.getElementById('seed-input'),
    shareButton: document.getElementById('share-button'),
    themeButton: document.getElementById('theme-button'),
    helpButton: document.getElementById('help-button'),
    exportButton: document.getElementById('export-button'),
    presetRail: document.getElementById('preset-rail'),
    savePresetButton: document.getElementById('save-preset-button'),
    importPresetButton: document.getElementById('import-preset-button'),
    presetFileInput: document.getElementById('preset-file-input'),
    hint: document.getElementById('hint'),
    tuneFab: document.getElementById('tune-fab'),
    mobileScrim: document.getElementById('mobile-scrim'),
    reveal: document.getElementById('ui-reveal'),
    stats: document.getElementById('tree-stats'),
    time: document.getElementById('tree-time'),
    foot: document.querySelector('.panel-foot'),
    loadingVeil: document.getElementById('loading-veil'),
    loadingLabel: document.getElementById('loading-label'),
    modalRoot: document.getElementById('modal-root'),
    toastRoot: document.getElementById('toast-root'),
  };

  let uid = 0;
  let activeTab = 'trunk';
  let seedHistory = [];
  let seedIndex = -1;
  let activeOverlay = null;
  let uiHidden = false;
  let lastStats = null;
  let hintTimer = null;
  let stats = { leaves: 0, rosettes: 0, branches: 0, ms: 0 };
  const themeSwatchUpdates = [];
  let theme = 'light';
  try {
    const storedTheme = localStorage.getItem('canopytree-theme');
    if (storedTheme === 'dark' || storedTheme === 'light') theme = storedTheme;
  } catch {
    /* storage can be unavailable */
  }
  let autoRotate = false;
  let frameHandler = null;
  let viewState = {
    hideLeaves: Boolean(view?.hideLeaves),
    hideBranches: Boolean(view?.hideBranches),
    shading: view?.shading === 'gray' || view?.shading === 'wire' ? view.shading : 'natural',
  };
  let panelCollapsed = false;
  let looksCollapsed = false;
  try {
    panelCollapsed = localStorage.getItem('canopytree-panel-collapsed') === '1';
  } catch {
    /* storage can be unavailable */
  }
  try {
    looksCollapsed = localStorage.getItem('canopytree-looks-collapsed') === '1';
  } catch {
    /* storage can be unavailable */
  }

  /* --------------------------------------------------------------- helpers */

  function makeControl(key) {
    const meta = PARAM_META[key];
    const wrapper = document.createElement('div');
    wrapper.className = 'control';
    wrapper.dataset.controlKey = key;

    if (meta.type === 'toggle') {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'control-toggle';
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', 'false');
      row.title = meta.hint ?? meta.label;
      row.innerHTML = `<span class="control-toggle-label">${meta.label}</span><span class="switch" aria-hidden="true"></span>`;

      const needsVoxelize = key === 'voxelPreview';
      const paint = (value) => {
        const on = Boolean(value);
        row.classList.toggle('is-on', on);
        row.setAttribute('aria-checked', on ? 'true' : 'false');
        row.querySelector('.switch')?.classList.toggle('is-on', on);
        if (needsVoxelize) {
          const enabled = Boolean(getParams().voxelize);
          row.disabled = !enabled;
          row.classList.toggle('is-disabled', !enabled);
        }
      };
      paint(getParams()[key]);

      row.addEventListener('click', () => {
        if (row.disabled) return;
        const next = !getParams()[key];
        paint(next);
        onParamChange(key, next, 'commit');
        if (key === 'voxelize') updateState('voxelPreview', getParams().voxelPreview);
        if (!SCENE_ONLY.has(key)) markCustom();
        dismissHint();
      });

      wrapper.appendChild(row);
      wrapper._update = paint;
      return wrapper;
    }

    if (meta.type === 'options') {
      const head = document.createElement('div');
      head.className = 'control-head';
      const label = document.createElement('span');
      label.className = 'control-label';
      label.textContent = meta.label;
      label.title = meta.hint ?? meta.label;
      head.appendChild(label);
      wrapper.appendChild(head);

      const usesSwatch = meta.options.some((option) => option.swatch);
      const group = document.createElement('div');
      group.className = usesSwatch ? 'swatches' : 'segmented';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', meta.label);
      const buttons = [];
      for (const option of meta.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = option.value;
        if (usesSwatch) {
          button.className = 'swatch';
          button.innerHTML = `<i></i><span>${option.label}</span>`;
          const chip = button.querySelector('i');
          const paintSwatch = () => {
            const color = theme === 'dark' ? (option.swatchDark ?? option.swatch) : option.swatch;
            chip.style.setProperty('--swatch', color);
          };
          paintSwatch();
          themeSwatchUpdates.push(paintSwatch);
        } else {
          button.textContent = option.label;
        }
        button.addEventListener('click', () => {
          const params = getParams();
          if (params[key] === option.value) return;
          onParamChange(key, option.value, 'commit');
          updateState(key, option.value);
          if (!SCENE_ONLY.has(key)) markCustom();
        });
        group.appendChild(button);
        buttons.push(button);
      }
      wrapper.appendChild(group);

      wrapper._update = (value) => {
        for (const button of buttons) {
          const active = button.dataset.value === value;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
      };
      return wrapper;
    }

    const controlId = `ctl-${key}-${uid++}`;
    const params = getParams();
    const head = document.createElement('div');
    head.className = 'control-head';
    const label = document.createElement('label');
    label.className = 'control-label';
    label.htmlFor = controlId;
    label.textContent = meta.label;
    label.title = meta.hint ?? meta.label;
    const output = document.createElement('output');
    output.className = 'control-value';
    output.htmlFor = controlId;
    head.append(label, output);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = controlId;
    input.min = meta.min;
    input.max = meta.max;
    input.step = meta.step;
    input.value = params[key];
    input.setAttribute('aria-label', meta.label);

    wrapper.append(head, input);

    const paint = (value) => {
      const numeric = clampParam(key, Number(value));
      input.value = numeric;
      input.style.setProperty('--fill', `${fillPercent(key, numeric)}%`);
      renderValue(output, key, numeric);
    };
    paint(params[key]);

    input.addEventListener('input', () => {
      const value = Number(input.value);
      paint(value);
      onParamChange(key, value, 'live');
      if (!SCENE_ONLY.has(key)) markCustom();
      dismissHint();
    });

    input.addEventListener('change', () => {
      const value = Number(input.value);
      onParamChange(key, value, 'commit');
    });

    wrapper.addEventListener('dblclick', (event) => {
      if (event.target === input) return;
      const value = DEFAULTS[key];
      paint(value);
      onParamChange(key, value, 'commit');
      markCustom();
    });

    wrapper._update = paint;
    return wrapper;
  }

  function updateState(key, value) {
    for (const element of document.querySelectorAll(`.control[data-control-key="${key}"]`)) {
      element._update?.(value);
    }
  }

  function paintViewControls() {
    dom.hideLeaves?.setAttribute('aria-pressed', viewState.hideLeaves ? 'true' : 'false');
    dom.hideBranches?.setAttribute('aria-pressed', viewState.hideBranches ? 'true' : 'false');
    for (const button of dom.viewModes?.querySelectorAll('button') ?? []) {
      const active = button.dataset.shading === viewState.shading;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function setView(next) {
    viewState = { ...viewState, ...next };
    paintViewControls();
    onViewChange?.({ ...viewState });
  }

  paintViewControls();

  /* ---------------------------------------------------------- build panels */

  for (const key of QUICK_CONTROLS) {
    dom.quick.appendChild(makeControl(key));
  }

  for (const group of PARAM_GROUPS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    tab.id = `tab-${group.id}`;
    tab.dataset.tab = group.id;
    tab.textContent = group.label;
    tab.setAttribute('aria-selected', group.id === activeTab ? 'true' : 'false');
    tab.setAttribute('aria-controls', `panel-${group.id}`);
    tab.tabIndex = group.id === activeTab ? 0 : -1;
    tab.addEventListener('click', () => selectTab(group.id));
    dom.tabs.appendChild(tab);

    const panel = document.createElement('div');
    panel.id = `panel-${group.id}`;
    panel.dataset.panel = group.id;
    panel.hidden = group.id !== activeTab;
    for (const key of group.controls) {
      panel.appendChild(makeControl(key));
    }
    dom.paramPanel.appendChild(panel);
  }

  function selectTab(id) {
    activeTab = id;
    for (const tab of dom.tabs.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of dom.paramPanel.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== id;
    }
  }

  dom.tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tabs = [...dom.tabs.querySelectorAll('[role="tab"]')];
    const current = tabs.findIndex((tab) => tab.dataset.tab === activeTab);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = (current + direction + tabs.length) % tabs.length;
    tabs[next].focus();
    selectTab(tabs[next].dataset.tab);
  });

  dom.advancedToggle.addEventListener('click', () => {
    const open = dom.advancedToggle.getAttribute('aria-expanded') === 'true';
    dom.advancedToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    dom.advancedBody.hidden = open;
    if (!open) {
      requestAnimationFrame(() => {
        dom.advancedBody.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  });

  dom.panelReset.addEventListener('click', () => {
    onReset();
  });

  /* ---------------------------------------------------------- preset cards */

  function paintThumbnail(card, dataUrl) {
    const thumb = card.querySelector('.look-thumb');
    const image = card.querySelector('img');
    if (!thumb || !image || !dataUrl) return;
    image.onload = () => thumb.classList.add('is-ready');
    image.src = dataUrl;
  }

  function makePresetCard(preset) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'look-card';
    button.dataset.preset = preset.id;
    button.title = preset.blurb;
    button.setAttribute('role', 'listitem');
    button.innerHTML = `
      <span class="look-thumb" style="--tone:${preset.tone}">
        <span class="look-fallback">${LEAF_ICON}</span>
        <img alt="" draggable="false" />
      </span>
      <span class="look-name">${preset.name}</span>
    `;
    if (preset.thumbnail) paintThumbnail(button, preset.thumbnail);
    button.addEventListener('click', () => {
      onPresetSelect(preset.id);
      dismissHint();
    });
    return button;
  }

  for (const preset of PRESETS) {
    dom.presetRail.appendChild(makePresetCard(preset));
  }

  const surprise = document.createElement('button');
  surprise.type = 'button';
  surprise.className = 'look-card surprise';
  surprise.title = 'Generate a new variation';
  surprise.setAttribute('role', 'listitem');
  surprise.innerHTML = `
    <span class="look-thumb surprise-thumb">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4.5" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="9" cy="9" r="1.2" fill="currentColor"/>
        <circle cx="15" cy="15" r="1.2" fill="currentColor"/>
        <circle cx="15" cy="9" r="1.2" fill="currentColor"/>
        <circle cx="9" cy="15" r="1.2" fill="currentColor"/>
      </svg>
    </span>
    <span class="look-name">Surprise me</span>
  `;
  surprise.addEventListener('click', () => {
    onSurprise();
    dismissHint();
  });
  dom.presetRail.appendChild(surprise);

  let customPresets = [];

  function makeCustomCard(preset) {
    const slot = document.createElement('div');
    slot.className = 'look-slot';
    slot.dataset.customId = preset.id;

    const card = makePresetCard(preset);
    card.classList.add('is-custom');

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'look-delete';
    remove.title = 'Delete preset';
    remove.setAttribute('aria-label', `Delete ${preset.name}`);
    remove.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
      </svg>
    `;
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestDeletePreset(preset);
    });

    slot.append(card, remove);
    return slot;
  }

  function setCustomPresets(list) {
    customPresets = Array.isArray(list) ? list : [];
    for (const slot of dom.presetRail.querySelectorAll('.look-slot')) slot.remove();
    for (const preset of customPresets) {
      dom.presetRail.insertBefore(makeCustomCard(preset), surprise);
    }
  }

  function setActivePreset(id) {
    for (const card of dom.presetRail.querySelectorAll('[data-preset]')) {
      card.classList.toggle('is-active', card.dataset.preset === id);
    }
  }

  function setPresetThumbnail(id, dataUrl) {
    const card = dom.presetRail.querySelector(`[data-preset="${id}"]`);
    if (!card) return;
    paintThumbnail(card, dataUrl);
  }

  function markCustom() {
    setActivePreset(null);
  }

  /* ------------------------------------------------------------ seed logic */

  function setSeedValue(seed, { record = true } = {}) {
    const sanitized = sanitizeSeed(seed);
    dom.seedInput.value = sanitized;
    if (record && seedHistory[seedIndex] !== sanitized) {
      seedHistory = seedHistory.slice(0, seedIndex + 1);
      seedHistory.push(sanitized);
      seedIndex = seedHistory.length - 1;
    }
  }

  function requestSeed(seed, { record = true } = {}) {
    const sanitized = sanitizeSeed(seed);
    dom.seedInput.value = sanitized;
    if (record) {
      if (seedHistory[seedIndex] !== sanitized) {
        seedHistory = seedHistory.slice(0, seedIndex + 1);
        seedHistory.push(sanitized);
        seedIndex = seedHistory.length - 1;
      }
    }
    onSeedChange(sanitized);
    dismissHint();
  }

  function stepSeed(direction) {
    const next = seedIndex + direction;
    if (next < 0 || next >= seedHistory.length) {
      showToast(direction < 0 ? 'No earlier seed' : 'No later seed');
      return;
    }
    seedIndex = next;
    dom.seedInput.value = seedHistory[seedIndex];
    onSeedChange(seedHistory[seedIndex]);
  }

  dom.seedDice.addEventListener('click', () => {
    requestSeed(randomSeed());
  });

  dom.seedAgain.addEventListener('click', () => {
    dom.seedAgain.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    onRegenerate();
  });

  dom.seedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dom.seedInput.blur();
    } else if (event.key === 'Escape') {
      dom.seedInput.value = getParams().seed;
      dom.seedInput.blur();
    }
  });

  dom.seedInput.addEventListener('blur', () => {
    const next = sanitizeSeed(dom.seedInput.value);
    if (next !== getParams().seed) requestSeed(next);
    else dom.seedInput.value = next;
  });

  /* -------------------------------------------------------------- advanced */

  // Start with the advanced section closed; the quick controls carry the look.
  dom.advancedToggle.setAttribute('aria-expanded', 'false');
  dom.advancedBody.hidden = true;

  /* ------------------------------------------------------------- chrome ops */

  dom.shareButton.addEventListener('click', async () => {
    try {
      const url = await onShare();
      await copyText(url);
      showToast('Share link copied');
    } catch (error) {
      showToast(error?.message || 'Could not copy the link', true);
    }
  });

  function setTheme(nextTheme, { notify = true } = {}) {
    theme = nextTheme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#141612' : '#e8e7e3');
    dom.themeButton?.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    for (const paintSwatch of themeSwatchUpdates) paintSwatch();
    try {
      localStorage.setItem('canopytree-theme', theme);
    } catch {
      /* storage can be unavailable */
    }
    if (notify) onThemeChange?.(theme);
  }

  dom.themeButton.addEventListener('click', () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  });

  dom.savePresetButton?.addEventListener('click', () => openSavePreset());
  dom.importPresetButton?.addEventListener('click', () => dom.presetFileInput?.click());
  dom.presetFileInput?.addEventListener('change', handlePresetFile);

  dom.exportButton.addEventListener('click', () => {
    openExport();
  });

  dom.helpButton.addEventListener('click', () => {
    openHelp();
  });

  dom.hideLeaves?.addEventListener('click', () => {
    setView({ hideLeaves: !viewState.hideLeaves });
  });
  dom.hideBranches?.addEventListener('click', () => {
    setView({ hideBranches: !viewState.hideBranches });
  });
  dom.viewModes?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-shading]');
    if (!button) return;
    setView({ shading: button.dataset.shading });
  });

  dom.looksCollapse?.addEventListener('click', () => setLooksCollapsed(!looksCollapsed));
  setLooksCollapsed(looksCollapsed);

  dom.panelClose.addEventListener('click', () => setPanelCollapsed(true));
  dom.tuneFab.addEventListener('click', () => setPanelCollapsed(false));
  dom.mobileScrim.addEventListener('click', closeMobilePanel);

  dom.reveal.addEventListener('click', () => setUIHidden(false));

  // Apply the remembered collapse state before the entrance animation settles.
  document.body.classList.toggle('panel-collapsed', panelCollapsed);
  dom.panel.addEventListener('animationend', (event) => {
    if (event.target === dom.panel && event.animationName === 'rise-in') {
      dom.panel.classList.add('panel-entered');
    }
  });

  function setLooksCollapsed(collapsed) {
    looksCollapsed = collapsed;
    dom.looks?.classList.toggle('is-collapsed', collapsed);
    const label = collapsed ? 'Expand looks' : 'Collapse looks';
    dom.looksCollapse?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    dom.looksCollapse?.setAttribute('aria-label', label);
    if (dom.looksCollapse) dom.looksCollapse.title = label;
    try {
      localStorage.setItem('canopytree-looks-collapsed', collapsed ? '1' : '0');
    } catch {
      /* storage can be unavailable */
    }
  }

  function setPanelCollapsed(collapsed) {
    if (window.innerWidth <= 1120) {
      if (collapsed) closeMobilePanel();
      else openMobilePanel();
      return;
    }
    document.body.classList.toggle('panel-collapsed', collapsed);
    try {
      localStorage.setItem('canopytree-panel-collapsed', collapsed ? '1' : '0');
    } catch {
      /* storage can be unavailable */
    }
    if (!collapsed) {
      requestAnimationFrame(() => dom.panelClose.focus({ preventScroll: true }));
    } else {
      requestAnimationFrame(() => dom.tuneFab.focus({ preventScroll: true }));
    }
  }

  function openMobilePanel() {
    document.body.classList.add('panel-open');
    document.body.classList.remove('panel-collapsed');
    try {
      localStorage.setItem('canopytree-panel-collapsed', '0');
    } catch {
      /* storage can be unavailable */
    }
    dom.panelScroll.scrollTop = 0;
    requestAnimationFrame(() => {
      dom.panelClose.focus({ preventScroll: true });
    });
  }

  function closeMobilePanel() {
    document.body.classList.remove('panel-open');
  }

  function setUIHidden(hidden, { notify = true } = {}) {
    uiHidden = hidden;
    document.body.classList.toggle('ui-hidden', hidden);
    dom.reveal.hidden = !hidden;
    if (notify) onToggleHidden?.(hidden);
    if (!hidden) dismissHint();
  }

  /* ------------------------------------------------------------------ hint */

  function dismissHint() {
    if (!dom.hint) return;
    dom.hint.classList.add('is-hidden');
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
  }

  hintTimer = setTimeout(dismissHint, 10000);
  document.getElementById('viewport').addEventListener('pointerdown', dismissHint, { once: true });

  /* --------------------------------------------------------------- overlays */

  function openOverlay(modal, { onClose } = {}) {
    closeOverlay();
    const previousFocus = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.appendChild(modal);
    dom.modalRoot.append(scrim, wrap);

    const close = () => {
      if (activeOverlay?.closing) return;
      activeOverlay.closing = true;
      document.removeEventListener('keydown', onOverlayKeydown, true);
      scrim.remove();
      wrap.remove();
      activeOverlay = null;
      onClose?.();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus({ preventScroll: true });
      }
    };

    const onOverlayKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [
        ...modal.querySelectorAll(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    activeOverlay = { close, wrap, scrim };
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', onOverlayKeydown, true);
    requestAnimationFrame(() => {
      const focusTarget = modal.querySelector('[data-autofocus]') || modal.querySelector('button');
      focusTarget?.focus({ preventScroll: true });
    });
  }

  function closeOverlay() {
    activeOverlay?.close?.();
  }

  function modalHeader(eyebrow, title, subtitle) {
    const head = document.createElement('div');
    head.className = 'modal-head';
    head.innerHTML = `
      <div>
        <p class="eyebrow">${eyebrow}</p>
        <h3>${title}</h3>
        ${subtitle ? `<p class="modal-sub">${subtitle}</p>` : ''}
      </div>
      <button class="icon-button" type="button" data-close aria-label="Close dialog">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    return head;
  }

  function openHelp() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'help-title');

    const header = modalHeader('Guide', 'Make it yours', 'A quick map of the studio and its shortcuts.');
    header.querySelector('h3').id = 'help-title';
    modal.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'help-grid';
    const rows = [
      ['Orbit the tree', ['Drag']],
      ['Pan the view', ['Right-drag']],
      ['Zoom in / out', ['Scroll']],
      ['Regenerate same seed', ['R']],
      ['New seed', ['S']],
      ['Frame the tree', ['F']],
      ['Hide the interface', ['H']],
      ['Hide leaves', ['L']],
      ['Hide branches', ['B']],
      ['Gray shading', ['G']],
      ['Wireframe', ['W']],
      ['Switch looks', ['1', '–', '6']],
      ['Turntable', ['T']],
      ['Seed history', ['Alt', '← / →']],
    ];
    for (const [label, keys] of rows) {
      const row = document.createElement('div');
      row.className = 'help-row';
      const text = document.createElement('span');
      text.textContent = label;
      const keyWrap = document.createElement('span');
      keyWrap.className = 'keys';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        keyWrap.appendChild(kbd);
      }
      row.append(text, keyWrap);
      grid.appendChild(row);
    }
    modal.appendChild(grid);

    const note = document.createElement('div');
    note.className = 'help-note';
    note.textContent =
      'Each tree is deterministic: the seed and every slider create the same result. Copy a share link to keep a look, or export a PNG or GLB to take it elsewhere. View settings are preview-only and never reach exports. The Voxel tab rebuilds the wood as a seamless remesh; its blocky grid view is diagnostic only.';
    modal.appendChild(note);

    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) closeOverlay();
    });

    openOverlay(modal);
  }

  function openExport() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'export-title');

    const header = modalHeader('Export', 'Take it with you', 'Rendered from the current camera angle.');
    header.querySelector('h3').id = 'export-title';
    modal.appendChild(header);

    let format = 'png';
    let orientation = 'square';
    let sizeIndex = 1;
    let transparent = false;
    let busy = false;

    const formatBlock = document.createElement('div');
    formatBlock.className = 'segmented export-format';
    formatBlock.innerHTML = `
      <button type="button" data-format="png" class="is-active">PNG image</button>
      <button type="button" data-format="glb">3D model</button>
    `;
    modal.appendChild(formatBlock);

    const pngBlock = document.createElement('div');
    pngBlock.dataset.section = 'png';
    pngBlock.innerHTML = `
      <div class="option-block">
        <div class="option-label"><span>Shape</span><span class="small-note">Fixed output</span></div>
        <div class="segmented" data-orientation-group>
          <button type="button" data-orientation="view">Match view</button>
          <button type="button" data-orientation="square" class="is-active">Square</button>
          <button type="button" data-orientation="wide">16:9</button>
        </div>
      </div>
      <div class="option-block">
        <div class="option-label"><span>Resolution</span><span class="small-note" data-size-note></span></div>
        <div class="segmented" data-size-group>
          <button type="button" data-size="0">1K</button>
          <button type="button" data-size="1" class="is-active">2K</button>
          <button type="button" data-size="2">4K</button>
        </div>
      </div>
      <div class="option-block">
        <div class="option-label">
          <span>Transparent background</span>
          <button class="switch" type="button" role="switch" aria-checked="false" aria-label="Transparent background"></button>
        </div>
      </div>
    `;
    modal.appendChild(pngBlock);

    const glbBlock = document.createElement('div');
    glbBlock.dataset.section = 'glb';
    glbBlock.hidden = true;
    glbBlock.innerHTML = `
      <div class="option-block">
        <div class="option-label"><span>Geometry</span><span class="small-note">Leaf instances baked</span></div>
        <p class="modal-sub" style="margin-top:0">A single optimized mesh with bark and foliage colors. Best for Blender, Unity, or three.js.</p>
      </div>
    `;
    modal.appendChild(glbBlock);

    const summary = document.createElement('div');
    summary.className = 'export-summary';
    modal.appendChild(summary);

    const progress = document.createElement('div');
    progress.className = 'export-progress';
    progress.innerHTML = '<span></span>';
    modal.appendChild(progress);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'primary-button wide-button';
    action.dataset.autofocus = '';
    action.textContent = 'Download PNG';
    modal.appendChild(action);

    const fine = document.createElement('p');
    fine.className = 'fine-print';
    fine.textContent = 'PNG renders at a fixed pixel size. Square and 16:9 keep the tree vertically framed; Match view uses the current viewport aspect. GLB contains the tree only, not the studio floor.';
    modal.appendChild(fine);

    const viewportSize = () => {
      const viewport = document.getElementById('viewport');
      return {
        width: Math.max(1, viewport.clientWidth),
        height: Math.max(1, viewport.clientHeight),
      };
    };

    const viewWidths = [1024, 2048, 4096];
    const squareSizes = [1024, 2048, 4096];
    const wideSizes = [[1920, 1080], [2560, 1440], [3840, 2160]];

    const outputSize = () => {
      if (orientation === 'view') {
        const viewport = viewportSize();
        const width = viewWidths[sizeIndex];
        return {
          width,
          height: Math.max(1, Math.round((width * viewport.height) / viewport.width)),
        };
      }
      if (orientation === 'wide') {
        const [width, height] = wideSizes[sizeIndex];
        return { width, height };
      }
      const width = squareSizes[sizeIndex];
      return { width, height: width };
    };

    const sizeLabels = () => (orientation === 'wide' ? ['1080p', '1440p', '4K'] : ['1K', '2K', '4K']);

    const updateSummary = () => {
      if (format === 'png') {
        const { width, height } = outputSize();
        summary.innerHTML = `<span>Output</span><strong>${numberFormat.format(width)} × ${numberFormat.format(height)} px</strong>`;
      } else {
        summary.innerHTML = `<span>Foliage</span><strong>${numberFormat.format(stats.leaves)} leaves · ${numberFormat.format(stats.branches)} limbs</strong>`;
      }
    };

    const updatePngControls = () => {
      const labels = sizeLabels();
      for (const button of pngBlock.querySelectorAll('[data-orientation]')) {
        button.classList.toggle('is-active', button.dataset.orientation === orientation);
      }
      for (const button of pngBlock.querySelectorAll('[data-size]')) {
        const index = Number(button.dataset.size);
        button.textContent = labels[index];
        button.classList.toggle('is-active', index === sizeIndex);
      }
      const note = pngBlock.querySelector('[data-size-note]');
      if (note) {
        note.textContent = orientation === 'view' ? 'View aspect' : orientation === 'wide' ? '16:9' : '1:1';
      }
      updateSummary();
    };

    const updateFormat = () => {
      pngBlock.hidden = format !== 'png';
      glbBlock.hidden = format !== 'glb';
      for (const button of formatBlock.querySelectorAll('[data-format]')) {
        button.classList.toggle('is-active', button.dataset.format === format);
      }
      action.textContent = format === 'png' ? 'Download PNG' : 'Download 3D model';
      updateSummary();
    };

    formatBlock.addEventListener('click', (event) => {
      const button = event.target.closest('[data-format]');
      if (!button || busy) return;
      format = button.dataset.format;
      updateFormat();
    });

    pngBlock.querySelector('[data-orientation-group]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-orientation]');
      if (!button || busy) return;
      orientation = button.dataset.orientation;
      updatePngControls();
    });

    pngBlock.querySelector('[data-size-group]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-size]');
      if (!button || busy) return;
      sizeIndex = Number(button.dataset.size);
      updatePngControls();
    });

    const transparentSwitch = pngBlock.querySelector('.switch');
    transparentSwitch.addEventListener('click', () => {
      if (busy) return;
      transparent = !transparent;
      transparentSwitch.classList.toggle('is-on', transparent);
      transparentSwitch.setAttribute('aria-checked', transparent ? 'true' : 'false');
    });

    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) closeOverlay();
    });

    action.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      action.disabled = true;
      action.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.8v10.4m0 0 4-4m-4 4-4-4M5 16.5v2.2A1.8 1.8 0 0 0 6.8 20.5h10.4a1.8 1.8 0 0 0 1.8-1.8v-2.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Preparing…</span>';
      progress.classList.add('is-visible');
      try {
        const seed = sanitizeSeed(getParams().seed);
        const stamp = new Date().toISOString().slice(0, 10);
        if (format === 'png') {
          const dimensions = outputSize();
          const dataUrl = await onExport('png', {
            width: dimensions.width,
            height: dimensions.height,
            transparent,
          });
          const filename = `canopytree-${seed}-${stamp}.png`;
          downloadDataUrl(dataUrl, filename);
          showToast(`PNG saved · ${dimensions.width} × ${dimensions.height}`);
        } else {
          const blob = await onExport('glb', {});
          const filename = `canopytree-${seed}-${stamp}.glb`;
          downloadBlob(blob, filename);
          showToast('3D model saved');
        }
      } catch (error) {
        console.error(error);
        showToast(error?.message || 'Export failed', true);
      } finally {
        busy = false;
        action.disabled = false;
        action.innerHTML = format === 'png' ? 'Download PNG' : 'Download 3D model';
        progress.classList.remove('is-visible');
      }
    });

    updatePngControls();
    openOverlay(modal);
  }

  /* ---------------------------------------------------------- preset tools */

  function defaultPresetName() {
    const seed = getParams()?.seed ?? '';
    const words = seed.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!words) return 'My look';
    return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).slice(0, 42);
  }

  function openSavePreset() {
    const modal = document.createElement('div');
    modal.className = 'modal modal-compact';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'save-preset-title');

    const header = modalHeader(
      'Preset',
      'Save this look',
      'Keeps the seed, shape, foliage, and scene settings together.',
    );
    header.querySelector('h3').id = 'save-preset-title';
    modal.appendChild(header);

    const form = document.createElement('form');
    form.className = 'preset-form';
    form.innerHTML = `
      <label class="preset-field">
        <span>Name</span>
        <input type="text" name="preset-name" maxlength="42" autocomplete="off" spellcheck="false" data-autofocus />
      </label>
      <p class="preset-hint">Stored in this browser. Download the JSON to move it to another device or share it.</p>
      <p class="preset-error" role="alert" hidden></p>
      <div class="preset-actions">
        <button class="soft-button" type="button" data-download>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3.8v10.6m0 0 4-4m-4 4-4-4M5 16.6v2.1a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Download JSON</span>
        </button>
        <button class="primary-button" type="submit">Save preset</button>
      </div>
    `;
    modal.appendChild(form);

    const input = form.querySelector('input');
    const error = form.querySelector('.preset-error');
    const saveButton = form.querySelector('[type="submit"]');
    const downloadButton = form.querySelector('[data-download]');
    input.value = defaultPresetName();
    let busy = false;

    const submit = async (download) => {
      if (busy) return;
      const name = input.value.trim();
      if (!name) {
        error.textContent = 'Give the look a name first.';
        error.hidden = false;
        input.focus();
        return;
      }
      busy = true;
      saveButton.disabled = true;
      downloadButton.disabled = true;
      try {
        if (!onSavePreset) throw new Error('Saving is unavailable right now.');
        await onSavePreset(name, { download });
        closeOverlay();
        dismissHint();
        showToast(download ? 'Preset saved and downloaded' : 'Preset saved');
      } catch (err) {
        error.textContent = err?.message || 'Could not save the preset.';
        error.hidden = false;
        busy = false;
        saveButton.disabled = false;
        downloadButton.disabled = false;
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit(false);
    });
    downloadButton.addEventListener('click', () => submit(true));
    input.addEventListener('input', () => {
      error.hidden = true;
    });
    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) closeOverlay();
    });

    openOverlay(modal);
    requestAnimationFrame(() => input.select());
  }

  function requestDeletePreset(preset) {
    const modal = document.createElement('div');
    modal.className = 'modal modal-compact';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'delete-preset-title');

    const header = modalHeader(
      'Library',
      'Delete this look?',
      `“${preset.name}” will be removed from this browser. A downloaded JSON copy will still import back.`,
    );
    header.querySelector('h3').id = 'delete-preset-title';
    modal.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'preset-actions';
    actions.innerHTML = `
      <button class="soft-button" type="button" data-cancel>Cancel</button>
      <button class="danger-button" type="button" data-confirm>Delete preset</button>
    `;
    modal.appendChild(actions);

    actions.querySelector('[data-cancel]').addEventListener('click', closeOverlay);
    actions.querySelector('[data-confirm]').addEventListener('click', () => {
      onDeletePreset?.(preset.id);
      closeOverlay();
      showToast(`Deleted “${preset.name}”`);
    });
    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) closeOverlay();
    });

    openOverlay(modal);
  }

  async function handlePresetFile() {
    const file = dom.presetFileInput?.files?.[0];
    if (dom.presetFileInput) dom.presetFileInput.value = '';
    if (!file || !onImportPresets) return;
    if (dom.importPresetButton) dom.importPresetButton.disabled = true;
    try {
      const added = await onImportPresets(file);
      const count = Array.isArray(added) ? added.length : 0;
      dismissHint();
      if (!count) {
        showToast('No presets were found in that file', true);
      } else if (count === 1) {
        showToast(`Imported “${added[0].name}”`);
      } else {
        showToast(`Imported ${count} presets`);
      }
    } catch (error) {
      showToast(error?.message || 'Could not import that file', true);
    } finally {
      if (dom.importPresetButton) dom.importPresetButton.disabled = false;
    }
  }

  /* ---------------------------------------------------------------- toasts */

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' is-error' : ''}`;
    toast.innerHTML = isError
      ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5v5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19.5 6.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    dom.toastRoot.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 260);
    }, 2400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  }

  function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Large GLBs can take a while to stream; revoking too early can abort the
    // download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* ----------------------------------------------------------------- state */

  function syncParams(params, presetId) {
    for (const key of Object.keys(PARAM_META)) {
      updateState(key, params[key]);
    }
    dom.seedInput.value = params.seed;
    if (seedHistory[seedIndex] !== params.seed) {
      seedHistory = seedHistory.slice(0, seedIndex + 1);
      seedHistory.push(params.seed);
      seedIndex = seedHistory.length - 1;
    }
    setActivePreset(presetId);
  }

  function setBusy(busy) {
    dom.foot?.classList.toggle('is-busy', busy);
    dom.loadingVeil?.classList.toggle('is-busy', busy);
    dom.loadingVeil?.setAttribute('aria-hidden', busy ? 'false' : 'true');
    if (busy) {
      const label = getParams().voxelize ? 'Voxelizing wood…' : 'Growing leaves…';
      dom.stats.textContent = label;
      dom.time.textContent = '';
      if (dom.loadingLabel) dom.loadingLabel.textContent = label;
    } else if (lastStats) {
      renderStats(lastStats);
    }
  }

  function renderStats(nextStats) {
    dom.stats.textContent = `${numberFormat.format(nextStats.leaves)} leaves`;
    dom.time.textContent = `${Math.round(nextStats.ms)} ms`;
  }

  function setStats(nextStats) {
    stats = { ...stats, ...nextStats };
    lastStats = stats;
    dom.foot?.classList.remove('is-busy');
    dom.loadingVeil?.classList.remove('is-busy');
    dom.loadingVeil?.setAttribute('aria-hidden', 'true');
    renderStats(stats);
  }

  function setSeed(seed) {
    dom.seedInput.value = seed;
    if (seedHistory[seedIndex] !== seed) {
      seedHistory = seedHistory.slice(0, seedIndex + 1);
      seedHistory.push(seed);
      seedIndex = seedHistory.length - 1;
    }
  }

  /* --------------------------------------------------------------- keyboard */

  function isTyping(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
  }

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) return;

    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      if (isTyping(event.target)) return;
      event.preventDefault();
      stepSeed(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (isTyping(event.target)) return;

    if (event.key === 'Escape') {
      if (activeOverlay) {
        closeOverlay();
      } else if (document.body.classList.contains('panel-open')) {
        closeMobilePanel();
      }
      return;
    }

    if (activeOverlay) return;

    const key = event.key.toLowerCase();
    if (key === 'r') {
      onRegenerate();
    } else if (key === 's') {
      requestSeed(randomSeed());
    } else if (key === 'f') {
      frameHandler?.();
    } else if (key === 'h') {
      setUIHidden(!uiHidden);
    } else if (key === 't') {
      autoRotate = !autoRotate;
      onToggleTurntable?.(autoRotate);
      showToast(autoRotate ? 'Turntable on' : 'Turntable off');
    } else if (event.key === '?') {
      openHelp();
    } else if (/^[1-6]$/.test(event.key)) {
      const preset = PRESETS[Number(event.key) - 1];
      if (preset) onPresetSelect(preset.id);
    } else if (key === 'e') {
      openExport();
    } else if (key === 'l') {
      setView({ hideLeaves: !viewState.hideLeaves });
      showToast(viewState.hideLeaves ? 'Leaves hidden' : 'Leaves shown');
    } else if (key === 'b') {
      setView({ hideBranches: !viewState.hideBranches });
      showToast(viewState.hideBranches ? 'Branches hidden' : 'Branches shown');
    } else if (key === 'g') {
      setView({ shading: viewState.shading === 'gray' ? 'natural' : 'gray' });
      showToast(viewState.shading === 'gray' ? 'Gray shading' : 'Natural shading');
    } else if (key === 'w') {
      setView({ shading: viewState.shading === 'wire' ? 'natural' : 'wire' });
      showToast(viewState.shading === 'wire' ? 'Wireframe on' : 'Wireframe off');
    }
  });

  function registerFrameHandler(handler) {
    frameHandler = handler;
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1120) closeMobilePanel();
  });

  setTheme(theme, { notify: false });

  return {
    syncParams,
    setBusy,
    setStats,
    setSeed,
    setActivePreset,
    setPresetThumbnail,
    setCustomPresets,
    setView,
    setLooksCollapsed,
    setTheme,
    setUIHidden,
    showToast,
    dismissHint,
    registerFrameHandler,
    openHelp,
    openExport,
    closeOverlay,
  };
}
