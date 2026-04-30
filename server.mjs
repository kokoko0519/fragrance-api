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
    // Optional in production.
  }
}

await loadDotEnv();

const PORT = Number(process.env.PORT || 8787);
const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';
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
  completionLogs: [],
  perfumeTrials: [],
  photoLogs: [],
  pendingEvents: [],
  calendarEvents: {},
  pendingNotionSync: []
};

function corsHeaders(req) {
  const origin = req?.headers?.origin || '';
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(res.req)
  });
  res.end(JSON.stringify(body));
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
    completionLogs: serverState.completionLogs?.length ? serverState.completionLogs : (clientState.completionLogs || clientState.syncCache?.completionLogs || []),
    perfumeTrials: serverState.perfumeTrials?.length ? serverState.perfumeTrials : (clientState.perfumeTrials || []),
    photoLogs: serverState.photoLogs?.length ? serverState.photoLogs : (clientState.photoLogs || []),
    pendingEvents: serverState.pendingEvents?.length ? serverState.pendingEvents : (clientState.pendingEvents || []),
    calendarEvents: Object.keys(serverState.calendarEvents || {}).length ? serverState.calendarEvents : (clientState.calendarEvents || {}),
    pendingNotionSync: serverState.pendingNotionSync?.length ? serverState.pendingNotionSync : (clientState.pendingNotionSync || [])
  };
}

function parseDatabaseId(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1].replaceAll('-', '') : text;
}

function notionConfig(settings = {}) {
  const notion = settings.notion || {};
  return {
    token: process.env.NOTION_TOKEN || '',
    batchesDatabaseId: parseDatabaseId(process.env.NOTION_BATCHES_DATABASE_ID || notion.batchesDatabaseId || ''),
    stepLogsDatabaseId: parseDatabaseId(process.env.NOTION_STEP_LOGS_DATABASE_ID || notion.stepLogsDatabaseId || ''),
    completionLogsDatabaseId: parseDatabaseId(process.env.NOTION_COMPLETION_LOGS_DATABASE_ID || notion.completionLogsDatabaseId || ''),
    perfumeDatabaseId: parseDatabaseId(process.env.NOTION_PERFUME_DATABASE_ID || notion.perfumeDatabaseId || ''),
    aromaDatabaseId: parseDatabaseId(process.env.NOTION_AROMA_DATABASE_ID || notion.aromaDatabaseId || ''),
    ownedMaterialsDatabaseId: parseDatabaseId(process.env.NOTION_OWNED_MATERIALS_DATABASE_ID || notion.ownedMaterialsDatabaseId || ''),
    perfumeTrialsDatabaseId: parseDatabaseId(process.env.NOTION_PERFUME_TRIALS_DATABASE_ID || notion.perfumeTrialsDatabaseId || ''),
    formulaLinesDatabaseId: parseDatabaseId(process.env.NOTION_FORMULA_LINES_DATABASE_ID || notion.formulaLinesDatabaseId || ''),
    trialReviewsDatabaseId: parseDatabaseId(process.env.NOTION_TRIAL_REVIEWS_DATABASE_ID || notion.trialReviewsDatabaseId || '')
  };
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function text(value, limit = 1900) {
  return String(value ?? '').trim().slice(0, limit);
}

function titleProp(value) {
  const v = text(value);
  return { title: v ? [{ type: 'text', text: { content: v } }] : [] };
}

function richTextProp(value) {
  const v = text(value);
  return { rich_text: v ? [{ type: 'text', text: { content: v } }] : [] };
}

function selectProp(value) {
  const v = text(value);
  return v ? { select: { name: v } } : { select: null };
}

function statusProp(value) {
  const v = text(value) || '進行中';
  return { status: { name: v } };
}

function checkboxProp(value) {
  return { checkbox: value === true || text(value) === '1' || text(value) === 'true' || text(value) === 'あり' };
}

function dateProp(value) {
  if (!value) return { date: null };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { date: null } : { date: { start: d.toISOString() } };
}

const numberOrTextProp = richTextProp;

function normalizeOne(value, map, fallback) {
  const v = text(value);
  if (!v) return fallback;
  return map[v] || fallback;
}

function normalizeBatchStatus(value) {
  return normalizeOne(value, { planned: '未着手', '未着手': '未着手', in_progress: '進行中', '進行中': '進行中', completed: '完了', '完了': '完了', paused: '未着手', canceled: '未着手', hold: '未着手' }, '未着手');
}

function normalizeMethodName(value) {
  return normalizeOne(value, { steam: '蒸留', steam_distillation: '水蒸気蒸留', tincture: 'チンキ', solvent: '溶媒抽出', solvent_extraction: '溶媒抽出', '蒸留': '蒸留', '水蒸気蒸留': '水蒸気蒸留', 'チンキ': 'チンキ', '溶媒抽出': '溶媒抽出', 'その他': 'その他' }, 'その他');
}

function normalizeSolventName(value) {
  return normalizeOne(value, { ethanol: 'エタノール', 'エタノール': 'エタノール', water: '水', '水': '水', 'その他': 'その他' }, 'その他');
}

function normalizeStorageTemperature(value) {
  return normalizeOne(value, { room: '常温', '常温': '常温', refrigerated: '冷蔵', '冷蔵': '冷蔵', frozen: '冷凍', '冷凍': '冷凍', 'その他': 'その他' }, 'その他');
}

function normalizeContainerType(value) {
  return normalizeOne(value, { glass: 'ガラス瓶', amber: '遮光瓶', plastic: '樹脂容器', 'ガラス瓶': 'ガラス瓶', '遮光瓶': '遮光瓶', '樹脂容器': '樹脂容器', 'その他': 'その他' }, 'その他');
}

function normalizeSealedState(value) {
  return normalizeOne(value, { sealed: '密閉', '密閉': '密閉', semi_sealed: '半密閉', '半密閉': '半密閉', open: '開放', '開放': '開放' }, '密閉');
}

function normalizeCommercialDirection(value) {
  return normalizeOne(value, { product: '商品候補', '商品候補': '商品候補', material: '素材販売向き', '素材販売向き': '素材販売向き', hold: '保留', '保留': '保留' }, '保留');
}

function normalizeStepLogStatus(value, abnormalityFlag) {
  if (abnormalityFlag === true || text(abnormalityFlag) === 'true' || text(abnormalityFlag) === 'あり') return '異常';
  return normalizeOne(value, { record: '記録', '記録': '記録', completed: '完了', '完了': '完了', abnormal: '異常', '異常': '異常' }, '記録');
}

function normalizeEventType(value) {
  return normalizeOne(value, { point: 'point', duration: 'duration', other: 'other' }, 'other');
}

async function notionFetch(path, options = {}) {
  const { token } = notionConfig();
  if (!token) throw new Error('NOTION_TOKEN が未設定です');
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function createNotionPage(databaseId, properties) {
  if (!databaseId) throw new Error('Notion database ID が未設定です');
  return notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: databaseId }, properties })
  });
}

