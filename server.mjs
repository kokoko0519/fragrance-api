import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const STATE_FILE = join(DATA_DIR, 'state.json');

async function loadDotEnv() {
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    });
  } catch (_error) {
    // .env is optional; production hosts usually provide real environment variables.
  }
}

await loadDotEnv();

const PORT = Number(process.env.PORT || 8787);
const NOTION_VERSION = process.env.NOTION_VERSION || '2026-03-11';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://japanese-fragrance.jp',
  'https://www.japanese-fragrance.jp',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
];
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.mjs': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.webmanifest': 'application/manifest+json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=UTF-8',
  '.ico': 'image/x-icon'
};

const DEFAULT_STATE = {
  batches: [],
  eventLogs: {},
  storageLogs: [],
  photoLogs: [],
  pendingEvents: [],
  calendarEvents: {}
};

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(res.req)
  });
  res.end(JSON.stringify(body));
}

function corsHeaders(req) {
  const origin = req?.headers?.origin || '';
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function handleOptions(req, res) {
  res.writeHead(204, corsHeaders(req));
  res.end();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (_error) {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function mergeClientState(serverState, clientState = {}) {
  return {
    ...serverState,
    batches: serverState.batches?.length ? serverState.batches : (clientState.batches || []),
    eventLogs: Object.keys(serverState.eventLogs || {}).length ? serverState.eventLogs : (clientState.eventLogs || {}),
    storageLogs: serverState.storageLogs?.length ? serverState.storageLogs : (clientState.storageLogs || []),
    photoLogs: serverState.photoLogs?.length ? serverState.photoLogs : (clientState.photoLogs || []),
    pendingEvents: serverState.pendingEvents?.length ? serverState.pendingEvents : (clientState.pendingEvents || []),
    calendarEvents: Object.keys(serverState.calendarEvents || {}).length ? serverState.calendarEvents : (clientState.calendarEvents || {})
  };
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function titleProp(value) {
  const text = String(value || '').slice(0, 1900);
  return { title: text ? [{ type: 'text', text: { content: text } }] : [] };
}

function richTextProp(value) {
  const text = String(value || '').slice(0, 1900);
  return { rich_text: text ? [{ type: 'text', text: { content: text } }] : [] };
}

function selectProp(value) {
  const name = String(value || '').trim();
  return name ? { select: { name } } : { select: null };
}

function statusProp(value) {
  return { status: { name: String(value || '進行中') } };
}

function checkboxProp(value) {
  return { checkbox: Boolean(value && value !== 'なし' && value !== '0') };
}

function dateProp(value) {
  if (!value) return { date: null };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { date: null } : { date: { start: date.toISOString() } };
}

function notionConfig() {
  return {
    token: process.env.NOTION_TOKEN || '',
    batchesDatabaseId: process.env.NOTION_BATCHES_DATABASE_ID || '',
    stepLogsDatabaseId: process.env.NOTION_STEP_LOGS_DATABASE_ID || '',
    completionLogsDatabaseId: process.env.NOTION_COMPLETION_LOGS_DATABASE_ID || ''
  };
}

async function notionFetch(path, options = {}) {
  const { token } = notionConfig();
  if (!token) throw new Error('NOTION_TOKEN が未設定です');
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    throw new Error(`Notion API エラー: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function dataUrlToBlob(photo) {
  const match = String(photo.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('画像データ形式が不正です');
  const mimeType = photo.mimeType || match[1] || 'image/jpeg';
  const bytes = Buffer.from(match[2], 'base64');
  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

async function uploadPhotoToNotion(photo, fallbackName) {
  const fileName = photo.fileName || fallbackName || `photo-${Date.now()}.jpg`;
  const { blob, mimeType } = dataUrlToBlob(photo);
  const created = await notionFetch('/file_uploads', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'single_part',
      filename: fileName,
      content_type: mimeType
    })
  });

  const form = new FormData();
  form.append('file', blob, fileName);
  const uploadUrl = created.upload_url || `https://api.notion.com/v1/file_uploads/${created.id}/send`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${notionConfig().token}`,
      'Notion-Version': NOTION_VERSION
    },
    body: form
  });
  if (!res.ok) {
    throw new Error(`Notion File Upload エラー: ${res.status} ${await res.text()}`);
  }
  const uploaded = await res.json();
  return uploaded.id || created.id;
}

async function appendPhotosToPage(pageId, photos, context) {
  const valid = (photos || []).filter((photo) => photo?.dataUrl).slice(0, 3);
  if (!valid.length) return [];

  const uploaded = [];
  for (let i = 0; i < valid.length; i += 1) {
    const photo = valid[i];
    const fileUploadId = await uploadPhotoToNotion(photo, `${context.batchId || 'batch'}_${Date.now()}_${i + 1}.jpg`);
    uploaded.push({
      fileUploadId,
      fileName: photo.fileName || '',
      photoType: photo.photoType || '',
      memo: photo.memo || ''
    });
  }

  const children = uploaded.flatMap((photo) => {
    const caption = [photo.photoType, photo.memo].filter(Boolean).join(' / ');
    return [{
      object: 'block',
      type: 'image',
      image: {
        type: 'file_upload',
        file_upload: { id: photo.fileUploadId },
        caption: caption ? [{ type: 'text', text: { content: caption } }] : []
      }
    }];
  });

  await notionFetch(`/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children })
  });

  return uploaded;
}

function batchProperties(batch) {
  return {
    'Batch ID': titleProp(batch.batchId),
    'Status': statusProp(batch.status || '進行中'),
    'Material Name': richTextProp(batch.materialName),
    'Method Name': selectProp(batch.methodName || batch.methodId),
    'Solvent Name': selectProp(batch.solventName),
    'Ratio': richTextProp(batch.ratio),
    'Start Date Time': dateProp(batch.selectedStartDateTime),
    'Completed At': dateProp(batch.completedAt),
    'Operator': richTextProp(batch.operator),
    'Comparison Group ID': richTextProp(batch.comparisonGroupId || batch.compareGroupId),
    'Comparison Group Name': richTextProp(batch.comparisonGroupName),
    'Storage Temperature': selectProp(batch.storageTemperature),
    'Storage Location': richTextProp(batch.storageLocation),
    'Container Type': selectProp(batch.containerType),
    'Sealed State': selectProp(batch.sealedState),
    'Light Shielded': checkboxProp(batch.lightShielded),
    'Result Summary': richTextProp(batch.resultSummary),
    'Series Candidate': richTextProp(batch.seriesCandidate),
    'Product Candidate': richTextProp(batch.productCandidate),
    'Commercial Direction': selectProp(batch.commercialDirection)
  };
}

function stepLogProperties(row) {
  return {
    'Log ID': titleProp(row.logId),
    'Batch ID': richTextProp(row.batchId),
    'Step ID': richTextProp(row.stepId),
    'Step Title': richTextProp(row.stepTitle),
    'Event Type': selectProp(row.eventType || 'point'),
    'Scheduled At': dateProp(row.scheduledAt),
    'Logged At': dateProp(row.loggedAt),
    'Operator': richTextProp(row.operator),
    'Status': selectProp(row.status || '記録'),
    'Temperature': richTextProp(row.temperature),
    'Volume': richTextProp(row.volume),
    'Color Note': richTextProp(row.colorNote),
    'Aroma Note': richTextProp(row.aromaNote),
    'Precipitate Note': richTextProp(row.precipitateNote),
    'Abnormality Flag': checkboxProp(row.abnormalityFlag),
    'Abnormality Type': richTextProp(row.abnormalityType),
    'Memo': richTextProp(row.memo),
    'Improvement Note': richTextProp(row.improvementNote),
    'Next Attention': richTextProp(row.nextAttention),
    'Event ID': richTextProp(row.eventId)
  };
}

function completionProperties(row) {
  return {
    'Completion ID': titleProp(row.completionId),
    'Batch ID': richTextProp(row.batchId),
    'Completed At': dateProp(row.completedAt),
    'Final Yield': richTextProp(row.finalYield),
    'Final Aroma': richTextProp(row.finalAroma),
    'Overall Rating': richTextProp(row.overallRating),
    'Luxury Feel': richTextProp(row.luxuryFeel),
    'World Fit': richTextProp(row.worldFit),
    'Memorability': richTextProp(row.memorability),
    'Reproducibility Estimate': richTextProp(row.reproducibilityEstimate),
    'Commercial Potential': richTextProp(row.commercialPotential),
    'Brand Candidate': richTextProp(row.brandCandidate),
    'Series Candidate': richTextProp(row.seriesCandidate),
    'Product Candidate': richTextProp(row.productCandidate),
    'Fit Score': richTextProp(row.fitScore),
    'Fit Memo': richTextProp(row.fitMemo),
    'Commercial Direction': selectProp(row.commercialDirection),
    'Final Score': richTextProp(row.finalScore),
    'Issue Summary': richTextProp(row.issueSummary),
    'Next Improvement': richTextProp(row.nextImprovement),
    'Result Summary': richTextProp(row.resultSummary),
    'Operator': richTextProp(row.operator)
  };
}

async function createNotionPage(databaseId, properties) {
  if (!databaseId) return { skipped: true };
  return notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties
    })
  });
}

function computeHomeStats(state) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  const completed = (state.batches || []).filter((b) => b.status === '完了');
  const inProgress = (state.batches || []).filter((b) => b.status !== '完了');
  return {
    todayPendingCount: (state.pendingEvents || []).filter((e) => {
      const t = new Date(e.startDateTime).getTime();
      return !e.completed && t >= start && t <= end;
    }).length,
    inProgressBatchCount: inProgress.length,
    inProgressMaterialCount: new Set(inProgress.map((b) => b.materialName).filter(Boolean)).size,
    recentCompletedCount: completed.filter((b) => new Date(b.completedAt || b.updatedAt || 0).getTime() >= Date.now() - 7 * 86400000).length,
    completedWithoutProductCandidateCount: completed.filter((b) => !String(b.seriesCandidate || '').trim() && !String(b.productCandidate || '').trim()).length,
    comparePendingCompletedCount: completed.filter((b) => !String(b.comparisonGroupId || b.compareGroupId || '').trim()).length
  };
}

function todayEvents(state) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  return (state.pendingEvents || []).filter((e) => {
    const t = new Date(e.startDateTime).getTime();
    return !e.completed && t >= start && t <= end;
  });
}

function inProgressBatches(state) {
  return (state.batches || []).filter((batch) => batch.status !== '完了').map((batch) => ({
    ...batch,
    pendingSteps: (state.pendingEvents || []).filter((event) => event.batchId === batch.batchId && !event.completed)
  }));
}

function filterBatches(state, filters = {}) {
  return (state.batches || []).filter((b) => {
    if (filters.status === 'in_progress' && b.status === '完了') return false;
    if (filters.status === 'completed' && b.status !== '完了') return false;
    if (filters.materialName && !String(b.materialName || '').includes(filters.materialName)) return false;
    if (filters.methodId && b.methodId !== filters.methodId) return false;
    if (filters.selectedPresetId && b.selectedPresetId !== filters.selectedPresetId) return false;
    if (filters.solventName && b.solventName !== filters.solventName) return false;
    if (filters.comparisonGroupId && !String(b.comparisonGroupId || b.compareGroupId || '').includes(filters.comparisonGroupId)) return false;
    if (filters.commercialDirection && b.commercialDirection !== filters.commercialDirection) return false;
    if (filters.seriesCandidate && !String(b.seriesCandidate || '').includes(filters.seriesCandidate)) return false;
    return true;
  });
}

async function handleMessage(message) {
  let state = mergeClientState(await readState(), message.clientState || {});
  const payload = message.payload || {};
  const config = notionConfig();

  switch (message.type) {
    case 'GET_HOME_STATS':
      return { ok: true, ...computeHomeStats(state) };

    case 'GET_TODAY_PENDING':
      return { ok: true, items: todayEvents(state) };

    case 'GET_PROGRESS_TARGETS':
      return { ok: true, todayEvents: todayEvents(state), inProgressBatches: inProgressBatches(state) };

    case 'GET_BATCHES':
      return { ok: true, items: filterBatches(state, payload) };

    case 'TEST_NOTION_SYNC':
      if (!config.token) return { ok: false, error: 'NOTION_TOKEN が未設定です' };
      return { ok: true, enabled: true };

    case 'REGISTER_BATCH': {
      const batch = { ...(payload.batch || {}), status: payload.batch?.status || '進行中', updatedAt: new Date().toISOString() };
      if (!batch.batchId) return { ok: false, error: 'batchIdが不正です' };
      state.batches = [batch, ...(state.batches || []).filter((b) => b.batchId !== batch.batchId)];
      state.pendingEvents = [
        ...(batch.events || []).map((event) => ({ ...event, batchId: batch.batchId, completed: false })),
        ...(state.pendingEvents || []).filter((event) => event.batchId !== batch.batchId)
      ];
      let notion = { skipped: true };
      if (config.token && config.batchesDatabaseId) {
        notion = await createNotionPage(config.batchesDatabaseId, batchProperties(batch));
      }
      await saveState(state);
      return {
        ok: true,
        batchId: batch.batchId,
        calendarEvents: [],
        generatedEventCount: batch.events?.length || 0,
        sheetSync: { ok: false, skipped: true, reason: 'PWAサーバーではSheets同期は未実装です' },
        notion,
        statePatch: state
      };
    }

    case 'LOG_STEP':
    case 'COMPLETE_EVENT': {
      const logs = payload.logs || {};
      const logId = uid('STEP');
      const event = (state.pendingEvents || []).find((e) => e.localEventId === payload.localEventId) || {};
      const row = {
        logId,
        batchId: payload.batchId,
        stepId: payload.stepId,
        stepTitle: payload.stepTitle || event.name || '',
        eventType: event.eventType || 'point',
        scheduledAt: event.startDateTime || '',
        loggedAt: payload.loggedAt || new Date().toISOString(),
        operator: payload.operator || logs['実施者'] || '',
        status: message.type === 'COMPLETE_EVENT' || payload.markDone ? '完了' : '記録',
        temperature: logs.temperature || logs['温度'] || '',
        volume: logs.volume || logs['回収量'] || logs['留出量'] || '',
        colorNote: logs.colorNote || logs['色'] || logs['濁り'] || '',
        aromaNote: logs.aromaNote || logs['香り'] || logs['香り評価'] || logs['香りの印象'] || '',
        precipitateNote: logs.precipitateNote || logs['沈殿'] || logs['残渣'] || '',
        abnormalityFlag: logs.abnormalityFlag || logs['異常有無'] || '',
        abnormalityType: logs['異常種別'] || '',
        memo: logs.memo || '',
        improvementNote: logs.improvementNote || logs['次回注意メモ'] || '',
        nextAttention: logs['次回注意メモ'] || '',
        eventId: payload.eventId || payload.localEventId || ''
      };
      state.eventLogs = { ...(state.eventLogs || {}), [`${payload.batchId}:${payload.stepId}`]: { ...logs, updatedAt: new Date().toISOString() } };
      if (message.type === 'COMPLETE_EVENT' || payload.markDone) {
        state.pendingEvents = (state.pendingEvents || []).map((item) => item.localEventId === payload.localEventId ? { ...item, completed: true, completedAt: new Date().toISOString() } : item);
      }
      let photoCount = 0;
      let notion = { skipped: true };
      if (config.token && config.stepLogsDatabaseId) {
        notion = await createNotionPage(config.stepLogsDatabaseId, stepLogProperties(row));
        if (notion.id) {
          const uploaded = await appendPhotosToPage(notion.id, payload.photos || [], row);
          photoCount = uploaded.length;
        }
      }
      await saveState(state);
      return { ok: true, logId, photoCount, notion, statePatch: state };
    }

    case 'ADD_STORAGE_LOG': {
      const row = { ...payload, logId: uid('STG'), recordedAt: payload.recordedAt || new Date().toISOString() };
      state.storageLogs = [row, ...(state.storageLogs || [])];
      let photoCount = 0;
      let notion = { skipped: true };
      if (config.token && config.stepLogsDatabaseId) {
        const notionRow = {
          logId: row.logId,
          batchId: row.batchId,
          stepId: 'storage_change',
          stepTitle: '保存条件変更',
          eventType: 'other',
          scheduledAt: row.recordedAt,
          loggedAt: row.recordedAt,
          operator: row.operator,
          status: '記録',
          memo: row.memo || row.reason || '',
          eventId: ''
        };
        notion = await createNotionPage(config.stepLogsDatabaseId, stepLogProperties(notionRow));
        if (notion.id) {
          const uploaded = await appendPhotosToPage(notion.id, payload.photos || [], notionRow);
          photoCount = uploaded.length;
        }
      }
      await saveState(state);
      return { ok: true, logId: row.logId, photoCount, notion, statePatch: state };
    }

    case 'SUBMIT_COMPLETION': {
      const completionId = uid('CMP');
      const row = { ...payload, completionId, completedAt: payload.completedAt || new Date().toISOString() };
      state.batches = (state.batches || []).map((batch) => batch.batchId === payload.batchId ? { ...batch, ...payload, status: '完了', completedAt: row.completedAt, updatedAt: new Date().toISOString() } : batch);
      let photoCount = 0;
      let notion = { skipped: true };
      if (config.token && config.completionLogsDatabaseId) {
        notion = await createNotionPage(config.completionLogsDatabaseId, completionProperties(row));
        if (notion.id) {
          const uploaded = await appendPhotosToPage(notion.id, payload.photos || [], row);
          photoCount = uploaded.length;
        }
      }
      await saveState(state);
      return { ok: true, completionId, photoCount, sheetResult: { ok: false, skipped: true }, notion, statePatch: state };
    }

    default:
      return { ok: false, error: `unknown message type: ${message.type || ''}` };
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/popup.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(ROOT, requested));
  if (!filePath.startsWith(resolve(ROOT))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': requested.includes('service-worker') ? 'no-cache' : 'public, max-age=60'
    });
    createReadStream(filePath).pipe(res);
  } catch (_error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  res.req = req;
  try {
    if (req.method === 'OPTIONS') {
      handleOptions(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      json(res, 200, {
        ok: true,
        service: 'fragrance-workflow-api',
        notionConfigured: Boolean(notionConfig().token),
        allowedOrigins: ALLOWED_ORIGINS,
        time: new Date().toISOString()
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/message') {
      const body = await readJsonBody(req);
      json(res, 200, await handleMessage(body));
      return;
    }
    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }
    res.writeHead(405);
    res.end('Method not allowed');
  } catch (error) {
    json(res, 500, { ok: false, error: error.message || String(error) });
  }
}).listen(PORT, () => {
  console.log(`PWA server listening on http://localhost:${PORT}`);
});
