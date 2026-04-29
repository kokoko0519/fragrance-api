const TEMPLATE_FILES = {
  extraction: 'templates/extraction_templates.json',
  materials: 'templates/materials.json',
  solvents: 'templates/solvents.json',
  storageProfiles: 'templates/storage_profiles.json',
  codes: 'templates/codes.json',
  productSeries: 'templates/product_series.json',
  products: 'templates/products.json',
  comparisonGroups: 'templates/comparison_groups.json'
};

const cache = {};

async function readJson(file) {
  const url = chrome.runtime.getURL(file);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`テンプレート読込失敗: ${file}`);
  }
  return res.json();
}

function uniqBy(list, keyFn) {
  const map = new Map();
  list.forEach((item) => {
    const key = keyFn(item);
    if (!key || map.has(key)) return;
    map.set(key, item);
  });
  return Array.from(map.values());
}

function normalizeCustomMasters(customMasters) {
  return {
    materials: [...(customMasters?.materials || [])],
    solvents: [...(customMasters?.solvents || [])],
    containerTypes: [...(customMasters?.containerTypes || [])],
    temperatureOptions: [...(customMasters?.temperatureOptions || [])],
    productSeries: [...(customMasters?.productSeries || [])],
    products: [...(customMasters?.products || [])],
    comparisonGroups: [...(customMasters?.comparisonGroups || [])],
    methodCodes: { ...(customMasters?.methodCodes || {}) }
  };
}

function deriveSolventId(name, index) {
  const token = String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return token || `custom_solvent_${index}`;
}

function normalizeArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  return [v];
}

function normalizeStep(step = {}) {
  return {
    ...step,
    title: step.title || step.name || step.stepId || '',
    stepDescription: step.stepDescription || '',
    instructions: normalizeArray(step.instructions),
    checkpoints: normalizeArray(step.checkpoints),
    normalSigns: normalizeArray(step.normalSigns),
    abnormalSigns: normalizeArray(step.abnormalSigns),
    cautionNotes: normalizeArray(step.cautionNotes),
    requiredLogs: normalizeArray(step.requiredLogs),
    optionalLogs: normalizeArray(step.optionalLogs),
    completionCriteria: normalizeArray(step.completionCriteria),
    requiredPhotoTypes: normalizeArray(step.requiredPhotoTypes),
    optionalPhotoTypes: normalizeArray(step.optionalPhotoTypes),
    abnormalityOptions: normalizeArray(step.abnormalityOptions)
  };
}

function normalizeExtractionTemplate(extraction) {
  const presets = Object.fromEntries(
    Object.entries(extraction?.presets || {}).map(([methodId, methodPresets]) => [
      methodId,
      (methodPresets || []).map((preset) => ({
        ...preset,
        steps: (preset.steps || []).map((step) => normalizeStep(step))
      }))
    ])
  );
  return {
    ...extraction,
    methods: [...(extraction?.methods || [])],
    presets
  };
}

export async function loadTemplates(forceReload = false) {
  if (!forceReload && Object.keys(cache).length) {
    return cache;
  }
  const [
    extraction,
    materials,
    solvents,
    storageProfiles,
    codes,
    productSeries,
    products,
    comparisonGroups,
    customRaw
  ] = await Promise.all([
    readJson(TEMPLATE_FILES.extraction),
    readJson(TEMPLATE_FILES.materials),
    readJson(TEMPLATE_FILES.solvents),
    readJson(TEMPLATE_FILES.storageProfiles),
    readJson(TEMPLATE_FILES.codes),
    readJson(TEMPLATE_FILES.productSeries),
    readJson(TEMPLATE_FILES.products),
    readJson(TEMPLATE_FILES.comparisonGroups),
    chrome.storage.local.get('customMasters')
  ]);

  const custom = normalizeCustomMasters(customRaw.customMasters);

  const mergedMaterials = uniqBy([
    ...(materials.materials || []),
    ...custom.materials.map((m, idx) => ({
      materialCode: (m.materialCode || `CUS${String(idx + 1).padStart(3, '0')}`).toUpperCase(),
      materialName: m.materialName || '',
      aliases: m.aliases || []
    }))
  ], (x) => x.materialName);

  const mergedSolvents = uniqBy([
    ...(solvents.solvents || []),
    ...custom.solvents.map((s, idx) => ({
      solventId: s.solventId || deriveSolventId(s.solventName, idx),
      solventName: s.solventName || ''
    }))
  ], (x) => x.solventName);

  const mergedTemperatureOptions = uniqBy([
    ...(storageProfiles.temperatureOptions || []),
    ...custom.temperatureOptions
  ], (x) => String(x));

  const profileContainerTypes = (storageProfiles.storageProfiles || []).map((p) => p.containerType).filter(Boolean);
  const containerTypes = uniqBy([
    ...profileContainerTypes,
    ...custom.containerTypes
  ], (x) => String(x));

  const mergedSeries = uniqBy([
    ...(productSeries.productSeries || []),
    ...custom.productSeries
  ], (x) => x.seriesId || x.seriesName);

  const mergedProducts = uniqBy([
    ...(products.products || []),
    ...custom.products
  ], (x) => x.productId || x.productName);

  const mergedComparisonGroups = uniqBy([
    ...(comparisonGroups.comparisonGroups || []),
    ...custom.comparisonGroups
  ], (x) => x.comparisonGroupId || x.comparisonGroupName);

  cache.extraction = normalizeExtractionTemplate(extraction);
  cache.materials = { ...materials, materials: mergedMaterials };
  cache.solvents = { ...solvents, solvents: mergedSolvents };
  cache.storageProfiles = { ...storageProfiles, temperatureOptions: mergedTemperatureOptions };
  cache.codes = {
    ...codes,
    methodCodes: {
      ...(codes.methodCodes || {}),
      ...(custom.methodCodes || {})
    }
  };
  cache.containerTypes = containerTypes;
  cache.productSeries = { productSeries: mergedSeries };
  cache.products = { products: mergedProducts };
  cache.comparisonGroups = { comparisonGroups: mergedComparisonGroups };
  cache.customMasters = custom;

  return cache;
}