async function updateNotionPage(pageId, properties) {
  return notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });
}

async function queryNotionDatabase(databaseId, body = {}) {
  if (!databaseId) return { results: [] };
  return notionFetch(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: 100, ...body })
  });
}

async function findBatchPage(config, batchId) {
  if (!config.token || !config.batchesDatabaseId || !batchId) return null;
  const res = await queryNotionDatabase(config.batchesDatabaseId, {
    filter: { property: 'Batch ID', title: { equals: String(batchId) } }
  });
  return res.results?.[0] || null;
}

function batchProperties(batch = {}) {
  return {
    'Batch ID': titleProp(batch.batchId),
    Status: statusProp(normalizeBatchStatus(batch.status || '進行中')),
    'Material Name': richTextProp(batch.materialName),
    'Method Name': selectProp(normalizeMethodName(batch.methodName || batch.methodId)),
    'Solvent Name': selectProp(normalizeSolventName(batch.solventName)),
    Ratio: richTextProp(batch.ratio),
    'Storage Temperature': selectProp(normalizeStorageTemperature(batch.storageTemperature)),
    'Storage Location': richTextProp(batch.storageLocation),
    'Container Type': selectProp(normalizeContainerType(batch.containerType)),
    'Light Shielded': checkboxProp(batch.lightShielded),
    'Sealed State': selectProp(normalizeSealedState(batch.sealedState)),
    'Comparison Group ID': richTextProp(batch.comparisonGroupId || batch.compareGroupId),
    'Comparison Group Name': richTextProp(batch.comparisonGroupName),
    Operator: richTextProp(batch.operator),
    'Start Date Time': dateProp(batch.selectedStartDateTime || batch.startDateTime),
    'Completed At': dateProp(batch.completedAt),
    'Result Summary': richTextProp(batch.resultSummary),
    'Series Candidate': richTextProp(batch.seriesCandidate),
    'Product Candidate': richTextProp(batch.productCandidate),
    'Commercial Direction': selectProp(normalizeCommercialDirection(batch.commercialDirection))
  };
}

