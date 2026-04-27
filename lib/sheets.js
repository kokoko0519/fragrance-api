import { getAuthToken } from './calendar.js';

export const SHEET_HEADERS = {
  batches: [
    'batchId',
    'displayLabel',
    'seriesId',
    'seriesName',
    'productId',
    'productName',
    'productStatus',
    'comparisonGroupId',
    'comparisonGroupName',
    'compareGroupId',
    'compareKey',
    'comparisonKey',
    'materialName',
    'methodName',
    'presetName',
    'solventName',
    'ratio',
    'solventAmount',
    'waterAmount',
    'storageProfile',
    'startDateTime',
    'endDateTime',
    'status',
    'finalYield',
    'finalAroma',
    'finalEvaluation',
    'overallRating',
    'luxuryFeel',
    'worldFit',
    'memorability',
    'reproducibilityEstimate',
    'commercialPotential',
    'brandCandidate',
    'seriesCandidate',
    'productCandidate',
    'fitScore',
    'fitMemo',
    'commercialDirection',
    'nextImprovement',
    'operator',
    'materialGroup',
    'methodGroup',
    'finalScore',
    'resultSummary'
  ],
  step_logs: [
    'logId', 'batchId', 'stepId', 'stepTitle', 'eventType', 'scheduledAt', 'loggedAt', 'operator', 'status', 'temperature', 'volume',
    'colorNote', 'aromaNote', 'precipitateNote', 'abnormalityFlag', 'abnormalityType', 'memo', 'improvementNote', 'nextAttention', 'logPayload', 'eventId'
  ],
  storage_logs: [
    'logId',
    'batchId',
    'recordedAt',
    'operator',
    'beforeStorageTemperature',
    'afterStorageTemperature',
    'beforeStorageLocation',
    'afterStorageLocation',
    'beforeContainerType',
    'afterContainerType',
    'containerChanged',
    'lightShielded',
    'sealedState',
    'storageTemperature',
    'storageLocation',
    'containerType',
    'stateChangeNote',
    'memo'
  ],
  completion_logs: [
    'completionId',
    'batchId',
    'seriesId',
    'productId',
    'completedAt',
    'finalYield',
    'finalAroma',
    'overallRating',
    'luxuryFeel',
    'worldFit',
    'memorability',
    'reproducibilityEstimate',
    'commercialPotential',
    'brandCandidate',
    'seriesCandidate',
    'productCandidate',
    'fitScore',
    'fitMemo',
    'commercialDirection',
    'finalScore',
    'issueSummary',
    'nextImprovement',
    'resultSummary',
    'operator'
  ],
  photo_logs: [
    'photoId',
    'batchId',
    'stepId',
    'stepTitle',
    'logId',
    'completionId',
    'recordedAt',
    'operator',
    'photoType',
    'abnormalType',
    'driveFileId',
    'driveUrl',
    'fileName',
    'memo',
    'comparePhotoFlag'
  ]
};

async function sheetsFetch(path, token, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API エラー: ${res.status} ${text}`);
  }
  return res.json();
}

async function getSpreadsheetMeta(spreadsheetId, token) {
  return sheetsFetch(`${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`, token);
}

async function addSheet(spreadsheetId, sheetName, token) {
  return sheetsFetch(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    })
  });
}

async function getHeaderRow(spreadsheetId, sheetName, token) {
  return sheetsFetch(`${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!1:1`)}`, token);
}

async function setHeaderRow(spreadsheetId, sheetName, header, token) {
  return sheetsFetch(`${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A1`)}?valueInputOption=RAW`, token, {
    method: 'PUT',
    body: JSON.stringify({ values: [header] })
  });
}

async function appendRow(spreadsheetId, sheetName, row, token) {
  return sheetsFetch(`${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, {
    method: 'POST',
    body: JSON.stringify({ values: [row] })
  });
}

