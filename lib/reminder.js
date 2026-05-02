const ALARM_PREFIX = 'extract-reminder:';

function alarmName(localEventId) {
  return `${ALARM_PREFIX}${localEventId}`;
}

export async function scheduleEventAlarms(events, leadMinutes = 10) {
  for (const event of events) {
    if (event.eventType !== 'point' || event.completed) continue;
    const when = new Date(event.startDateTime).getTime() - leadMinutes * 60000;
    if (when <= Date.now()) continue;
    chrome.alarms.create(alarmName(event.localEventId), { when });
  }
}

export async function restoreAlarmsFromPending(pendingEvents, leadMinutes = 10) {
  await chrome.alarms.clearAll();
  await scheduleEventAlarms(pendingEvents, leadMinutes);
}

export function parseAlarm(alarm) {
  if (!alarm || !alarm.name || !alarm.name.startsWith(ALARM_PREFIX)) return null;
  return alarm.name.replace(ALARM_PREFIX, '');
}

export async function notifyPending(event) {
  chrome.notifications.create(`pending:${event.localEventId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon128.png'),
    title: '未完了工程の通知',
    message: `${event.batchId} ${event.name} が未完了です。処理を確認してください。`,
    priority: 2
  });
}