function absorbLog(log = {}) {
  const values = log.logValues || log.logs || log;
  return {
    temperature: log.temperature || values.temperature || values['温度'] || '',
    volume: log.volume || values.volume || values['容量'] || values['量'] || values['収量'] || '',
    aromaNote: log.aromaNote || values.aromaNote || values['香り'] || values['香調'] || values['香りの強さ'] || '',
    colorNote: log.colorNote || values.colorNote || values['色'] || values['色変化'] || '',
    precipitateNote: log.precipitateNote || values.precipitateNote || values['濁り'] || values['沈殿'] || '',
    abnormalityFlag: log.abnormalityFlag ?? values.abnormalityFlag ?? values['異常有無'] ?? false,
    abnormalityType: log.abnormalityType || values['異常種別'] || '',
    memo: log.memo || values.memo || values['メモ'] || ''
  };
}

function stepLogProperties(row = {}) {
  const a = absorbLog(row);
  return {
    'Log ID': titleProp(row.logId),
    'Batch ID': richTextProp(row.batchId),
    'Step ID': richTextProp(row.stepId),
    'Step Title': richTextProp(row.stepTitle),
    'Event ID': richTextProp(row.eventId || row.localEventId),
    'Event Type': selectProp(normalizeEventType(row.eventType)),
    'Scheduled At': dateProp(row.scheduledAt),
    'Logged At': dateProp(row.loggedAt),
    Operator: richTextProp(row.operator),
    Status: selectProp(normalizeStepLogStatus(row.status, a.abnormalityFlag)),
    Temperature: richTextProp(a.temperature),
    Volume: richTextProp(a.volume),
    'Aroma Note': richTextProp(a.aromaNote),
    'Color Note': richTextProp(a.colorNote),
    'Precipitate Note': richTextProp(a.precipitateNote),
    'Abnormality Flag': checkboxProp(a.abnormalityFlag),
    'Abnormality Type': richTextProp(a.abnormalityType),
    'Next Attention': richTextProp(row.nextAttentionMemo || row.nextAttention),
    'Improvement Note': richTextProp(row.improvementNote),
    Memo: richTextProp(a.memo)
  };
}

function completionProperties(row = {}) {
  return {
    'Completion ID': titleProp(row.completionId),
    'Batch ID': richTextProp(row.batchId),
    'Brand Candidate': richTextProp(row.brandCandidate),
    'Series Candidate': richTextProp(row.seriesCandidate),
    'Product Candidate': richTextProp(row.productCandidate),
    'Commercial Direction': selectProp(normalizeCommercialDirection(row.commercialDirection)),
    'Commercial Potential': richTextProp(row.commercialPotential),
    'Completed At': dateProp(row.completedAt),
    'Final Aroma': richTextProp(row.finalAroma),
    'Final Score': richTextProp(row.finalScore || row.overallRating),
    'Final Yield': richTextProp(row.finalYield),
    'Fit Memo': richTextProp(row.fitMemo),
    'Fit Score': richTextProp(row.fitScore),
    'Issue Summary': richTextProp(row.issueSummary),
    'Luxury Feel': richTextProp(row.luxuryFeel),
    Memorability: richTextProp(row.memorability),
    'Next Improvement': richTextProp(row.nextImprovement),
    Operator: richTextProp(row.operator),
    'Overall Rating': richTextProp(row.overallRating),
    'Reproducibility Estimate': richTextProp(row.reproducibilityEstimate),
    'Result Summary': richTextProp(row.resultSummary),
    'World Fit': richTextProp(row.worldFit)
  };
}

