export function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function parseRatioValue(text) {
  const m = String(text || '').trim().match(/^\s*1\s*:\s*([0-9]*\.?[0-9]+)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function scoreRatio(inputRatio, targetRatio) {
  const a = parseRatioValue(inputRatio);
  const b = parseRatioValue(targetRatio);
  if (!a || !b) return 0;
  const diff = Math.abs(a - b);
  if (diff === 0) return 10;
  if (diff <= 0.5) return 8;
  if (diff <= 1.0) return 6;
  if (diff <= 2.0) return 3;
  return 0;
}

function storageSignature(data) {
  return [
    data.storageTemperature,
    data.storageLocation,
    data.containerType,
    String(data.lightShielded),
    data.sealedState
  ].map(normalizeText).join('|');
}

function scoreStorage(input, batch) {
  const inSig = storageSignature(input);
  const bSig = storageSignature(batch);
  if (inSig && bSig && inSig === bSig) return 10;
  let score = 0;
  if (normalizeText(input.storageTemperature) && normalizeText(input.storageTemperature) === normalizeText(batch.storageTemperature)) score += 4;
  if (normalizeText(input.storageLocation) && normalizeText(input.storageLocation) === normalizeText(batch.storageLocation)) score += 3;
  if (normalizeText(input.containerType) && normalizeText(input.containerType) === normalizeText(batch.containerType)) score += 3;
  return score;
}

export function similarityScore(input, batch) {
  const sameMaterial = normalizeText(input.materialName) && normalizeText(input.materialName) === normalizeText(batch.materialName);
  const inputMethod = normalizeText(input.methodId || input.methodName);
  const batchMethod = normalizeText(batch.methodId || batch.methodName);
  const sameMethod = inputMethod && inputMethod === batchMethod;
  const sameSolvent = normalizeText(input.solventName) && normalizeText(input.solventName) === normalizeText(batch.solventName);
  const sameComparisonGroup = normalizeText(input.comparisonGroupId || input.compareGroupId)
    && normalizeText(input.comparisonGroupId || input.compareGroupId) === normalizeText(batch.comparisonGroupId || batch.compareGroupId);

  let score = 0;
  if (sameMaterial) score += 35;
  if (sameMethod) score += 20;
  if (sameSolvent) score += 15;
  score += scoreRatio(input.ratio, batch.ratio);
  score += scoreStorage(input, batch);
  if (sameComparisonGroup) score += 10;
  return Math.min(100, score);
}

export function findSimilarBatches(input, batches, limit = 5) {
  return batches
    .map((batch) => ({ batch, score: similarityScore(input, batch) }))
    .filter((item) => item.score >= 30)
    .sort((a, b) => b.score - a.score || (new Date(b.batch.selectedStartDateTime) - new Date(a.batch.selectedStartDateTime)))
    .slice(0, limit)
    .map((item) => ({
      ...item.batch,
      similarityScore: item.score,
      isNearDuplicate: item.score >= 88
    }));
}

function scoreCompletionField(left, right, weight) {
  if (!normalizeText(left) || !normalizeText(right)) return 0;
  return normalizeText(left) === normalizeText(right) ? weight : 0;
}

export function completedSimilarityScore(base, candidate) {
  let score = similarityScore(base, candidate);
  score += scoreCompletionField(base.finalAroma, candidate.finalAroma, 10);
  score += scoreCompletionField(base.overallRating || base.finalEvaluation, candidate.overallRating || candidate.finalEvaluation, 8);
  score += scoreCompletionField(base.fitScore, candidate.fitScore, 6);
  score += scoreCompletionField(base.commercialDirection, candidate.commercialDirection, 6);
  score += scoreCompletionField(base.seriesCandidate, candidate.seriesCandidate, 5);
  return Math.min(100, score);
}

export function findSimilarCompletedBatches(base, completedBatches, limit = 8) {
  return (completedBatches || [])
    .filter((b) => b.status === '完了' && b.batchId !== base.batchId)
    .map((batch) => ({ batch, score: completedSimilarityScore(base, batch) }))
    .filter((item) => item.score >= 40)
    .sort((a, b) => b.score - a.score || (new Date(b.batch.completedAt || b.batch.updatedAt || 0) - new Date(a.batch.completedAt || a.batch.updatedAt || 0)))
    .slice(0, limit)
    .map((item) => ({
      ...item.batch,
      similarityScore: item.score,
      isNearCompleted: item.score >= 85
    }));
}
