// Pure parser for the actual transition rows emitted by `pmset -g log`.
// Keep only timestamps and transition kinds; never retain wake reasons,
// process names, device identifiers or unrelated power-management records.
export function parseMacPowerEvents(log, startedAt) {
  if (typeof log !== 'string') throw new TypeError('Power log must be a string');
  if (!Number.isFinite(startedAt)) throw new TypeError('Start time must be a finite epoch timestamp');
  const events = [];
  for (const line of log.split(/\r?\n/)) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})\s+(Sleep|DarkWake|Wake)\s+(.*)$/);
    if (!match) continue;
    const [, date, time, offset, kind, body] = match;
    const transition =
      (kind === 'Sleep' && /^Entering Sleep state(?:\s|$)/.test(body)) ||
      (kind === 'DarkWake' && /^DarkWake from\s/.test(body)) ||
      (kind === 'Wake' && /^(?:Wake from\s|DarkWake to FullWake(?:\s|$))/.test(body));
    // In particular, the category "Wake Requests" matches "Wake" above, but
    // its body begins with "Requests" and is not evidence of a resumed Mac.
    if (!transition) continue;
    const local = `${date}T${time}`;
    const at = Date.parse(`${local}${offset.slice(0, 3)}:${offset.slice(3)}`);
    if (!Number.isFinite(at) || at < startedAt) continue;
    const offsetMinutes = (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3))) * (offset[0] === '-' ? -1 : 1);
    // Date.parse normalizes some invalid calendar dates. Do not turn a
    // malformed log row into acceptance evidence by silently normalizing it.
    if (new Date(at + offsetMinutes * 60000).toISOString().slice(0, 19) !== local) continue;
    events.push({ kind, at, iso: new Date(at).toISOString() });
  }
  return events;
}
