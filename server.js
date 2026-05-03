import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const NOTION_VERSION = "2022-06-28";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

const ALLOWED_ORIGINS = new Set([
  "https://japanese-fragrance.jp",
  "https://www.japanese-fragrance.jp",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const MATERIAL_PROPERTY_NAMES = [
  "category",
  "subCategory",
  "aromaTags",
  "intensity",
  "volatility",
  "impressionTags",
  "blendAffinity",
  "avoidCombination",
  "fixativeLevel",
  "usableExtractionMethods",
  "relatedBatches"
];

const PERFUME_PROPERTY_NAMES = [
  "fragranceFamily",
  "topNotes",
  "middleNotes",
  "baseNotes",
  "relatedMaterials",
  "impressionTags",
  "usageScenes"
];

const materialAliases = {
  name: ["原料名", "名前", "Name", "name", "title"],
  japaneseName: ["和名", "日本語名", "Japanese Name", "japaneseName"],
  englishName: ["英名", "English Name", "englishName"],
  scientificName: ["学名", "Scientific Name", "scientificName"],
  category: ["category", "分類", "カテゴリー", "Category"],
  subCategory: ["subCategory", "サブ分類", "小分類", "Sub Category"],
  aromaProfile: ["aromaProfile", "香調", "香り", "Aroma Profile", "fragranceFamily"],
  aromaTags: ["aromaTags", "香りタグ", "香調タグ", "Aroma Tags"],
  intensity: ["intensity", "香りの強さ", "強度", "Intensity"],
  volatility: ["volatility", "揮発性", "ノート区分", "Volatility"],
  impressionTags: ["impressionTags", "印象タグ", "印象", "Impression Tags"],
  partUsed: ["使用部位", "部位", "Part Used", "partUsed"],
  extractionMethods: ["extractionMethods", "抽出方法", "抽出法", "Extraction Methods"],
  usableExtractionMethods: ["usableExtractionMethods", "使用可能な抽出方法", "利用可能抽出方法", "Usable Extraction Methods"],
  origin: ["産地", "原産地", "Origin", "origin"],
  blendAffinity: ["blendAffinity", "相性の良い組み合わせ", "ブレンド相性", "Blend Affinity"],
  avoidCombination: ["avoidCombination", "避けたい組み合わせ", "相性注意", "Avoid Combination"],
  fixativeLevel: ["fixativeLevel", "定着力", "Fixative Level"],
  memo: ["memo", "自社メモ", "メモ", "Memo"],
  referenceUrls: ["referenceUrls", "参考URL", "参考Url", "URL", "Reference URLs"]
};

const perfumeAliases = {
  name: ["香水名", "名前", "Name", "name", "title"],
  brand: ["ブランド", "Brand", "brand"],
  fragranceFamily: ["fragranceFamily", "family", "fragranceType", "type", "category", "香調", "系統", "Fragrance Family"],
  topNotes: ["topNotes", "top", "topNote", "トップノート", "トップ", "Top Notes"],
  middleNotes: ["middleNotes", "middle", "heart", "middleNote", "ミドルノート", "ミドル", "Middle Notes"],
  baseNotes: ["baseNotes", "base", "last", "baseNote", "ラストノート", "ベースノート", "Last Notes", "Base Notes"],
  relatedMaterials: ["relatedMaterials", "関連原料", "原料", "Materials", "materials", "Related Materials"],
  impressionTags: ["impressionTags", "印象タグ", "印象", "Impression Tags"],
  usageScenes: ["usageScenes", "使用シーンタグ", "利用シーン", "Usage Scenes"],
  scenes: ["scenes", "使用シーン", "シーン", "Scenes"],
  memo: ["memo", "concept", "description", "自社コメント", "コメント", "Memo"],
  referenceUrls: ["referenceUrls", "参考URL", "参考Url", "URL", "Reference URLs"]
};

const materialSchema = {
  category: selectProperty(["樹木", "花", "柑橘", "スパイス", "茶", "草", "樹脂", "果実", "葉", "種子", "根", "その他"]),
  subCategory: selectProperty(["和精油", "和ハーブ", "日本産木材", "和柑橘", "茶系原料", "山林系原料", "食材系原料", "再現香料", "その他"]),
  aromaTags: multiSelectProperty(["ウッディ", "グリーン", "シトラス", "フローラル", "スモーキー", "スパイシー", "ハーバル", "フルーティー", "アーシー", "レジン", "パウダリー", "アニマリック", "甘い", "苦い", "渋い", "清涼感", "ミネラル", "その他"]),
  intensity: numberProperty(),
  volatility: selectProperty(["トップ", "ミドル", "ベース", "不明"]),
  impressionTags: multiSelectProperty(["和", "高級", "清潔", "落ち着き", "野性", "温かみ", "静けさ", "透明感", "自然", "寺社", "森林", "茶室", "余韻", "日常", "夜", "その他"]),
  blendAffinity: multiSelectProperty(["柑橘", "木", "スパイス", "フローラル", "茶", "草", "樹脂", "ムスク", "アンバー", "グリーン", "ハーバル", "その他"]),
  avoidCombination: { rich_text: {} },
  fixativeLevel: numberProperty(),
  usableExtractionMethods: multiSelectProperty(["チンキ", "蒸留", "水蒸気蒸留", "圧搾", "溶剤抽出", "CO2抽出", "アンフルラージュ", "ヘッドスペース", "再現香料", "不明"])
};

const perfumeSchema = {
  fragranceFamily: selectProperty(["ウッディ", "フローラル", "シトラス", "オリエンタル", "アンバー", "フレッシュ", "グリーン", "スパイシー", "ハーバル", "アクア", "フゼア", "シプレ", "グルマン", "その他"]),
  topNotes: multiSelectProperty([]),
  middleNotes: multiSelectProperty([]),
  baseNotes: multiSelectProperty([]),
  impressionTags: multiSelectProperty(["和", "高級", "日常", "夜", "静けさ", "清潔", "透明感", "温かみ", "余韻", "自然", "寺社", "茶室", "森林", "モダン", "その他"]),
  usageScenes: multiSelectProperty(["日常", "ビジネス", "夜", "リラックス", "外出", "休日", "寝香水", "瞑想", "ホテル", "旅館", "ギフト", "その他"])
};

function selectProperty(options) {
  return { select: { options: options.map((name) => ({ name })) } };
}

function multiSelectProperty(options) {
  return { multi_select: { options: options.map((name) => ({ name })) } };
}

function numberProperty() {
  return { number: { format: "number" } };
}

function relationProperty(databaseId) {
  return { relation: { database_id: databaseId, type: "single_property", single_property: {} } };
}

function getConfig() {
  return {
    notionApiKey: process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || "",
    materialsDatabaseId: process.env.NOTION_MATERIALS_DATABASE_ID || process.env.NOTION_MATERIAL_DATABASE_ID || process.env.NOTION_MATERIALS_DB_ID || "",
    perfumesDatabaseId: process.env.NOTION_PERFUMES_DATABASE_ID || process.env.NOTION_PERFUME_DATABASE_ID || process.env.NOTION_PERFUMES_DB_ID || "",
    batchesDatabaseId: process.env.NOTION_BATCHES_DATABASE_ID || process.env.NOTION_BATCH_DATABASE_ID || process.env.NOTION_BATCHES_DB_ID || ""
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept,Authorization");
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value == null || value === "") return [];
  return String(value)
    .split(/\r?\n|,|、/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().normalize("NFKC").replace(/\s|_/g, "");
}

function textFromRichText(items = []) {
  return items.map((item) => item.plain_text || item.text?.content || "").join("");
}

function valueFromProperty(property) {
  if (!property) return "";

  switch (property.type) {
    case "title":
      return textFromRichText(property.title);
    case "rich_text":
      return textFromRichText(property.rich_text);
    case "select":
      return property.select?.name || "";
    case "multi_select":
      return property.multi_select?.map((item) => item.name).filter(Boolean) || [];
    case "relation":
      return property.relation?.map((item) => item.id).filter(Boolean) || [];
    case "url":
      return property.url || "";
    case "email":
      return property.email || "";
    case "phone_number":
      return property.phone_number || "";
    case "number":
      return property.number;
    case "checkbox":
      return property.checkbox ? "true" : "";
    case "date":
      return property.date?.start || "";
    case "people":
      return property.people?.map((person) => person.name).filter(Boolean) || [];
    case "files":
      return property.files?.map((file) => file.file?.url || file.external?.url).filter(Boolean) || [];
    case "formula":
      return valueFromFormula(property.formula);
    case "rollup":
      return valueFromRollup(property.rollup);
    default:
      return "";
  }
}

function valueFromFormula(formula) {
  if (!formula) return "";
  if (formula.type === "string") return formula.string || "";
  if (formula.type === "number") return formula.number == null ? "" : formula.number;
  if (formula.type === "boolean") return formula.boolean ? "true" : "";
  if (formula.type === "date") return formula.date?.start || "";
  return "";
}

function valueFromRollup(rollup) {
  if (!rollup) return "";
  if (rollup.type === "array") return rollup.array.map(valueFromProperty).flat().filter(Boolean);
  if (rollup.type === "number") return rollup.number == null ? "" : rollup.number;
  if (rollup.type === "date") return rollup.date?.start || "";
  return "";
}

function pickProperty(properties, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(properties, alias)) return properties[alias];
  }

  const normalizedAliases = aliases.map(normalizeKey);
  const foundKey = Object.keys(properties).find((key) => normalizedAliases.includes(normalizeKey(key)));
  return foundKey ? properties[foundKey] : null;
}

function mapPage(page, aliases) {
  return Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [key, valueFromProperty(pickProperty(page.properties || {}, names))])
  );
}

