import { getComparisonGroups, getMethodById, getPreset, getStorageProfile, loadTemplates } from './templates.js';

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseRatio(ratioText) {
  const m = String(ratioText || '').trim().match(/^\s*1\s*:\s*([0-9]*\.?[0-9]+)\s*$/);
  if (!m) return null;
  return toNumber(m[1]);
}

export function materialToBaseAmount(amount, unit) {
  const n = toNumber(amount);
  if (unit === 'kg' || unit === 'L') return n * 1000;
  return n;
}

export function computeSolventMl(materialAmount, materialUnit, ratioText) {
  const ratio = parseRatio(ratioText);
  if (!ratio) return 0;
  const base = materialToBaseAmount(materialAmount, materialUnit);
  return Math.round(base * ratio * 10) / 10;
}

export function deriveAutoRatio(materialAmount, materialUnit, waterAmount, waterUnit) {
  const materialBase = materialToBaseAmount(materialAmount, materialUnit);
  const waterBase = materialToBaseAmount(waterAmount, waterUnit);
  if (!materialBase || !waterBase) return '';
  const x = Math.round((waterBase / materialBase) * 100) / 100;
  if (!Number.isFinite(x) || x <= 0) return '';
  return `1:${x}`;
}

export function displayVolume(ml) {
  const n = toNumber(ml);
  if (n >= 1000) {
    return { value: Math.round((n / 1000) * 100) / 100, unit: 'L' };
  }
  return { value: Math.round(n * 10) / 10, unit: 'ml' };
}

export function snapTo30Minutes(datetimeLocal) {
  if (!datetimeLocal) return '';
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) return '';
  const ms = 30 * 60000;
  const snapped = new Date(Math.round(d.getTime() / ms) * ms);
  const offset = snapped.getTimezoneOffset();
  const local = new Date(snapped.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function stepEvent(baseDate, step, durationMinutes) {
  const start = new Date(baseDate.getTime() + step.offsetMinutes * 60000);
  const end = step.eventType === 'duration'
    ? new Date(start.getTime() + durationMinutes * 60000)
    : new Date(start.getTime() + 5 * 60000);

  const toArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));

  return {
    localEventId: `${step.stepId}:${start.getTime()}`,
    stepId: step.stepId,
    name: step.name || step.title || step.stepId,
    title: step.title || step.name || step.stepId,
    stepType: step.stepType || '',
    eventType: step.eventType,
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    procedure: step.procedure,
    stepDescription: step.stepDescription || '',
    instructions: toArray(step.instructions),
    checkpoints: toArray(step.checkpoints),
    normalSigns: toArray(step.normalSigns),
    abnormalSigns: toArray(step.abnormalSigns),
    cautionNotes: toArray(step.cautionNotes),
    completionCriteria: toArray(step.completionCriteria),
    requiredLogs: toArray(step.requiredLogs),
    optionalLogs: toArray(step.optionalLogs),
    requiredPhotoTypes: toArray(step.requiredPhotoTypes),
    optionalPhotoTypes: toArray(step.optionalPhotoTypes),
    abnormalityOptions: toArray(step.abnormalityOptions),
    completed: false
  };
}

