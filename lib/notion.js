const NOTION_VERSION = '2022-06-28';

function parseDatabaseId(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : text;
}

function notionConfig(settings = {}) {
  const notion = settings.notion || {};
  return {
    enabled: Boolean(notion.enabled),
    token: String(notion.token || '').trim(),
    batchesDatabaseId: parseDatabaseId(notion.batchesDatabaseId),
    stepLogsDatabaseId: parseDatabaseId(notion.stepLogsDatabaseId),
    completionLogsDatabaseId: parseDatabaseId(notion.completionLogsDatabaseId)
  };
}

export function isNotionSyncEnabled(settings = {}) {
  return notionConfig(settings).enabled;
}

function assertReady(settings, kinds = ['batches', 'stepLogs', 'completionLogs']) {
  const config = notionConfig(settings);
  if (!config.enabled) return null;
  if (!config.token) throw new Error('Notion API トークンが未設定です');
  if (kinds.includes('batches') && !config.batchesDatabaseId) throw new Error('Notion Batches DB ID が未設定です');
  if (kinds.includes('stepLogs') && !config.stepLogsDatabaseId) throw new Error('Notion Step Logs DB ID が未設定です');
  if (kinds.includes('completionLogs') && !config.completionLogsDatabaseId) throw new Error('Notion Completion Logs DB ID が未設定です');
  return config;
}

async function notionFetch(path, token, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API エラー: ${res.status} ${text}`);
  }
  return res.json();
}

function textContent(value, limit = 1900) {
  return String(value || '').trim().slice(0, limit);
}

function titleProp(value) {
  const text = textContent(value);
  return { title: text ? [{ type: 'text', text: { content: text } }] : [] };
}

function richTextProp(value) {
  const text = textContent(value);
  return { rich_text: text ? [{ type: 'text', text: { content: text } }] : [] };
}

function selectName(value, allowed = [], fallback = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!allowed.length || allowed.includes(text)) return text;
  return fallback && allowed.includes(fallback) ? fallback : '';
}

function selectProp(value, allowed = [], fallback = '') {
  const name = selectName(value, allowed, fallback);
  return name ? { select: { name } } : { select: null };
}

function statusProp(value) {
  const name = selectName(value, ['未着手', '進行中', '完了'], '進行中');
  return { status: { name } };
}

function checkboxProp(value) {
  return { checkbox: Boolean(value) };
}

function dateProp(value) {
  if (!value) return { date: null };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { date: null } : { date: { start: d.toISOString() } };
}

function plainTextFromRich(items = []) {
  return (items || []).map((item) => item?.plain_text || '').join('').trim();
}

function getTitleValue(properties, key) {
  return plainTextFromRich(properties?.[key]?.title || []);
}

function getRichValue(properties, key) {
  return plainTextFromRich(properties?.[key]?.rich_text || []);
}

function getSelectValue(properties, key) {
  return properties?.[key]?.select?.name || '';
}

function getStatusValue(properties, key) {
  return properties?.[key]?.status?.name || '';
}

function getDateValue(properties, key) {
  return properties?.[key]?.date?.start || '';
}

function getCheckboxValue(properties, key) {
  return Boolean(properties?.[key]?.checkbox);
}

function batchProperties(batch) {
  return {
    'Batch ID': titleProp(batch.batchId),
    'Status': statusProp(batch.status || '進行中'),
    'Material Name': richTextProp(batch.materialName),
    'Method Name': selectProp(batch.methodName, ['蒸留', 'チンキ', '溶媒抽出', 'その他'], 'その他'),
    'Solvent Name': selectProp(batch.solventName, ['エタノール', '水', 'その他'], 'その他'),
    'Ratio': richTextProp(batch.ratio),
    'Start Date Time': dateProp(batch.selectedStartDateTime),
    'Completed At': dateProp(batch.completedAt),
    'Operator': richTextProp(batch.operator),
    'Comparison Group ID': richTextProp(batch.comparisonGroupId || batch.compareGroupId),
    'Comparison Group Name': richTextProp(batch.comparisonGroupName),
    'Storage Temperature': selectProp(batch.storageTemperature, ['常温', '冷蔵', '冷凍', 'その他'], 'その他'),
    'Storage Location': richTextProp(batch.storageLocation),
    'Container Type': selectProp(batch.containerType, ['ガラス瓶', '遮光瓶', '樹脂容器', 'その他'], 'その他'),
    'Sealed State': selectProp(batch.sealedState, ['密閉', '半密閉', '開放'], '密閉'),
    'Light Shielded': checkboxProp(batch.lightShielded),
    'Result Summary': richTextProp(batch.resultSummary),
    'Series Candidate': richTextProp(batch.seriesCandidate),
    'Product Candidate': richTextProp(batch.productCandidate),
    'Commercial Direction': selectProp(batch.commercialDirection, ['商品候補', '素材販売向き', '保留'])
  };
}

function stepLogProperties(row) {
  return {
    'Log ID': titleProp(row.logId),
    'Batch ID': richTextProp(row.batchId),
    'Step ID': richTextProp(row.stepId),
    'Step Title': richTextProp(row.stepTitle),
    'Event Type': selectProp(row.eventType, ['point', 'duration', 'other'], 'other'),
    'Scheduled At': dateProp(row.scheduledAt),
    'Logged At': dateProp(row.loggedAt),
    'Operator': richTextProp(row.operator),
    'Status': selectProp(row.status, ['記録', '完了', '異常'], '記録'),
    'Temperature': richTextProp(row.temperature),
    'Volume': richTextProp(row.volume),
    'Color Note': richTextProp(row.colorNote),
    'Aroma Note': richTextProp(row.aromaNote),
    'Precipitate Note': richTextProp(row.precipitateNote),
    'Abnormality Flag': checkboxProp(row.abnormalityFlag && row.abnormalityFlag !== 'なし'),
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
    'Commercial Direction': selectProp(row.commercialDirection, ['商品候補', '素材販売向き', '保留']),
    'Final Score': richTextProp(row.finalScore),
    'Issue Summary': richTextProp(row.issueSummary),
    'Next Improvement': richTextProp(row.nextImprovement),
    'Result Summary': richTextProp(row.resultSummary),
    'Operator': richTextProp(row.operator)
  };
}

async function queryDatabaseAll(databaseId, token, filter) {
  const results = [];
  let cursor;
  do {
    const body = {
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(cursor ? { start_cursor: cursor } : {})
    };
    const json = await notionFetch(`/databases/${databaseId}/query`, token, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    results.push(...(json.results || []));
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return results;
}

async function probeDatabase(databaseId, token) {
  const body = { page_size: 1 };
  const json = await notionFetch(`/databases/${databaseId}/query`, token, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return {
    ok: true,
    count: Array.isArray(json.results) ? json.results.length : 0
  };
}

async function findPageByTitle(databaseId, token, propertyName, value) {
  const filter = {
    property: propertyName,
    title: { equals: String(value || '') }
  };
  const results = await queryDatabaseAll(databaseId, token, filter);
  return results[0] || null;
}

async function findPagesByRichText(databaseId, token, propertyName, value) {
  const filter = {
    property: propertyName,
    rich_text: { equals: String(value || '') }
  };
  return queryDatabaseAll(databaseId, token, filter);
}

async function createPage(databaseId, token, properties) {
  return notionFetch('/pages', token, {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties
    })
  });
}

async function updatePage(pageId, token, properties) {
  return notionFetch(`/pages/${pageId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });
}