function normalizeMaterial(page) {
  const item = mapPage(page, materialAliases);
  return {
    id: page.id,
    name: item.name || item.japaneseName || item.englishName || "名称未設定",
    japaneseName: item.japaneseName || "",
    englishName: item.englishName || "",
    scientificName: item.scientificName || "",
    category: item.category || "",
    subCategory: item.subCategory || "",
    aromaProfile: normalizeList(item.aromaProfile),
    aromaTags: normalizeList(item.aromaTags),
    intensity: normalizeNumber(item.intensity),
    volatility: item.volatility || "",
    impressionTags: normalizeList(item.impressionTags),
    partUsed: item.partUsed || "",
    extractionMethods: normalizeList(item.extractionMethods),
    usableExtractionMethods: normalizeList(item.usableExtractionMethods),
    origin: item.origin || "",
    blendAffinity: normalizeList(item.blendAffinity),
    avoidCombination: normalizeList(item.avoidCombination),
    fixativeLevel: normalizeNumber(item.fixativeLevel),
    memo: item.memo || "",
    referenceUrls: normalizeList(item.referenceUrls),
    createdAt: page.created_time || "",
    updatedAt: page.last_edited_time || ""
  };
}

function normalizePerfume(page) {
  const item = mapPage(page, perfumeAliases);
  return {
    id: page.id,
    name: item.name || "名称未設定",
    brand: item.brand || "",
    fragranceFamily: normalizeList(item.fragranceFamily),
    topNotes: normalizeList(item.topNotes),
    middleNotes: normalizeList(item.middleNotes),
    baseNotes: normalizeList(item.baseNotes),
    relatedMaterials: normalizeList(item.relatedMaterials),
    impressionTags: normalizeList(item.impressionTags),
    usageScenes: normalizeList(item.usageScenes),
    scenes: normalizeList(item.scenes),
    memo: item.memo || "",
    referenceUrls: normalizeList(item.referenceUrls),
    createdAt: page.created_time || "",
    updatedAt: page.last_edited_time || ""
  };
}

