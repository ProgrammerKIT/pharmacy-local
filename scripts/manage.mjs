import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultDataDir } from '../server.mjs';
try { const config = JSON.parse(fs.readFileSync(path.join(defaultDataDir(), 'config.json'), 'utf8')); execFileSync('/usr/bin/open', [`https://localhost:${config.port}/admin#${config.adminToken}`]); }
catch { console.error('請先完成 01-Setup，並執行 02-Start。'); process.exitCode = 1; }
