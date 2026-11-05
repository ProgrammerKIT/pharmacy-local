// Owner-side local queue helper, never a network/AI client. Private contents
// may only be read by the explicitly authorized Codex scheduled task.
import fs from 'node:fs';
import {createPeopleBatch} from '../server.mjs';
const batch=createPeopleBatch();
const [command,arg]=process.argv.slice(2);
if(command==='claim')console.log(JSON.stringify(batch.claim()));
else if(command==='submit')console.log(JSON.stringify(batch.submit(JSON.parse(fs.readFileSync(arg,'utf8')))));
else if(command==='enable')console.log(JSON.stringify(batch.configure(true,arg)));
else if(command==='disable')console.log(JSON.stringify(batch.configure(false)));
else if(command==='retry')console.log(JSON.stringify(batch.retry()));
else throw Error('Only claim, submit, enable, disable and retry are supported.');