async function getAllRows(spreadsheetId, sheetName, token) {
  const result = await sheetsFetch(`${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A:ZZ`)}`, token);
  return result.values || [];
}

async function updateRow(spreadsheetId, sheetName, rowIndex1Based, row, token) {
  return sheetsFetch(`${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A${rowIndex1Based}`)}?valueInputOption=RAW`, token, {
    method: 'PUT',
    body: JSON.stringify({ values: [row] })
  });
}

function mergeHeader(current, required) {
  const base = Array.isArray(current) ? [...current] : [];
  required.forEach((col) => {
    if (!base.includes(col)) base.push(col);
  });
  return base;
}

export async function ensureSheets(spreadsheetId, sheetNames) {
  const token = await getAuthToken(true);
  const meta = await getSpreadsheetMeta(spreadsheetId, token);
  const existing = new Set((meta.sheets || []).map((s) => s.properties?.title));

  for (const [key, name] of Object.entries(sheetNames)) {
    if (!existing.has(name)) {
      await addSheet(spreadsheetId, name, token);
    }
    const headerKey = key === 'stepLogs'
      ? 'step_logs'
      : key === 'storageLogs'
        ? 'storage_logs'
        : key === 'completionLogs'
          ? 'completion_logs'
          : key === 'photoLogs'
            ? 'photo_logs'
            : 'batches';
    const header = SHEET_HEADERS[headerKey];
    const row = await getHeaderRow(spreadsheetId, name, token).catch(() => ({ values: [] }));
    const currentHeader = row.values?.[0] || [];
    if (!currentHeader.length) {
      await setHeaderRow(spreadsheetId, name, header, token);
    } else {
      const merged = mergeHeader(currentHeader, header);
      if (merged.length !== currentHeader.length) {
        await setHeaderRow(spreadsheetId, name, merged, token);
      }
    }
  }
}

export async function upsertBatchSheet(spreadsheetId, sheetName, rowData) {
  const token = await getAuthToken(true);
  const rows = await getAllRows(spreadsheetId, sheetName, token);
  let header = SHEET_HEADERS.batches;
  if (!rows.length) {
    await setHeaderRow(spreadsheetId, sheetName, header, token);
  } else {
    header = mergeHeader(rows[0] || [], SHEET_HEADERS.batches);
    if (header.length !== (rows[0] || []).length) {
      await setHeaderRow(spreadsheetId, sheetName, header, token);
    }
  }

  const row = header.map((k) => rowData[k] ?? '');
  const targetIndex = rows.findIndex((r, idx) => idx > 0 && r[0] === rowData.batchId);
  if (targetIndex >= 0) {
    await updateRow(spreadsheetId, sheetName, targetIndex + 1, row, token);
  } else {
    await appendRow(spreadsheetId, sheetName, row, token);
  }
}

export async function appendStepLogSheet(spreadsheetId, sheetName, rowData) {
  const token = await getAuthToken(true);
  const row = SHEET_HEADERS.step_logs.map((k) => rowData[k] ?? '');
  await appendRow(spreadsheetId, sheetName, row, token);
}

export async function appendStorageLogSheet(spreadsheetId, sheetName, rowData) {
  const token = await getAuthToken(true);
  const row = SHEET_HEADERS.storage_logs.map((k) => rowData[k] ?? '');
  await appendRow(spreadsheetId, sheetName, row, token);
}

export async function appendCompletionLogSheet(spreadsheetId, sheetName, rowData) {
  const token = await getAuthToken(true);
  const row = SHEET_HEADERS.completion_logs.map((k) => rowData[k] ?? '');
  await appendRow(spreadsheetId, sheetName, row, token);
}

export async function appendPhotoLogSheet(spreadsheetId, sheetName, rowData) {
  const token = await getAuthToken(true);
  const row = SHEET_HEADERS.photo_logs.map((k) => rowData[k] ?? '');
  await appendRow(spreadsheetId, sheetName, row, token);
}