function expandPeriodicEvents(baseDate, durationMinutes, preset) {
  const events = [];
  const durationDays = Math.floor(durationMinutes / 1440);
  const rules = [
    {
      key: 'checkFrequency',
      name: '確認',
      minutes: 1,
      procedure: '抽出状態を確認',
      stepType: 'check',
      stepDescription: '抽出中の状態変化を定点で確認する工程です。',
      instructions: ['容器ラベルを確認する', '色・香り・温度を確認する', '異常有無を記録する'],
      checkpoints: ['色', '香り', '温度', '異常有無'],
      normalSigns: ['急な白濁なし', '強い異臭なし'],
      abnormalSigns: ['急な白濁', '強い異臭', '温度逸脱'],
      cautionNotes: ['毎回同じ条件で確認する'],
      completionCriteria: ['観察項目が記録済み'],
      requiredLogs: ['実施時刻', '実施者', '色', '香り', '温度', '異常有無'],
      optionalLogs: ['異常種別'],
      abnormalityOptions: ['異臭', '白濁', '分離', '液漏れ', '変色', '温度異常', '沈殿過多', 'その他']
    },
    {
      key: 'stirFrequency',
      name: '攪拌',
      minutes: 5,
      procedure: '容器を攪拌または瓶を混ぜる',
      stepType: 'stir_mix',
      stepDescription: '抽出ムラを抑えるための攪拌工程です。',
      instructions: ['密閉状態を確認する', '瓶をゆっくり反転する', '液状態と香りを確認する'],
      checkpoints: ['攪拌実施有無', '液の状態', '香りの印象', '異常有無'],
      normalSigns: ['液漏れなし', '強い異臭なし'],
      abnormalSigns: ['白濁', '液漏れ', '異臭'],
      cautionNotes: ['強く振らない'],
      completionCriteria: ['攪拌記録が入力済み'],
      requiredLogs: ['実施時刻', '実施者', '攪拌実施有無', '液の状態', '香りの印象', '異常有無'],
      optionalLogs: ['異常種別'],
      abnormalityOptions: ['異臭', '白濁', '液漏れ', '分離', 'その他']
    }
  ];

  for (const rule of rules) {
    const freq = preset[rule.key];
    if (!freq || freq.unit !== 'day' || !freq.every) continue;
    for (let d = freq.every; d < durationDays; d += freq.every) {
      const start = new Date(baseDate.getTime() + d * 24 * 60 * 60000);
      events.push({
        localEventId: `${rule.key}:${start.getTime()}`,
        stepId: `${rule.key}_${d}`,
        name: rule.name,
        title: rule.name,
        stepType: rule.stepType,
        eventType: 'point',
        startDateTime: start.toISOString(),
        endDateTime: new Date(start.getTime() + rule.minutes * 60000).toISOString(),
        procedure: rule.procedure,
        checkpoints: rule.checkpoints,
        stepDescription: rule.stepDescription,
        instructions: rule.instructions,
        normalSigns: rule.normalSigns,
        abnormalSigns: rule.abnormalSigns,
        cautionNotes: rule.cautionNotes,
        completionCriteria: rule.completionCriteria,
        requiredLogs: rule.requiredLogs,
        optionalLogs: rule.optionalLogs,
        requiredPhotoTypes: rule.requiredPhotoTypes || [],
        optionalPhotoTypes: rule.optionalPhotoTypes || [],
        abnormalityOptions: rule.abnormalityOptions,
        completed: false
      });
    }
  }

  if (durationDays >= 2) {
    const mid = new Date(baseDate.getTime() + Math.floor(durationMinutes / 2) * 60000);
    events.push({
      localEventId: `mid_eval:${mid.getTime()}`,
      stepId: 'mid_eval',
      name: '中間評価',
      title: '中間評価',
      stepType: 'mid_evaluation',
      eventType: 'point',
      startDateTime: mid.toISOString(),
      endDateTime: new Date(mid.getTime() + 5 * 60000).toISOString(),
      procedure: '中間時点の香りと外観を評価',
      checkpoints: ['香り', '色', '沈殿'],
      stepDescription: '完成前の品質傾向を確認し、次工程の判断材料を作る工程です。',
      instructions: ['香り・色・透明度を確認する', '異常有無を判断する', '次回注意点を記録する'],
      normalSigns: ['香りの厚みが増加', '急な白濁なし'],
      abnormalSigns: ['香り劣化', '急な白濁', '強い分離'],
      cautionNotes: ['同じ評価条件で比較する'],
      completionCriteria: ['評価項目が記録済み'],
      requiredLogs: ['実施時刻', '実施者', '香り評価', '色', '透明度', '異常有無'],
      optionalLogs: ['異常種別'],
      abnormalityOptions: ['異臭', '白濁', '分離', '液漏れ', '変色', '温度異常', '沈殿過多', 'その他'],
      completed: false
    });
  }

  return events;
}