async function archivePage(pageId, token) {
  return notionFetch(`/pages/${pageId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true })
  });
}

export async function upsertBatchToNotion(settings, batch) {
  const config = assertReady(settings, ['batches']);
  if (!config) return { ok: false, skipped: true };
  const existing = await findPageByTitle(config.batchesDatabaseId, config.token, 'Batch ID', batch.batchId);
  const properties = batchProperties(batch);
  if (existing?.id) {
    await updatePage(existing.id, config.token, properties);
    return { ok: true, pageId: existing.id, action: 'updated' };
  }
  const created = await createPage(config.batchesDatabaseId, config.token, properties);
  return { ok: true, pageId: created.id, action: 'created' };
}

export async function appendStepLogToNotion(settings, row) {
  const config = assertReady(settings, ['stepLogs']);
  if (!config) return { ok: false, skipped: true };
  const created = await createPage(config.stepLogsDatabaseId, config.token, stepLogProperties(row));
  return { ok: true, pageId: created.id };
}

export async function appendCompletionLogToNotion(settings, row) {
  const config = assertReady(settings, ['completionLogs']);
  if (!config) return { ok: false, skipped: true };
  const created = await createPage(config.completionLogsDatabaseId, config.token, completionProperties(row));
  return { ok: true, pageId: created.id };
}

export async function archiveBatchInNotion(settings, batchId) {
  const config = assertReady(settings, ['batches']);
  if (!config) return { ok: false, skipped: true };
  const existing = await findPageByTitle(config.batchesDatabaseId, config.token, 'Batch ID', batchId);
  if (!existing?.id) return { ok: true, skipped: true, notFound: true };
  await archivePage(existing.id, config.token);
  return { ok: true, pageId: existing.id };
}

export async function archiveBatchRelatedInNotion(settings, batchId) {
  const config = assertReady(settings, ['batches', 'stepLogs', 'completionLogs']);
  if (!config) return { ok: false, skipped: true };
  const result = {
    ok: true,
    batch: null,
    stepLogs: 0,
    completionLogs: 0
  };

  const batch = await findPageByTitle(config.batchesDatabaseId, config.token, 'Batch ID', batchId);
  if (batch?.id) {
    await archivePage(batch.id, config.token);
    result.batch = batch.id;
  }

  const stepLogs = await findPagesByRichText(config.stepLogsDatabaseId, config.token, 'Batch ID', batchId);
  for (const page of stepLogs) {
    await archivePage(page.id, config.token);
    result.stepLogs += 1;
  }

  const completionLogs = await findPagesByRichText(config.completionLogsDatabaseId, config.token, 'Batch ID', batchId);
  for (const page of completionLogs) {
    await archivePage(page.id, config.token);
    result.completionLogs += 1;
  }

  return result;
}

export async function validateNotionConfig(settings) {
  const config = notionConfig(settings);
  if (!config.enabled) {
    return { ok: false, error: 'Notion同期がOFFです', enabled: false };
  }
  if (!config.token) {
    return { ok: false, error: 'Notion API トークンが未設定です', enabled: true };
  }
  const result = {
    ok: true,
    enabled: true,
    batches: null,
    stepLogs: null,
    completionLogs: null
  };
  try {
    if (!config.batchesDatabaseId) throw new Error('Batches DB ID が未設定です');
    result.batches = await probeDatabase(config.batchesDatabaseId, config.token);
  } catch (error) {
    result.ok = false;
    result.batches = { ok: false, error: error.message };
  }
  try {
    if (!config.stepLogsDatabaseId) throw new Error('Step Logs DB ID が未設定です');
    result.stepLogs = await probeDatabase(config.stepLogsDatabaseId, config.token);
  } catch (error) {
    result.ok = false;
    result.stepLogs = { ok: false, error: error.message };
  }
  try {
    if (!config.completionLogsDatabaseId) throw new Error('Completion Logs DB ID が未設定です');
    result.completionLogs = await probeDatabase(config.completionLogsDatabaseId, config.token);
  } catch (error) {
    result.ok = false;
    result.completionLogs = { ok: false, error: error.message };
  }
  return result;
}

export async function listBatchesFromNotion(settings) {
  const config = assertReady(settings, ['batches']);
  if (!config) return [];
  const pages = await queryDatabaseAll(config.batchesDatabaseId, config.token);
  return pages.map((page) => {
    const properties = page.properties || {};
    return {
      batchId: getTitleValue(properties, 'Batch ID'),
      status: getStatusValue(properties, 'Status') || '進行中',
      materialName: getRichValue(properties, 'Material Name'),
      methodName: getSelectValue(properties, 'Method Name'),
      solventName: getSelectValue(properties, 'Solvent Name'),
      ratio: getRichValue(properties, 'Ratio'),
      selectedStartDateTime: getDateValue(properties, 'Start Date Time'),
      completedAt: getDateValue(properties, 'Completed At'),
      operator: getRichValue(properties, 'Operator'),
      comparisonGroupId: getRichValue(properties, 'Comparison Group ID'),
      comparisonGroupName: getRichValue(properties, 'Comparison Group Name'),
      storageTemperature: getSelectValue(properties, 'Storage Temperature'),
      storageLocation: getRichValue(properties, 'Storage Location'),
      containerType: getSelectValue(properties, 'Container Type'),
      sealedState: getSelectValue(properties, 'Sealed State'),
      lightShielded: getCheckboxValue(properties, 'Light Shielded'),
      resultSummary: getRichValue(properties, 'Result Summary'),
      seriesCandidate: getRichValue(properties, 'Series Candidate'),
      productCandidate: getRichValue(properties, 'Product Candidate'),
      commercialDirection: getSelectValue(properties, 'Commercial Direction'),
      notionPageId: page.id
    };
  }).filter((batch) => batch.batchId);
}