async function notionRequest(endpoint, options = {}) {
  const { notionApiKey } = getConfig();
  if (!notionApiKey) {
    const error = new Error("NOTION_API_KEY is not set.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Notion API error: ${response.status} ${detail}`);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

async function queryDatabase(databaseId) {
  if (!databaseId) {
    const error = new Error("Notion database id is not set.");
    error.statusCode = 500;
    throw error;
  }

  const results = [];
  let startCursor;

  do {
    const payload = await notionRequest(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {})
      })
    });
    results.push(...(payload.results || []));
    startCursor = payload.has_more ? payload.next_cursor : null;
  } while (startCursor);

  return results;
}

async function retrieveDatabase(databaseId) {
  if (!databaseId) {
    const error = new Error("Notion database id is not set.");
    error.statusCode = 500;
    throw error;
  }
  return notionRequest(`/databases/${databaseId}`);
}

async function updateDatabase(databaseId, properties) {
  return notionRequest(`/databases/${databaseId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties })
  });
}

async function updatePage(pageId, properties) {
  return notionRequest(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties })
  });
}

function databaseTitle(database) {
  return textFromRichText(database.title || []) || database.id;
}

function databaseSummary(database, requiredNames) {
  const existingProperties = requiredNames.filter((name) => Boolean(database.properties?.[name]));
  const missingProperties = requiredNames.filter((name) => !database.properties?.[name]);
  return {
    id: database.id,
    title: databaseTitle(database),
    url: database.url || "",
    existingProperties,
    missingProperties
  };
}

async function buildDictionaryStatus() {
  const config = getConfig();
  const missingConfig = [];
  if (!config.notionApiKey) missingConfig.push("NOTION_API_KEY");
  if (!config.materialsDatabaseId) missingConfig.push("NOTION_MATERIALS_DATABASE_ID");
  if (!config.perfumesDatabaseId) missingConfig.push("NOTION_PERFUMES_DATABASE_ID");

  if (missingConfig.length) {
    return { ok: false, missingConfig };
  }

  const [materialsDatabase, perfumesDatabase] = await Promise.all([
    retrieveDatabase(config.materialsDatabaseId),
    retrieveDatabase(config.perfumesDatabaseId)
  ]);

  return {
    ok: true,
    notionConnected: true,
    materialsDatabase: databaseSummary(materialsDatabase, MATERIAL_PROPERTY_NAMES),
    perfumesDatabase: databaseSummary(perfumesDatabase, PERFUME_PROPERTY_NAMES)
  };
}

function isPropertyEmpty(property) {
  if (!property) return true;
  const value = valueFromProperty(property);
  if (Array.isArray(value)) return value.length === 0;
  return value === "" || value === null || value === undefined;
}

function multiSelectValue(values) {
  return { multi_select: [...new Set(normalizeList(values))].map((name) => ({ name })) };
}

function selectValue(value) {
  return value ? { select: { name: value } } : null;
}

function richTextValue(value) {
  return value ? { rich_text: [{ type: "text", text: { content: String(value) } }] } : null;
}

function relationValue(ids) {
  const relation = [...new Set(normalizeList(ids))].map((id) => ({ id }));
  return relation.length ? { relation } : null;
}

function textForInference(value) {
  return normalizeList(value).join(" ").toLowerCase().normalize("NFKC");
}

function inferTags(text, rules) {
  const normalized = textForInference(text);
  const values = [];
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase().normalize("NFKC")))) {
      values.push(...rule.values);
    }
  }
  return [...new Set(values)];
}

const aromaRules = [
  { keywords: ["ウッディ", "woody", "木", "樹木"], values: ["ウッディ"] },
  { keywords: ["グリーン", "green", "青葉", "草", "葉"], values: ["グリーン"] },
  { keywords: ["シトラス", "citrus", "柑橘", "ゆず", "柚子", "レモン", "みかん"], values: ["シトラス"] },
  { keywords: ["フローラル", "floral", "花", "桜", "梅", "藤", "金木犀"], values: ["フローラル"] },
  { keywords: ["スモーキー", "smoky", "煙", "焦げ", "燻製", "墨"], values: ["スモーキー"] },
  { keywords: ["スパイシー", "spicy", "山椒", "胡椒", "クローブ", "カルダモン"], values: ["スパイシー"] },
  { keywords: ["ハーバル", "herbal", "ハーブ", "薬草", "草本"], values: ["ハーバル"] },
  { keywords: ["茶", "緑茶", "煎茶", "ほうじ茶", "抹茶"], values: ["グリーン", "ハーバル"] },
  { keywords: ["樹脂", "resin", "レジン", "松脂"], values: ["レジン"] }
];

const materialImpressionRules = [
  { keywords: ["和", "日本", "和風", "寺", "神社", "茶室"], values: ["和"] },
  { keywords: ["高級", "上品", "ラグジュアリー"], values: ["高級"] },
  { keywords: ["清潔", "クリーン"], values: ["清潔"] },
  { keywords: ["透明"], values: ["透明感"] },
  { keywords: ["落ち着く", "落ち着き"], values: ["落ち着き"] },
  { keywords: ["静か", "静寂"], values: ["静けさ"] },
  { keywords: ["野性", "野趣"], values: ["野性"] },
  { keywords: ["山", "森", "森林"], values: ["森林"] },
  { keywords: ["温かい", "温かみ", "ぬくもり"], values: ["温かみ"] },
  { keywords: ["余韻", "残る", "記憶"], values: ["余韻"] }
];

const extractionRules = [
  { keywords: ["チンキ", "tincture"], values: ["チンキ"] },
  { keywords: ["水蒸気蒸留", "steam"], values: ["水蒸気蒸留"] },
  { keywords: ["蒸留", "distillation"], values: ["蒸留"] },
  { keywords: ["圧搾", "cold press", "press"], values: ["圧搾"] },
  { keywords: ["溶剤抽出", "solvent"], values: ["溶剤抽出"] },
  { keywords: ["co2", "co₂", "超臨界"], values: ["CO2抽出"] },
  { keywords: ["アンフルラージュ", "enfleurage"], values: ["アンフルラージュ"] },
  { keywords: ["ヘッドスペース", "headspace"], values: ["ヘッドスペース"] }
];

const perfumeImpressionRules = [
  { keywords: ["和", "日本", "和風", "寺", "神社", "茶室"], values: ["和"] },
  { keywords: ["高級", "上品", "ラグジュアリー"], values: ["高級"] },
  { keywords: ["日常", "普段"], values: ["日常"] },
  { keywords: ["夜", "ナイト"], values: ["夜"] },
  { keywords: ["静か", "静寂"], values: ["静けさ"] },
  { keywords: ["清潔", "クリーン"], values: ["清潔"] },
  { keywords: ["透明"], values: ["透明感"] },
  { keywords: ["温かい", "温かみ", "ぬくもり"], values: ["温かみ"] },
  { keywords: ["余韻", "残る", "記憶"], values: ["余韻"] },
  { keywords: ["自然", "森", "森林"], values: ["自然"] },
  { keywords: ["モダン", "現代的"], values: ["モダン"] }
];

function buildMaterialPageUpdate(page) {
  const properties = page.properties || {};
  const updates = {};
  const samples = [];

  if (isPropertyEmpty(properties.aromaTags)) {
    const aromaTags = inferTags(valueFromProperty(pickProperty(properties, materialAliases.aromaProfile)), aromaRules);
    if (aromaTags.length) {
      updates.aromaTags = multiSelectValue(aromaTags);
      samples.push({ property: "aromaTags", values: aromaTags });
    }
  }

  if (isPropertyEmpty(properties.impressionTags)) {
    const impressionTags = inferTags(valueFromProperty(pickProperty(properties, materialAliases.memo)), materialImpressionRules);
    if (impressionTags.length) {
      updates.impressionTags = multiSelectValue(impressionTags);
      samples.push({ property: "impressionTags", values: impressionTags });
    }
  }

  if (isPropertyEmpty(properties.usableExtractionMethods)) {
    const methods = inferTags(valueFromProperty(pickProperty(properties, materialAliases.extractionMethods)), extractionRules);
    if (methods.length) {
      updates.usableExtractionMethods = multiSelectValue(methods);
      samples.push({ property: "usableExtractionMethods", values: methods });
    }
  }

  return { updates, samples };
}

function buildMaterialNameIndex(materialPages) {
  const index = new Map();
  materialPages.forEach((page) => {
    const item = normalizeMaterial(page);
    [item.name, item.japaneseName, item.englishName, item.scientificName]
      .filter(Boolean)
      .forEach((name) => index.set(normalizeKey(name), page.id));
  });
  return index;
}

function buildPerfumePageUpdate(page, materialNameIndex) {
  const properties = page.properties || {};
  const updates = {};
  const samples = [];

  if (isPropertyEmpty(properties.fragranceFamily)) {
    const family = normalizeList(valueFromProperty(pickProperty(properties, ["family", "fragranceType", "type", "category", "香調", "系統"]))).at(0);
    const select = selectValue(family);
    if (select) {
      updates.fragranceFamily = select;
      samples.push({ property: "fragranceFamily", values: [family] });
    }
  }

  for (const [target, aliases] of [
    ["topNotes", ["top", "topNote", "トップ", "トップノート"]],
    ["middleNotes", ["middle", "heart", "middleNote", "ミドル", "ミドルノート"]],
    ["baseNotes", ["base", "last", "baseNote", "ベース", "ラストノート", "ベースノート"]]
  ]) {
    if (isPropertyEmpty(properties[target])) {
      const notes = normalizeList(valueFromProperty(pickProperty(properties, aliases)));
      if (notes.length) {
        updates[target] = multiSelectValue(notes);
        samples.push({ property: target, values: notes.slice(0, 5) });
      }
    }
  }

  if (isPropertyEmpty(properties.impressionTags)) {
    const source = valueFromProperty(pickProperty(properties, ["memo", "concept", "description", "自社コメント", "コメント"]));
    const impressionTags = inferTags(source, perfumeImpressionRules);
    if (impressionTags.length) {
      updates.impressionTags = multiSelectValue(impressionTags);
      samples.push({ property: "impressionTags", values: impressionTags });
    }
  }

  if (isPropertyEmpty(properties.relatedMaterials)) {
    const sourceMaterials = normalizeList(valueFromProperty(pickProperty(properties, ["関連原料", "原料", "Materials", "materials"])));
    const relationIds = sourceMaterials.map((name) => materialNameIndex.get(normalizeKey(name))).filter(Boolean);
    const relation = relationValue(relationIds);
    if (relation) {
      updates.relatedMaterials = relation;
      samples.push({ property: "relatedMaterials", values: relationIds.slice(0, 5) });
    }
  }

  return { updates, samples };
}

async function ensureDatabaseProperties(database, requestedProperties) {
  const addedProperties = [];
  const existingProperties = [];
  const skippedProperties = [];
  const additions = {};

  for (const [name, schema] of Object.entries(requestedProperties)) {
    if (database.properties?.[name]) {
      existingProperties.push(name);
    } else if (schema) {
      additions[name] = schema;
      addedProperties.push(name);
    } else {
      skippedProperties.push(name);
    }
  }

  if (Object.keys(additions).length) {
    await updateDatabase(database.id, additions);
  }

  return { addedProperties, existingProperties, skippedProperties };
}

async function runPageUpdates(pages, buildUpdate) {
  let updatedPages = 0;
  const samples = [];

  for (const page of pages) {
    const { updates, samples: pageSamples } = buildUpdate(page);
    if (!Object.keys(updates).length) continue;
    await updatePage(page.id, updates);
    updatedPages += 1;
    if (samples.length < 5) {
      samples.push({
        id: page.id,
        name: normalizeMaterial(page).name || normalizePerfume(page).name,
        updates: pageSamples
      });
    }
  }

  return { updatedPages, samples };
}

async function upgradeDictionaryDatabases() {
  const config = getConfig();
  if (!config.materialsDatabaseId || !config.perfumesDatabaseId) {
    const error = new Error("Dictionary database ids are not set.");
    error.statusCode = 500;
    throw error;
  }

  const [materialsDatabase, perfumesDatabase] = await Promise.all([
    retrieveDatabase(config.materialsDatabaseId),
    retrieveDatabase(config.perfumesDatabaseId)
  ]);

  const materialRequested = {
    ...materialSchema,
    relatedBatches: config.batchesDatabaseId ? relationProperty(config.batchesDatabaseId) : null
  };
  const perfumeRequested = {
    ...perfumeSchema,
    relatedMaterials: relationProperty(config.materialsDatabaseId)
  };

  const [materialPropertyResult, perfumePropertyResult] = await Promise.all([
    ensureDatabaseProperties(materialsDatabase, materialRequested),
    ensureDatabaseProperties(perfumesDatabase, perfumeRequested)
  ]);

  if (!config.batchesDatabaseId && !materialsDatabase.properties?.relatedBatches) {
    materialPropertyResult.skippedProperties.push("relatedBatches");
    console.log("relatedBatches skipped: batches database id missing");
  }

  const [materialPages, perfumePages] = await Promise.all([
    queryDatabase(config.materialsDatabaseId),
    queryDatabase(config.perfumesDatabaseId)
  ]);
  const materialNameIndex = buildMaterialNameIndex(materialPages);
  const materialUpdateResult = await runPageUpdates(materialPages, buildMaterialPageUpdate);
  const perfumeUpdateResult = await runPageUpdates(perfumePages, (page) => buildPerfumePageUpdate(page, materialNameIndex));

  return {
    ok: true,
    materialsDatabase: {
      id: materialsDatabase.id,
      title: databaseTitle(materialsDatabase),
      url: materialsDatabase.url || "",
      addedProperties: materialPropertyResult.addedProperties,
      existingProperties: materialPropertyResult.existingProperties,
      skippedProperties: [...new Set(materialPropertyResult.skippedProperties)],
      updatedPages: materialUpdateResult.updatedPages,
      samples: materialUpdateResult.samples
    },
    perfumesDatabase: {
      id: perfumesDatabase.id,
      title: databaseTitle(perfumesDatabase),
      url: perfumesDatabase.url || "",
      addedProperties: perfumePropertyResult.addedProperties,
      existingProperties: perfumePropertyResult.existingProperties,
      skippedProperties: perfumePropertyResult.skippedProperties,
      updatedPages: perfumeUpdateResult.updatedPages,
      samples: perfumeUpdateResult.samples
    }
  };
}

async function handleApi(req, res, pathname) {
  try {
    const config = getConfig();

    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        service: "fragrance-api",
        timestamp: new Date().toISOString()
      });
    }

    if (pathname === "/api/admin/notion/dictionary/status" && req.method === "GET") {
      return sendJson(res, 200, await buildDictionaryStatus());
    }

    if (pathname === "/api/admin/notion/dictionary/upgrade" && req.method === "POST") {
      return sendJson(res, 200, await upgradeDictionaryDatabases());
    }

    if (pathname === "/api/dictionary/materials") {
      const pages = await queryDatabase(config.materialsDatabaseId);
      return sendJson(res, 200, pages.map(normalizeMaterial));
    }

    if (pathname.startsWith("/api/dictionary/materials/")) {
      const id = decodeURIComponent(pathname.replace("/api/dictionary/materials/", ""));
      const page = await notionRequest(`/pages/${id}`);
      return sendJson(res, 200, normalizeMaterial(page));
    }

    if (pathname === "/api/dictionary/perfumes") {
      const pages = await queryDatabase(config.perfumesDatabaseId);
      return sendJson(res, 200, pages.map(normalizePerfume));
    }

    if (pathname.startsWith("/api/dictionary/perfumes/")) {
      const id = decodeURIComponent(pathname.replace("/api/dictionary/perfumes/", ""));
      const page = await notionRequest(`/pages/${id}`);
      return sendJson(res, 200, normalizePerfume(page));
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, error.statusCode || 500, { ok: false, error: "取得できませんでした", detail: error.message });
  }
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    return handleApi(req, res, url.pathname);
  }

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Perfume dictionary PWA running at http://localhost:${PORT}`);
});