function trialProperties(trial = {}) {
  return {
    'Trial ID': titleProp(trial.trialId),
    'Trial Name': richTextProp(trial.trialName),
    'Series Candidate': richTextProp(trial.seriesCandidate),
    Concept: richTextProp(trial.concept),
    Direction: richTextProp(trial.direction),
    'Reference Perfume': richTextProp(trial.referencePerfume),
    'Target Impression': richTextProp(trial.targetImpression),
    'Total Amount': numberOrTextProp(trial.totalAmount),
    Unit: selectProp(trial.unit || 'g'),
    'Fragrance Load Percent': numberOrTextProp(trial.fragranceLoadPercent),
    'Alcohol Amount': numberOrTextProp(trial.alcoholAmount),
    'Water Amount': numberOrTextProp(trial.waterAmount),
    'Maturation Start Date': dateProp(trial.maturationStartDate),
    Status: selectProp(trial.status || '設計中'),
    'Overall Memo': richTextProp(trial.overallMemo),
    'Next Improvement': richTextProp(trial.nextImprovement),
    'Created At': dateProp(trial.createdAt),
    Operator: richTextProp(trial.operator)
  };
}

function formulaLineProperties(line = {}) {
  return {
    'Line ID': titleProp(line.lineId),
    'Trial ID': richTextProp(line.trialId),
    'Material ID': richTextProp(line.materialId),
    'Material Name': richTextProp(line.materialName),
    'Material Source': selectProp(line.materialSource || '手入力'),
    'Note Position': selectProp(line.notePosition || '補助'),
    Amount: numberOrTextProp(line.amount),
    Unit: selectProp(line.unit || 'g'),
    Percent: numberOrTextProp(line.percent),
    'Role Memo': richTextProp(line.roleMemo),
    'Caution Memo': richTextProp(line.cautionMemo)
  };
}

function reviewProperties(row = {}) {
  return {
    'Review ID': titleProp(row.reviewId),
    'Trial ID': richTextProp(row.trialId),
    'Review Date': dateProp(row.reviewDate),
    'Days After Maturation': numberOrTextProp(row.daysAfterMaturation),
    'Top Impression': richTextProp(row.topImpression),
    'Middle Impression': richTextProp(row.middleImpression),
    'Base Impression': richTextProp(row.baseImpression),
    Diffusion: richTextProp(row.diffusion),
    Longevity: richTextProp(row.longevity),
    Balance: richTextProp(row.balance),
    'Luxury Feel': richTextProp(row.luxuryFeel),
    'Japanese Impression': richTextProp(row.japaneseImpression),
    Memorability: richTextProp(row.memorability),
    Problem: richTextProp(row.problem),
    'Next Improvement': richTextProp(row.nextImprovement),
    'Overall Rating': richTextProp(row.overallRating),
    Operator: richTextProp(row.operator)
  };
}

function plainText(items = []) {
  return (items || []).map((item) => item?.plain_text || '').join('').trim();
}

function propText(props, key) {
  const prop = props?.[key];
  if (!prop) return '';
  if (prop.title) return plainText(prop.title);
  if (prop.rich_text) return plainText(prop.rich_text);
  if (prop.select) return prop.select?.name || '';
  if (prop.multi_select) return (prop.multi_select || []).map((x) => x.name).join(', ');
  if (prop.status) return prop.status?.name || '';
  if (prop.number !== undefined) return String(prop.number ?? '');
  if (prop.checkbox !== undefined) return prop.checkbox ? '1' : '';
  if (prop.date) return prop.date?.start || '';
  return '';
}

function mapOwnedMaterialPage(page) {
  const p = page.properties || {};
  return {
    materialId: propText(p, 'Material ID'),
    name: propText(p, 'Name'),
    sourceType: propText(p, 'Source Type'),
    linkedAromaDbName: propText(p, 'Linked Aroma DB Name'),
    linkedCompletionId: propText(p, 'Linked Completion ID'),
    batchId: propText(p, 'Batch ID'),
    notePosition: propText(p, 'Note Position'),
    aromaCategory: propText(p, 'Aroma Category'),
    aromaDescription: propText(p, 'Aroma Description'),
    strength: propText(p, 'Strength'),
    luxuryFeel: propText(p, 'Luxury Feel'),
    japaneseImpression: propText(p, 'Japanese Impression'),
    memorability: propText(p, 'Memorability'),
    reproducibility: propText(p, 'Reproducibility'),
    safetyMemo: propText(p, 'Safety Memo'),
    stockAmount: propText(p, 'Stock Amount'),
    unit: propText(p, 'Unit'),
    storageLocation: propText(p, 'Storage Location'),
    usability: propText(p, 'Usability'),
    recommendedUse: propText(p, 'Recommended Use'),
    memo: propText(p, 'Memo')
  };
}