export async function generateProcessEvents(input) {
  const method = await getMethodById(input.methodId);
  const preset = await getPreset(input.methodId, input.selectedPresetId);
  if (!method || !preset || !input.selectedStartDateTime) return [];

  const baseDate = new Date(input.selectedStartDateTime);
  const durationMinutes = preset.durationRule?.value || method.defaultDurationMinutes;

  const events = preset.steps.map((step) => stepEvent(baseDate, step, durationMinutes));

  const periodic = expandPeriodicEvents(baseDate, durationMinutes, preset);
  const merged = [...events, ...periodic].map((event) => ({
    ...event,
    requiredLogs: (event.requiredLogs && event.requiredLogs.length) ? event.requiredLogs : (method.requiredLogs || []),
    optionalLogs: event.optionalLogs || [],
    requiredPhotoTypes: event.requiredPhotoTypes || [],
    optionalPhotoTypes: event.optionalPhotoTypes || [],
    instructions: event.instructions || [],
    normalSigns: event.normalSigns || [],
    abnormalSigns: event.abnormalSigns || [],
    cautionNotes: event.cautionNotes || [],
    completionCriteria: event.completionCriteria || []
  }));

  return merged.sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
}

function pad(num, len = 3) {
  return String(num).padStart(len, '0');
}

function compactToken(v, len = 10) {
  const token = String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return token.slice(0, len) || 'NA';
}

export function inferMaterialCode(materialName, materials, defaultCode = 'MAT') {
  const m = materials.find((x) => x.materialName === materialName || (x.aliases || []).includes(materialName));
  return m?.materialCode || defaultCode;
}

export async function generateBatchId(input, existingBatches) {
  const templates = await loadTemplates();
  const materialCode = inferMaterialCode(input.materialName, templates.materials.materials, templates.codes.defaultMaterialCode);
  const methodCode = templates.codes.methodCodes[input.methodId] || 'EXT';
  const prefix = `${materialCode}-${methodCode}-`;

  let maxSeq = 0;
  existingBatches.forEach((batch) => {
    if (!batch.batchId || !batch.batchId.startsWith(prefix)) return;
    const n = Number(batch.batchId.slice(prefix.length));
    if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
  });

  const seq = maxSeq + 1;
  return {
    batchId: `${prefix}${pad(seq)}`,
    displayLabel: `${input.materialName} ${input.methodName || input.methodId} ${pad(seq)}`
  };
}

