import { getAuthToken } from './calendar.js';

function escapeQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveFetch(path, token, options = {}, isUpload = false) {
  const base = isUpload ? 'https://www.googleapis.com/upload/drive/v3' : 'https://www.googleapis.com/drive/v3';
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API エラー: ${res.status} ${text}`);
  }
  return res.json();
}

async function findFolder(token, name, parentId = '') {
  const q = [
    `name='${escapeQuery(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${escapeQuery(parentId)}' in parents` : ''
  ].filter(Boolean).join(' and ');

  const path = `/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const json = await driveFetch(path, token);
  return (json.files || [])[0] || null;
}

async function createFolder(token, name, parentId = '') {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {})
  };
  return driveFetch('/files?fields=id,name,webViewLink&supportsAllDrives=true', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(metadata)
  });
}

export async function getOrCreateFolder(token, name, parentId = '') {
  const found = await findFolder(token, name, parentId);
  if (found) return found;
  return createFolder(token, name, parentId);
}

export async function ensureBatchPhotoFolder(settings, batchId) {
  const token = await getAuthToken(true);
  const rootName = settings?.driveRootFolderName || '和の香り研究所';
  const parentName = settings?.driveBatchPhotosFolderName || 'batch_photos';

  const root = await getOrCreateFolder(token, rootName);
  const parent = await getOrCreateFolder(token, parentName, root.id);
  const batch = await getOrCreateFolder(token, batchId, parent.id);

  return { token, rootFolder: root, parentFolder: parent, batchFolder: batch };
}

function dataUrlToBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('画像データ形式が不正です');
  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mimeType, bytes };
}

export async function uploadPhotoFile(token, folderId, fileName, mimeType, dataUrl) {
  const parsed = dataUrlToBytes(dataUrl);
  const finalMimeType = mimeType || parsed.mimeType || 'image/jpeg';
  const boundary = `----workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const metadata = {
    name: fileName,
    mimeType: finalMimeType,
    parents: [folderId]
  };

  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${finalMimeType}\r\n\r\n`,
    parsed.bytes,
    `\r\n--${boundary}--`
  ]);

  const json = await driveFetch('/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink&supportsAllDrives=true', token, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  }, true);

  return {
    driveFileId: json.id,
    driveUrl: json.webViewLink || `https://drive.google.com/file/d/${json.id}/view`,
    fileName: json.name || fileName
  };
}