function mapAromaPage(page) {
  const p = page.properties || {};
  return {
    name: propText(p, '名前'),
    inci: propText(p, '英語名/INCI'),
    classification: propText(p, '分類'),
    notePosition: propText(p, 'ノート'),
    aromaCategory: propText(p, '香調カテゴリ'),
    aromaDescription: propText(p, '香りの特徴'),
    compatibility: propText(p, '香りの相性'),
    usageExample: propText(p, '使用例'),
    safetyMemo: propText(p, '安全性メモ')
  };
}

function mapPerfumePage(page) {
  const p = page.properties || {};
  return {
    name: propText(p, '名前'),
    brand: propText(p, 'ブランド'),
    topNotes: propText(p, 'トップノート'),
    middleNotes: propText(p, 'ミドルノート'),
    baseNotes: propText(p, 'ベースノート'),
    keyMaterials: propText(p, '主要香料'),
    fragranceFamily: propText(p, '香調'),
    aromaDescription: propText(p, '香りの特徴'),
    marketRating: propText(p, '市場評価'),
    popularity: propText(p, '人気度'),
    priceRange: propText(p, '参考価格帯')
  };
}

function mapCompletionPage(page) {
  const p = page.properties || {};
  return {
    completionId: propText(p, 'Completion ID'),
    batchId: propText(p, 'Batch ID'),
    finalAroma: propText(p, 'Final Aroma'),
    finalYield: propText(p, 'Final Yield'),
    luxuryFeel: propText(p, 'Luxury Feel'),
    memorability: propText(p, 'Memorability'),
    reproducibilityEstimate: propText(p, 'Reproducibility Estimate'),
    commercialDirection: propText(p, 'Commercial Direction'),
    commercialPotential: propText(p, 'Commercial Potential'),
    fitScore: propText(p, 'Fit Score'),
    resultSummary: propText(p, 'Result Summary'),
    seriesCandidate: propText(p, 'Series Candidate'),
    productCandidate: propText(p, 'Product Candidate'),
    nextImprovement: propText(p, 'Next Improvement')
  };
}

function matchesQuery(item, query, keys) {
  const q = text(query).toLowerCase();
  if (!q) return true;
  return keys.some((key) => String(item[key] || '').toLowerCase().includes(q));
}

async function listDatabaseItems(databaseId, mapper, query, keys) {
  if (!databaseId) return { ok: true, notConfigured: true, items: [] };
  const pages = await queryNotionDatabase(databaseId);
  return { ok: true, items: (pages.results || []).map(mapper).filter((item) => matchesQuery(item, query, keys)) };
}

function scoreCandidate(item = {}) {
  const numeric = Number(String(item.fitScore || item.commercialPotential || '').replace(/[^\d.-]/g, ''));
  if (Number.isFinite(numeric)) return numeric;
  const s = `${item.fitScore || ''} ${item.commercialPotential || ''}`;
  if (/高|A/i.test(s)) return 5;
  if (/中|B/i.test(s)) return 4;
  return 0;
}

function extractedMaterialCandidates(state) {
  const byBatch = new Map((state.batches || []).map((batch) => [batch.batchId, batch]));
  const rows = [...(state.completionLogs || []), ...(state.batches || []).filter((batch) => batch.completedAt || batch.status === '完了')];
  return rows
    .map((row) => ({ ...(byBatch.get(row.batchId) || {}), ...row }))
    .filter((row) => ['商品候補', '素材販売向き'].includes(normalizeCommercialDirection(row.commercialDirection)) || scoreCandidate(row) >= 4)
    .map((row) => ({
      completionId: row.completionId || '',
      batchId: row.batchId,
      finalAroma: row.finalAroma,
      finalYield: row.finalYield,
      luxuryFeel: row.luxuryFeel,
      memorability: row.memorability,
      reproducibilityEstimate: row.reproducibilityEstimate,
      commercialDirection: normalizeCommercialDirection(row.commercialDirection),
      commercialPotential: row.commercialPotential,
      fitScore: row.fitScore,
      resultSummary: row.resultSummary,
      seriesCandidate: row.seriesCandidate,
      productCandidate: row.productCandidate,
      nextImprovement: row.nextImprovement
    }));
}