export function generateCompareGroupId(input) {
  if (input.compareGroupId && input.compareGroupId.trim()) return input.compareGroupId.trim();
  const d = new Date(input.selectedStartDateTime || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const methodToken = compactToken(input.methodId || 'EXT', 6);
  return `CMP-${y}${m}${day}-${methodToken}`;
}

function resolveSolventCode(solventName, templates) {
  if (!solventName) return 'NON';
  const found = (templates.solvents?.solvents || []).find((s) => s.solventName === solventName);
  if (!found) return compactToken(solventName, 4);
  return compactToken((found.solventId || '').replaceAll('_', ''), 4);
}

function buildComparisonMeta(input, method, storage, durationMinutes, templates, comparisonGroup) {
  const materialGroup = String(input.materialGroup || input.materialName || '').trim();
  const methodGroup = String(input.methodGroup || method.methodName || '').trim();
  const storageProfile = `${storage.storageTemperature || ''}/${storage.storageLocation || ''}/${storage.containerType || ''}`;
  const durationDays = Math.max(1, Math.round((durationMinutes || 0) / 1440));
  const solventCode = resolveSolventCode(input.solventName, templates);

  const fallbackGroupId = `${compactToken(materialGroup, 8)}_${compactToken(method.methodId, 6)}_${solventCode}_${durationDays}D`;
  const comparisonGroupId = String(
    input.comparisonGroupId || input.compareGroupId || comparisonGroup?.comparisonGroupId || fallbackGroupId
  ).trim();
  const comparisonGroupName = String(input.comparisonGroupName || comparisonGroup?.comparisonGroupName || '').trim();

  const compareKey = [
    `MAT:${compactToken(materialGroup, 12)}`,
    `MTH:${compactToken(methodGroup, 8)}`,
    `PRE:${compactToken(input.selectedPresetId, 12)}`,
    `SOL:${compactToken(input.solventName || 'NONE', 10)}`,
    `RAT:${compactToken(input.ratio || 'NONE', 8)}`,
    `STG:${compactToken(storageProfile, 18)}`,
    `GRP:${compactToken(comparisonGroupId, 14)}`,
    `DUR:${durationDays}D`
  ].join('|');

  return {
    comparisonGroupId,
    comparisonGroupName,
    materialGroup,
    methodGroup,
    storageProfile,
    compareKey,
    comparisonKey: compareKey
  };
}

export async function resolveStorage(input) {
  const preset = await getPreset(input.methodId, input.selectedPresetId);
  const profile = await getStorageProfile(preset?.defaultStorageProfile);
  return {
    storageTemperature: input.storageTemperature || profile?.storageTemperature || '常温',
    storageLocation: input.storageLocation || profile?.storageLocation || '',
    containerType: input.containerType || profile?.containerType || '',
    lightShielded: typeof input.lightShielded === 'boolean' ? input.lightShielded : Boolean(profile?.lightShielded),
    sealedState: input.sealedState || profile?.sealedState || '密閉',
    storageMemo: input.storageMemo || profile?.storageMemo || ''
  };
}

export async function buildWarnings(input) {
  const warnings = [];
  if (!input.materialName) warnings.push('原料名が未入力です');
  if (!input.materialAmount) warnings.push('原料量が未入力です');
  if (!input.selectedPresetId) warnings.push('条件プリセットが未選択です');
  if (!input.selectedStartDateTime) warnings.push('開始予定日時が未入力です');

  const method = await getMethodById(input.methodId);
  const ratio = parseRatio(input.ratio);
  if (method?.usesSolvent) {
    if (!input.ratio) warnings.push('比率が未入力です');
    if (!input.solventName) warnings.push('溶媒が未選択です');
    if (!ratio) warnings.push('比率は1:x形式で入力してください');
  }
  if (method?.usesWater && !input.waterAmount) {
    warnings.push('水蒸気蒸留なのに水量が未入力です');
  }

  if (method?.usesSolvent && ratio && input.materialAmount) {
    const amount = materialToBaseAmount(input.materialAmount, input.materialUnit);
    const solventMl = computeSolventMl(input.materialAmount, input.materialUnit, input.ratio);
    if (solventMl < amount * 2) warnings.push('原料量に対して溶媒量が少なすぎる可能性があります');
    if (solventMl > amount * 30) warnings.push('原料量に対して溶媒量が多すぎる可能性があります');
  }

  return warnings;
}

export function buildConfirmationSummary(batch, events) {
  const mainDuration = events.find((e) => e.eventType === 'duration');
  const pointCount = events.filter((e) => e.eventType === 'point').length;

  return {
    比較グループ: `${batch.comparisonGroupName || '-'} (${batch.comparisonGroupId || '-'})`,
    比較キー: batch.compareKey || '-',
    抽出方法: batch.methodName,
    条件プリセット: batch.presetName || batch.selectedPresetId,
    原料名: batch.materialName,
    原料補足: batch.materialSupplement || '-',
    原料量: `${batch.materialAmount}${batch.materialUnit}`,
    比率: batch.ratio || '-',
    溶媒名: batch.solventName || '-',
    自動計算された溶媒量: batch.solventName ? `${batch.solventAmount}${batch.solventDisplayUnit}` : '-',
    水量: batch.waterAmount ? `${batch.waterAmount}${batch.waterUnit}` : '-',
    開始予定日時: batch.selectedStartDateTime,
    抽出本体期間: mainDuration ? `${mainDuration.startDateTime} 〜 ${mainDuration.endDateTime}` : '-',
    生成される中間イベント数: pointCount,
    保存条件: `${batch.storageTemperature} / ${batch.storageLocation} / ${batch.containerType}`,
    担当者: batch.operator || '-',
    warnings: (batch.warnings || []).join(' / ') || 'なし'
  };
}

export async function buildBatchPayload(input, existingBatches) {
  const method = await getMethodById(input.methodId);
  if (!method) throw new Error('抽出方法が不正です');
  const templates = await loadTemplates();
  const preset = await getPreset(input.methodId, input.selectedPresetId);

  const groups = await getComparisonGroups({
    materialName: input.materialName || '',
    methodName: method.methodName,
    methodId: input.methodId
  });
  const comparisonGroup = groups.find((g) => g.comparisonGroupId === (input.comparisonGroupId || input.compareGroupId))
    || (await getComparisonGroups()).find((g) => g.comparisonGroupId === (input.comparisonGroupId || input.compareGroupId))
    || null;

  const ratioForBatch = method.usesWater
    ? (deriveAutoRatio(input.materialAmount, input.materialUnit, input.waterAmount, input.waterUnit) || input.ratio || '')
    : (input.ratio || '');
  const solventMl = computeSolventMl(input.materialAmount, input.materialUnit, ratioForBatch);
  const solventDisplay = displayVolume(solventMl);
  const warnings = await buildWarnings(input);
  const events = await generateProcessEvents(input);
  const mainDurationEvent = events.find((e) => e.eventType === 'duration') || null;
  const ids = await generateBatchId({ ...input, methodName: method.methodName }, existingBatches);
  const storage = await resolveStorage(input);
  const durationMinutes = (mainDurationEvent?.endDateTime && mainDurationEvent?.startDateTime)
    ? Math.round((new Date(mainDurationEvent.endDateTime) - new Date(mainDurationEvent.startDateTime)) / 60000)
    : 0;
  const comparisonMeta = buildComparisonMeta(input, method, storage, durationMinutes, templates, comparisonGroup);

  const batch = {
    ...ids,
    compareGroupId: comparisonMeta.comparisonGroupId || generateCompareGroupId(input),
    comparisonGroupId: comparisonMeta.comparisonGroupId || generateCompareGroupId(input),
    comparisonGroupName: comparisonMeta.comparisonGroupName || '',
    compareKey: comparisonMeta.compareKey,
    comparisonKey: comparisonMeta.comparisonKey,
    materialGroup: comparisonMeta.materialGroup,
    methodGroup: comparisonMeta.methodGroup,
    methodId: input.methodId,
    methodName: method.methodName,
    materialName: input.materialName || '',
    materialSupplement: input.materialSupplement || '',
    materialAmount: toNumber(input.materialAmount),
    materialUnit: input.materialUnit || 'g',
    waterAmount: toNumber(input.waterAmount),
    waterUnit: input.waterUnit || 'ml',
    solventName: input.solventName || '',
    solventAmount: solventDisplay.value,
    solventDisplayUnit: solventDisplay.unit,
    ratio: ratioForBatch,
    selectedPresetId: input.selectedPresetId || '',
    presetName: preset?.presetName || input.selectedPresetId || '',
    autoCalculatedExtractionDuration: durationMinutes,
    warnings,
    generatedEventCount: events.length,
    selectedStartDateTime: input.selectedStartDateTime,
    storageTemperature: storage.storageTemperature,
    storageLocation: storage.storageLocation,
    containerType: storage.containerType,
    lightShielded: storage.lightShielded,
    sealedState: storage.sealedState,
    storageMemo: storage.storageMemo,
    storageProfile: comparisonMeta.storageProfile,
    operator: input.operator || '',
    memo: input.memo || '',
    workCount: input.workCount || 0,
    workDays: input.workDays || 0,
    finalYield: input.finalYield || '',
    finalAroma: input.finalAroma || '',
    finalEvaluation: input.finalEvaluation || '',
    overallRating: input.overallRating || '',
    luxuryFeel: input.luxuryFeel || '',
    worldFit: input.worldFit || '',
    memorability: input.memorability || '',
    reproducibilityEstimate: input.reproducibilityEstimate || '',
    commercialPotential: input.commercialPotential || '',
    brandCandidate: input.brandCandidate || '',
    seriesCandidate: input.seriesCandidate || '',
    productCandidate: input.productCandidate || '',
    fitScore: input.fitScore || '',
    fitMemo: input.fitMemo || '',
    commercialDirection: input.commercialDirection || '',
    nextImprovement: input.nextImprovement || '',
    finalScore: input.finalScore || '',
    resultSummary: input.resultSummary || '',
    status: input.status || '進行中',
    endDateTime: mainDurationEvent?.endDateTime || '',
    events,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return batch;
}

export function getMissingRequiredLogs(requiredLogs, logRecord) {
  if (!requiredLogs || !requiredLogs.length) return [];
  if (!logRecord) return [...requiredLogs];
  return requiredLogs.filter((field) => {
    const v = logRecord[field];
    return v === undefined || v === null || String(v).trim() === '';
  });
}

export function canCompleteStep(requiredLogs, logRecord) {
  if (!requiredLogs || !requiredLogs.length) return true;
  if (!logRecord) return false;
  return getMissingRequiredLogs(requiredLogs, logRecord).length === 0;
}
