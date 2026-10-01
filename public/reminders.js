// Repository compatibility shim. Runtime packages keep these helpers in core.js
// so v1.5.40 clients can verify and install newer signed updates.
export { NEXT_REMINDER_OPTIONS, reminderHasOption, setReminderOption } from './core.js';