function enqueueNotionFailure(state, type, payload, error) {
  const item = {
    id: `notion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    payload,
    error: error?.message || String(error || ''),
    createdAt: new Date().toISOString(),
    retryCount: 0
  };
  state.pendingNotionSync = [item, ...(state.pendingNotionSync || [])];
  return item;
}

async function sendNotionItem(item, config) {
  if (!config.token) throw new Error('NOTION_TOKEN が未設定です');
  if (item.type === 'batch') return createNotionPage(config.batchesDatabaseId, batchProperties(item.payload));
  if (item.type === 'stepLog') return createNotionPage(config.stepLogsDatabaseId, stepLogProperties(item.payload));
  if (item.type === 'completion') return createNotionPage(config.completionLogsDatabaseId, completionProperties(item.payload));
  if (item.type === 'batchUpdate') return updateBatchCompletionInNotion(item.payload, config);
  if (item.type === 'perfumeTrial') return createNotionPage(config.perfumeTrialsDatabaseId, trialProperties(item.payload));
  if (item.type === 'formulaLines') {
    const results = [];
    for (const line of item.payload.lines || []) results.push(await createNotionPage(config.formulaLinesDatabaseId, formulaLineProperties(line)));
    return { ok: true, results };
  }
  if (item.type === 'trialReview') return createNotionPage(config.trialReviewsDatabaseId, reviewProperties(item.payload));
  throw new Error(`unknown pending notion type: ${item.type}`);
}

async function updateBatchCompletionInNotion(row, config) {
  const page = await findBatchPage(config, row.batchId);
  if (!page?.id) return { ok: false, notFound: true, error: 'Batches DBに対象Batch IDが見つかりません' };
  const updated = await updateNotionPage(page.id, {
    Status: statusProp('完了'),
    'Completed At': dateProp(row.completedAt),
    'Result Summary': richTextProp(row.resultSummary),
    'Series Candidate': richTextProp(row.seriesCandidate),
    'Product Candidate': richTextProp(row.productCandidate),
    'Commercial Direction': selectProp(normalizeCommercialDirection(row.commercialDirection))
  });
  return { ok: true, pageId: updated.id || page.id };
}

async function retryPendingNotionSync(state, config) {
  const pending = [...(state.pendingNotionSync || [])].reverse();
  const failed = [];
  const results = [];
  for (const item of pending) {
    try {
      const result = await sendNotionItem(item, config);
      results.push({ id: item.id, ok: true, result });
    } catch (error) {
      failed.unshift({ ...item, retryCount: Number(item.retryCount || 0) + 1, error: error.message || String(error) });
      results.push({ id: item.id, ok: false, error: error.message || String(error) });
    }
  }
  state.pendingNotionSync = failed;
  await saveState(state);
  return { ok: true, before: pending.length, after: failed.length, results };
}

function computeHomeStats(state) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 86400000 - 1;
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
    completedWithoutProductCandidateCount: completed.filter((b) => !text(b.seriesCandidate) && !text(b.productCandidate)).length,
    comparePendingCompletedCount: completed.filter((b) => !text(b.comparisonGroupId || b.compareGroupId)).length
  };
}

function todayEvents(state) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 86400000 - 1;
  return (state.pendingEvents || []).filter((e) => {
    const t = new Date(e.startDateTime).getTime();
    return !e.completed && t >= start && t <= end;
  });
}

function filterBatches(state, filters = {}) {
  return (state.batches || []).filter((b) => {
    if (filters.status === 'in_progress' && b.status === '完了') return false;
    if (filters.status === 'completed' && b.status !== '完了') return false;
    if (filters.materialName && !String(b.materialName || '').includes(filters.materialName)) return false;
    if (filters.commercialDirection && b.commercialDirection !== filters.commercialDirection) return false;
    return true;
  });
}

async function handleMessage(message) {
  const state = mergeClientState(await readState(), message.clientState || {});
  const payload = message.payload || {};
  const config = notionConfig(state.appSettings || {});

  switch (message.type) {
    case 'GET_HOME_STATS':
      return { ok: true, ...computeHomeStats(state) };

    case 'GET_TODAY_PENDING':
      return { ok: true, items: todayEvents(state) };

    case 'GET_PROGRESS_TARGETS':
      return {
        ok: true,
        todayEvents: todayEvents(state),
        inProgressBatches: (state.batches || []).filter((b) => b.status !== '完了').map((batch) => ({
          ...batch,
          pendingSteps: (state.pendingEvents || []).filter((e) => e.batchId === batch.batchId && !e.completed)
        }))
      };

    case 'GET_BATCHES':
      return { ok: true, items: filterBatches(state, payload) };

    case 'GET_NOTION_SYNC_STATUS':
      return { ok: true, count: (state.pendingNotionSync || []).length, items: state.pendingNotionSync || [] };

    case 'RETRY_NOTION_SYNC':
      return retryPendingNotionSync(state, config);

    case 'TEST_NOTION_SYNC':
      return { ok: Boolean(config.token), enabled: Boolean(config.token), error: config.token ? '' : 'NOTION_TOKEN が未設定です' };

    case 'GET_PERFUME_TRIAL_INFO':
      return {
        ok: true,
        perfumeDatabaseConfigured: Boolean(config.perfumeDatabaseId),
        aromaDatabaseConfigured: Boolean(config.aromaDatabaseId),
        ownedMaterialsDatabaseConfigured: Boolean(config.ownedMaterialsDatabaseId),
        perfumeTrialsDatabaseConfigured: Boolean(config.perfumeTrialsDatabaseId),
        formulaLinesDatabaseConfigured: Boolean(config.formulaLinesDatabaseId),
        trialReviewsDatabaseConfigured: Boolean(config.trialReviewsDatabaseId)
      };

    case 'LIST_OWNED_MATERIALS': {
      const res = await listDatabaseItems(config.ownedMaterialsDatabaseId, mapOwnedMaterialPage, payload.query, ['name', 'aromaCategory', 'aromaDescription', 'memo', 'safetyMemo']);
      return { ...res, items: (res.items || []).filter((item) => !item.usability || item.usability === '試作使用可') };
    }

    case 'LIST_AROMA_DATABASE':
      return listDatabaseItems(config.aromaDatabaseId, mapAromaPage, payload.query, ['name', 'aromaCategory', 'notePosition', 'aromaDescription', 'compatibility']);

    case 'LIST_PERFUME_DATABASE':
      return listDatabaseItems(config.perfumeDatabaseId, mapPerfumePage, payload.query, ['name', 'brand', 'fragranceFamily', 'keyMaterials', 'aromaDescription']);

    case 'LIST_EXTRACTED_MATERIAL_CANDIDATES':
    case 'GET_EXTRACTED_MATERIAL_CANDIDATES': {
      if (config.token && config.completionLogsDatabaseId) {
        const res = await listDatabaseItems(config.completionLogsDatabaseId, mapCompletionPage, payload.query, ['completionId', 'batchId', 'finalAroma', 'resultSummary', 'seriesCandidate', 'productCandidate']);
        return { ...res, items: (res.items || []).filter((item) => ['商品候補', '素材販売向き'].includes(normalizeCommercialDirection(item.commercialDirection)) || scoreCandidate(item) >= 4) };
      }
      return { ok: true, items: extractedMaterialCandidates(state) };
    }

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
        try {
          notion = await createNotionPage(config.batchesDatabaseId, batchProperties(batch));
        } catch (error) {
          enqueueNotionFailure(state, 'batch', batch, error);
          notion = { ok: false, queued: true, error: error.message };
        }
      }
      await saveState(state);
      return { ok: true, batchId: batch.batchId, calendarEvents: [], generatedEventCount: batch.events?.length || 0, sheetSync: { ok: false, skipped: true }, notion, statePatch: state };
    }

    case 'LOG_STEP':
    case 'COMPLETE_EVENT': {
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
        operator: payload.operator || '',
        status: message.type === 'COMPLETE_EVENT' || payload.markDone ? '完了' : '記録',
        logs: payload.logs || {},
        eventId: payload.eventId || payload.localEventId || ''
      };
      state.eventLogs = { ...(state.eventLogs || {}), [`${payload.batchId}:${payload.stepId}`]: { ...(payload.logs || {}), updatedAt: new Date().toISOString() } };
      if (message.type === 'COMPLETE_EVENT' || payload.markDone) {
        state.pendingEvents = (state.pendingEvents || []).map((item) => item.localEventId === payload.localEventId ? { ...item, completed: true, completedAt: new Date().toISOString() } : item);
      }
      let notion = { skipped: true };
      if (config.token && config.stepLogsDatabaseId) {
        try {
          notion = await createNotionPage(config.stepLogsDatabaseId, stepLogProperties(row));
        } catch (error) {
          enqueueNotionFailure(state, 'stepLog', row, error);
          notion = { ok: false, queued: true, error: error.message };
        }
      }
      await saveState(state);
      return { ok: true, logId, photoCount: 0, notion, statePatch: state };
    }

    case 'ADD_STORAGE_LOG': {
      const row = { ...payload, logId: uid('STG'), recordedAt: payload.recordedAt || new Date().toISOString() };
      state.storageLogs = [row, ...(state.storageLogs || [])];
      await saveState(state);
      return { ok: true, logId: row.logId, photoCount: 0, notion: { skipped: true }, statePatch: state };
    }

    case 'SUBMIT_COMPLETION': {
      const row = { ...payload, completionId: uid('CMP'), completedAt: payload.completedAt || new Date().toISOString() };
      state.completionLogs = [row, ...(state.completionLogs || [])];
      state.batches = (state.batches || []).map((batch) => batch.batchId === payload.batchId ? { ...batch, ...payload, status: '完了', completedAt: row.completedAt, updatedAt: new Date().toISOString() } : batch);
      let notion = { skipped: true };
      let batchUpdate = { skipped: true };
      if (config.token && config.completionLogsDatabaseId) {
        try {
          notion = await createNotionPage(config.completionLogsDatabaseId, completionProperties(row));
        } catch (error) {
          enqueueNotionFailure(state, 'completion', row, error);
          notion = { ok: false, queued: true, error: error.message };
        }
        try {
          batchUpdate = await updateBatchCompletionInNotion(row, config);
          if (batchUpdate?.notFound) enqueueNotionFailure(state, 'batchUpdate', row, new Error(batchUpdate.error));
        } catch (error) {
          enqueueNotionFailure(state, 'batchUpdate', row, error);
          batchUpdate = { ok: false, queued: true, error: error.message };
        }
      }
      await saveState(state);
      return { ok: true, completionId: row.completionId, photoCount: 0, sheetResult: { ok: false, skipped: true }, notion, batchUpdate, warning: batchUpdate?.error || '', statePatch: state };
    }

    case 'SAVE_PERFUME_TRIAL': {
      const trialId = payload.trial?.trialId || uid('TRIAL');
      const trial = { ...(payload.trial || {}), trialId, createdAt: payload.trial?.createdAt || new Date().toISOString() };
      const lines = (payload.lines || []).map((line, index) => ({ ...line, trialId, lineId: line.lineId || `${trialId}-L${String(index + 1).padStart(2, '0')}` }));
      let trialPage = null;
      let linePages = [];
      let queued = false;
      if (!config.token || !config.perfumeTrialsDatabaseId || !config.formulaLinesDatabaseId) {
        enqueueNotionFailure(state, 'perfumeTrial', trial, new Error('Perfume Trials / Formula Lines DB未設定です'));
        enqueueNotionFailure(state, 'formulaLines', { trialId, lines }, new Error('Perfume Trials / Formula Lines DB未設定です'));
        queued = true;
      } else {
        try {
          trialPage = await createNotionPage(config.perfumeTrialsDatabaseId, trialProperties(trial));
          for (const line of lines) linePages.push(await createNotionPage(config.formulaLinesDatabaseId, formulaLineProperties(line)));
        } catch (error) {
          enqueueNotionFailure(state, 'perfumeTrial', trial, error);
          enqueueNotionFailure(state, 'formulaLines', { trialId, lines }, error);
          queued = true;
        }
      }
      state.perfumeTrials = [{ ...trial, lines, notionPageId: trialPage?.id || '' }, ...(state.perfumeTrials || [])];
      await saveState(state);
      return { ok: true, trialId, notionPageId: trialPage?.id || '', lineCount: lines.length, linePageCount: linePages.length, queued, statePatch: state };
    }

    case 'CREATE_TRIAL_REVIEW': {
      const review = { ...(payload.review || payload), reviewId: payload.review?.reviewId || payload.reviewId || uid('REV') };
      if (!config.token || !config.trialReviewsDatabaseId) {
        enqueueNotionFailure(state, 'trialReview', review, new Error('Trial Reviews DB未設定です'));
        await saveState(state);
        return { ok: true, reviewId: review.reviewId, queued: true, statePatch: state };
      }
      try {
        const page = await createNotionPage(config.trialReviewsDatabaseId, reviewProperties(review));
        return { ok: true, reviewId: review.reviewId, notionPageId: page.id };
      } catch (error) {
        enqueueNotionFailure(state, 'trialReview', review, error);
        await saveState(state);
        return { ok: true, reviewId: review.reviewId, queued: true, warning: error.message, statePatch: state };
      }
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
      res.writeHead(204, corsHeaders(req));
      res.end();
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
