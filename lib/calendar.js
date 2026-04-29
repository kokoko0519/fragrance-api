function ymdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(token);
    });
  });
}

async function gapiFetch(path, token, options = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API エラー: ${res.status} ${text}`);
  }
  return res.json();
}

export async function listCalendars(_token) {
  return [{ id: 'primary', summary: 'primary' }];
}

function toCalendarEvent(batch, event) {
  const startDate = new Date(event.startDateTime);
  const endDate = new Date(event.endDateTime);

  const start = ymdLocal(startDate);
  const endExclusive = event.eventType === 'duration'
    ? ymdLocal(addDays(endDate, 1))
    : ymdLocal(addDays(startDate, 1));
  const isPointEvent = event.eventType !== 'duration';

  return {
    summary: `[${batch.batchId}] ${event.name}`,
    description: [
      `バッチ: ${batch.displayLabel}`,
      `工程: ${event.name}`,
      `種別: ${event.eventType === 'duration' ? '期間' : '時点'}`,
      `予定日: ${start}`,
      `手順: ${event.procedure || '-'}`,
      `チェック: ${(event.checkpoints || []).join(' / ') || '-'}`,
      `担当: ${batch.operator || '-'}`,
      `メモ: ${batch.memo || '-'}`
    ].join('\n'),
    ...(isPointEvent
      ? {
          start: { dateTime: startDate.toISOString() },
          end: { dateTime: endDate.toISOString() }
        }
      : {
          start: { date: start },
          end: { date: endExclusive }
        })
  };
}

export async function insertEvents(token, calendarId, batch, events, _pointMinutes = 5) {
  const inserted = [];
  for (const event of events) {
    const payload = toCalendarEvent(batch, event);
    const json = await gapiFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, token, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    inserted.push({ localEventId: event.localEventId, googleEventId: json.id, htmlLink: json.htmlLink, calendarId });
  }
  return inserted;
}

export async function deleteEvents(token, defaultCalendarId, mappedEvents = []) {
  const deleted = [];
  for (const event of mappedEvents || []) {
    if (!event?.googleEventId) continue;
    const calendarId = event.calendarId || defaultCalendarId || 'primary';
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.googleEventId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }).then(async (res) => {
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        throw new Error(`Google API エラー: ${res.status} ${text}`);
      }
    });
    deleted.push(event.googleEventId);
  }
  return deleted;
}
