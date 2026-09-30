export const NEXT_REMINDER_OPTIONS = Object.freeze(['HAUD', 'Complete', '陳列盒（中）', '陳列盒（小）']);

function reminderItem(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

export function reminderHasOption(value, option) {
  const item = reminderItem(option);
  return !!item && String(value ?? '').split(/\r\n|\n|\r/).some(line => line.trim() === item);
}

export function setReminderOption(value, option, selected) {
  const source = String(value ?? ''), item = reminderItem(option);
  if (!item) return source;
  if (selected) {
    if (reminderHasOption(source, item)) return source;
    if (!source) return item;
    return source + (/[\r\n]$/.test(source) ? '' : source.includes('\r\n') ? '\r\n' : '\n') + item;
  }
  if (!reminderHasOption(source, item)) return source;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.split(/\r\n|\n|\r/).filter(line => line.trim() !== item).join(newline);
}
