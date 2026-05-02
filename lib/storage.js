const DEFAULT_STATE = {
  appSettings: {
    defaultCalendarId: 'primary',
    perMethodCalendars: {},
    pointEventMinutes: 5,
    notificationLeadMinutes: 10,
    notion: {
      enabled: false,
      token: '',
      batchesDatabaseId: '34ea388884ad8014977fd68cced7c103',
      stepLogsDatabaseId: '34ea388884ad802db61cf1f6e534f44e',
      completionLogsDatabaseId: '34ea388884ad804499dcc47e42a18be4'
    },
    driveRootFolderName: '和の香り研究所',
    driveBatchPhotosFolderName: 'batch_photos',
    spreadsheetId: '',
    sheetNames: {
      batches: 'batches',
      stepLogs: 'step_logs',
      storageLogs: 'storage_logs',
      completionLogs: 'completion_logs',
      photoLogs: 'photo_logs'
    }
  },
  batches: [],
  eventLogs: {},
  storageLogs: [],
  photoLogs: [],
  pendingEvents: [],
  calendarEvents: {},
  compareGroups: {},
  customMasters: {
    materials: [],
    solvents: [],
    containerTypes: [],
    temperatureOptions: [],
    productSeries: [],
    products: [],
    comparisonGroups: [],
    methodCodes: {}
  },
  syncCache: {
    stepLogs: [],
    storageLogs: [],
    completionLogs: [],
    photoLogs: []
  }
};

export async function getState() {
  const keys = Object.keys(DEFAULT_STATE);
  const loaded = await chrome.storage.local.get(keys);
  return {
    ...DEFAULT_STATE,
    ...loaded,
    appSettings: {
      ...DEFAULT_STATE.appSettings,
      ...(loaded.appSettings || {}),
      notion: {
        ...DEFAULT_STATE.appSettings.notion,
        ...(loaded.appSettings?.notion || {})
      },
      sheetNames: {
        ...DEFAULT_STATE.appSettings.sheetNames,
        ...(loaded.appSettings?.sheetNames || {})
      }
    },
    storageLogs: [...(loaded.storageLogs || [])],
    photoLogs: [...(loaded.photoLogs || [])],
    customMasters: {
      ...DEFAULT_STATE.customMasters,
      ...(loaded.customMasters || {}),
      materials: [...(loaded.customMasters?.materials || [])],
      solvents: [...(loaded.customMasters?.solvents || [])],
      containerTypes: [...(loaded.customMasters?.containerTypes || [])],
      temperatureOptions: [...(loaded.customMasters?.temperatureOptions || [])],
      productSeries: [...(loaded.customMasters?.productSeries || [])],
      products: [...(loaded.customMasters?.products || [])],
      comparisonGroups: [...(loaded.customMasters?.comparisonGroups || [])],
      methodCodes: { ...(loaded.customMasters?.methodCodes || {}) }
    },
    syncCache: {
      ...DEFAULT_STATE.syncCache,
      ...(loaded.syncCache || {})
    }
  };
}

export async function initializeStorage() {
  const state = await getState();
  await chrome.storage.local.set(state);
  return state;
}

export async function saveState(partial) {
  await chrome.storage.local.set(partial);
}

export async function saveBatch(batch) {
  const state = await getState();
  const idx = state.batches.findIndex((b) => b.batchId === batch.batchId);
  const next = {
    ...batch,
    updatedAt: new Date().toISOString()
  };
  if (idx >= 0) {
    state.batches[idx] = next;
  } else {
    state.batches.unshift(next);
  }
  await saveState({ batches: state.batches });
  return next;
}