export async function getMethodById(methodId) {
  const t = await loadTemplates();
  return t.extraction.methods.find((m) => m.methodId === methodId) || null;
}

export async function getPreset(methodId, presetId) {
  const t = await loadTemplates();
  const presets = t.extraction.presets[methodId] || [];
  return presets.find((p) => p.presetId === presetId) || null;
}

export async function getStorageProfile(profileId) {
  const t = await loadTemplates();
  return t.storageProfiles.storageProfiles.find((p) => p.profileId === profileId) || null;
}

export async function getSolventOptions(preset) {
  const t = await loadTemplates();
  if (!preset || !preset.allowedSolvents || !preset.allowedSolvents.length) {
    return t.solvents.solvents;
  }
  const allowed = t.solvents.solvents.filter((s) => preset.allowedSolvents.includes(s.solventId));
  const customNames = new Set((t.customMasters?.solvents || []).map((s) => s.solventName));
  const customOptions = t.solvents.solvents.filter((s) => customNames.has(s.solventName));
  const merged = uniqBy([...allowed, ...customOptions], (x) => x.solventName);
  return merged.length ? merged : t.solvents.solvents;
}

export async function getContainerTypeOptions() {
  const t = await loadTemplates();
  return t.containerTypes || [];
}

export async function getProductSeries() {
  const t = await loadTemplates();
  return t.productSeries.productSeries || [];
}

export async function getSeriesById(seriesId) {
  const all = await getProductSeries();
  return all.find((s) => s.seriesId === seriesId) || null;
}

export async function getProducts(seriesId = '') {
  const t = await loadTemplates();
  const all = t.products.products || [];
  if (!seriesId) return all;
  return all.filter((p) => p.seriesId === seriesId);
}

export async function getProductById(productId) {
  const t = await loadTemplates();
  return (t.products.products || []).find((p) => p.productId === productId) || null;
}

export async function getComparisonGroups(filters = {}) {
  const t = await loadTemplates();
  const methodNameFromId = filters.methodId
    ? (t.extraction.methods || []).find((m) => m.methodId === filters.methodId)?.methodName || ''
    : '';
  const normalizedMaterial = String(filters.materialName || '').trim();
  const normalizedMethod = String(filters.methodName || methodNameFromId || '').trim();
  return (t.comparisonGroups.comparisonGroups || []).filter((g) => {
    if (filters.seriesId && g.seriesId !== filters.seriesId) return false;
    if (filters.productId && g.productId !== filters.productId) return false;
    if (normalizedMaterial && g.materialName) {
      const gm = String(g.materialName).trim();
      if (gm !== normalizedMaterial && !gm.includes(normalizedMaterial) && !normalizedMaterial.includes(gm)) return false;
    }
    if (normalizedMethod && g.methodName && g.methodName !== normalizedMethod) return false;
    return true;
  });
}

export async function getComparisonGroupById(comparisonGroupId) {
  const all = await getComparisonGroups();
  return all.find((g) => g.comparisonGroupId === comparisonGroupId) || null;
}
