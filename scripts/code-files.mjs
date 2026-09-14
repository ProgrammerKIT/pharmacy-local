import { RUNTIME_FILES } from '../update/package.mjs';
// Positive allowlist; never publish a recursive copy of the working directory.
export const CODE_FILES = [...RUNTIME_FILES,
  'supervisor.mjs', 'update/package.mjs', 'update/download.mjs', 'update/engine.mjs',
  'scripts/code-files.mjs', 'scripts/release.mjs', 'scripts/configure-updates.mjs',
  'scripts/upgrade.mjs', 'scripts/autostart.mjs', 'scripts/manage.mjs',
  '01-Setup.command', '02-Start.command', '03-Manage.command', '04-Backup-Folder.command',
  '05-Enable-Autostart.command', '06-Disable-Autostart.command',
  '07-Upgrade-v1.4.command', '08-Configure-Updates.command',
  'README.md', 'UPDATE-GUIDE.txt', 'SECURITY.md', 'TEST-RESULTS.txt',
  'test/core.test.mjs', 'test/csv.test.mjs', 'test/relations.test.mjs', 'test/server.test.mjs',
  'test/update.test.mjs', 'test/worker.test.mjs', 'test/supervisor.test.mjs', 'test/sync-time.test.mjs',
  'test/connection.test.mjs', 'test/update-client.test.mjs', 'test/autostart-status.test.mjs',
  '.gitignore', '.github/workflows/release.yml',
];