export async function updateBatch(batchId, patch) {
  const state = await getState();
  const idx = state.batches.findIndex((b) => b.batchId === batchId);
  if (idx < 0) return null;
  state.batches[idx] = {
    ...state.batches[idx],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await saveState({ batches: state.batches });
  return state.batches[idx];
}

export async function getBatch(batchId) {
  const state = await getState();
  return state.batches.find((b) => b.batchId === batchId) || null;
}

export async function saveEventLogs(batchId, stepId, logs) {
  const state = await getState();
  const key = `${batchId}:${stepId}`;
  state.eventLogs[key] = {
    ...state.eventLogs[key],
    ...logs,
    updatedAt: new Date().toISOString()
  };
  await saveState({ eventLogs: state.eventLogs });
  return state.eventLogs[key];
}

export async function getEventLogs(batchId, stepId) {
  const state = await getState();
  return state.eventLogs[`${batchId}:${stepId}`] || null;
}

export async function saveStorageLogEntry(row) {
  const state = await getState();
  const storageLogs = [row, ...(state.storageLogs || [])];
  await saveState({ storageLogs });
  return row;
}

export async function savePhotoLogEntries(rows) {
  const state = await getState();
  const photoLogs = [...rows, ...(state.photoLogs || [])];
  await saveState({ photoLogs });
  return rows;
}

export async function upsertPendingEvents(events) {
  const state = await getState();
  const map = new Map(state.pendingEvents.map((e) => [e.localEventId, e]));
  events.forEach((event) => map.set(event.localEventId, event));
  const pendingEvents = Array.from(map.values());
  await saveState({ pendingEvents });
  return pendingEvents;
}

export async function markPendingEventDone(localEventId) {
  const state = await getState();
  const pendingEvents = state.pendingEvents.map((event) => {
    if (event.localEventId === localEventId) {
      return { ...event, completed: true, completedAt: new Date().toISOString() };
    }
    return event;
  });
  await saveState({ pendingEvents });
  return pendingEvents.find((e) => e.localEventId === localEventId) || null;
}

export async function upsertCalendarEventMap(batchId, mappedEvents) {
  const state = await getState();
  state.calendarEvents[batchId] = mappedEvents;
  await saveState({ calendarEvents: state.calendarEvents });
}

export async function cacheSyncRow(kind, row) {
  const state = await getState();
  const syncCache = {
    ...state.syncCache,
    [kind]: [...(state.syncCache[kind] || []), row]
  };
  await saveState({ syncCache });
}

export async function getHomeStats() {
  const state = await getState();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  const todayPendingCount = (state.pendingEvents || []).filter((e) => {
    const t = new Date(e.startDateTime).getTime();
    return !e.completed && t >= start && t <= end;
  }).length;
  const inProgressBatchCount = (state.batches || []).filter((b) => b.status !== '完了').length;
  const inProgress = (state.batches || []).filter((b) => b.status !== '完了');
  const inProgressMaterialCount = new Set(inProgress.map((b) => b.materialName).filter(Boolean)).size;
  const inProgressSeriesCount = new Set(inProgress.map((b) => b.seriesId).filter(Boolean)).size;
  const inProgressProductCount = new Set(inProgress.map((b) => b.productId).filter(Boolean)).size;
  const completed = (state.batches || []).filter((b) => b.status === '完了');
  const completedWithoutProductCandidateCount = completed.filter((b) => !String(b.seriesCandidate || '').trim() && !String(b.productCandidate || '').trim()).length;
  const groupCount = completed.reduce((acc, batch) => {
    const key = String(batch.comparisonGroupId || batch.compareGroupId || '').trim();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const comparePendingCompletedCount = completed.filter((batch) => {
    const key = String(batch.comparisonGroupId || batch.compareGroupId || '').trim();
    if (!key) return true;
    return (groupCount[key] || 0) < 2;
  }).length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCompletedCount = (state.batches || []).filter((b) => {
    if (b.status !== '完了') return false;
    const t = new Date(b.completedAt || b.updatedAt || b.createdAt || 0).getTime();
    return Number.isFinite(t) && t >= sevenDaysAgo;
  }).length;
  return {
    todayPendingCount,
    inProgressBatchCount,
    inProgressMaterialCount,
    inProgressSeriesCount,
    inProgressProductCount,
    recentCompletedCount,
    completedWithoutProductCandidateCount,
    comparePendingCompletedCount
  };
}

export async function listBatches(filters = {}) {
  const state = await getState();
  const status = filters.status || 'all';
  const material = (filters.materialName || '').trim();
  const materialGroup = (filters.materialGroup || '').trim();
  const method = (filters.methodId || '').trim();
  const methodName = (filters.methodName || '').trim();
  const presetId = (filters.selectedPresetId || '').trim();
  const presetName = (filters.presetName || '').trim();
  const solventName = (filters.solventName || '').trim();
  const comparisonGroupId = (filters.comparisonGroupId || '').trim();
  const commercialDirection = (filters.commercialDirection || '').trim();
  const seriesCandidate = (filters.seriesCandidate || '').trim();

  return (state.batches || []).filter((b) => {
    if (status === 'in_progress' && b.status === '完了') return false;
    if (status === 'completed' && b.status !== '完了') return false;
    if (material && !(b.materialName || '').includes(material)) return false;
    if (materialGroup && !String(b.materialGroup || '').includes(materialGroup)) return false;
    if (method && b.methodId !== method) return false;
    if (methodName && !String(b.methodName || '').includes(methodName)) return false;
    if (presetId && b.selectedPresetId !== presetId) return false;
    if (presetName && !String(b.presetName || b.selectedPresetId || '').includes(presetName)) return false;
    if (solventName && b.solventName !== solventName) return false;
    if (comparisonGroupId && !String(b.comparisonGroupId || b.compareGroupId || '').includes(comparisonGroupId)) return false;
    if (commercialDirection && (b.commercialDirection || '') !== commercialDirection) return false;
    if (seriesCandidate && !String(b.seriesCandidate || '').includes(seriesCandidate)) return false;
    return true;
  });
}

export async function deleteBatch(batchId) {
  const state = await getState();
  const target = (state.batches || []).find((b) => b.batchId === batchId);
  if (!target) return { ok: false, error: '対象バッチが見つかりません' };
  if (target.status === '完了') return { ok: false, error: '完了済みバッチは削除できません' };

  const batches = (state.batches || []).filter((b) => b.batchId !== batchId);
  const pendingEvents = (state.pendingEvents || []).filter((e) => e.batchId !== batchId);

  const eventLogs = { ...(state.eventLogs || {}) };
  Object.keys(eventLogs).forEach((key) => {
    if (key.startsWith(`${batchId}:`)) delete eventLogs[key];
  });

  const calendarEvents = { ...(state.calendarEvents || {}) };
  delete calendarEvents[batchId];

  const storageLogs = (state.storageLogs || []).filter((x) => x.batchId !== batchId);
  const photoLogs = (state.photoLogs || []).filter((x) => x.batchId !== batchId);

  await saveState({ batches, pendingEvents, eventLogs, calendarEvents, storageLogs, photoLogs });
  return { ok: true, deletedBatchId: batchId };
}

export async function getCustomMasters() {
  const state = await getState();
  return state.customMasters || {
    materials: [],
    solvents: [],
    containerTypes: [],
    temperatureOptions: [],
    productSeries: [],
    products: [],
    comparisonGroups: [],
    methodCodes: {}
  };
}

export async function saveCustomMasters(customMasters) {
  const merged = {
    materials: [...(customMasters?.materials || [])],
    solvents: [...(customMasters?.solvents || [])],
    containerTypes: [...(customMasters?.containerTypes || [])],
    temperatureOptions: [...(customMasters?.temperatureOptions || [])],
    productSeries: [...(customMasters?.productSeries || [])],
    products: [...(customMasters?.products || [])],
    comparisonGroups: [...(customMasters?.comparisonGroups || [])],
    methodCodes: { ...(customMasters?.methodCodes || {}) }
  };
  await saveState({ customMasters: merged });
  return merged;
}
