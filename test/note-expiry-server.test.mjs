import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createService, atomic } from '../server.mjs';
import { makeCertificates } from '../scripts/setup.mjs';
import { newMeta, derive, seal, emptyBundle } from '../public/core.js';

test('HTTPS note-purge compatibility barrier survives restart; old clients cannot read or overwrite, pairing unchanged', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-note-expiry-'));
  makeCertificates(dir, 'fictional-expiry.local');
  const admin = 'fictional-expiry-admin';
  atomic(path.join(dir, 'config.json'), {hostname:'fictional-expiry.local',port:8443,adminToken:admin,devices:[]});
  let service, address;
  const start = async () => { service = createService({dataDir:dir,host:'127.0.0.1',port:0}); address = await service.listen(); };
  const stop = async () => { service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); };
  await start();
  t.after(async () => { await stop(); fs.rmSync(dir,{recursive:true,force:true}); });
  const ca = fs.readFileSync(path.join(dir,'tls','ca.crt'));
  const request = (route, method='GET', body, token, app='1.5.116') => new Promise((resolve,reject) => {
    const headers={Host:`localhost:${address.port}`,Origin:`https://localhost:${address.port}`,'Content-Type':'application/json','X-Pharmacy-Client':'1',...(token?{Authorization:`Bearer ${token}`}:{})};
    if(app!==null)headers['X-Pharmacy-App']=app;
    const req=https.request({host:'127.0.0.1',servername:'localhost',port:address.port,path:route,method,ca,headers},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(s)}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  const code=(await request('/api/admin/code','POST',{},admin)).body.code;
  const device=(await request('/api/pair','POST',{code,label:'fictional phone'})).body;
  const config=fs.readFileSync(path.join(dir,'config.json'));
  const meta=newMeta(), key=await derive('fictional-test-password',meta), envelope=await seal(emptyBundle(meta.vaultId),key,meta);
  // The floor is not activated for ordinary schema-2 saves.
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:0,envelope},device.token,'1.5.115')).status,200);
  assert.equal((await request('/api/snapshot','GET',undefined,device.token,'1.5.115')).status,200);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:1,envelope,minimumAppVersion:'1.5.116'},device.token,'1.5.115')).status,409);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:1,envelope,minimumAppVersion:'1.5.116'},device.token)).status,200);
  const protectedSnapshot=fs.readFileSync(path.join(dir,'snapshot.json'));
  for(const app of [null,'1.5.115','1.4.999','0.9.999','1..116','garbage']) {
    assert.equal((await request('/api/snapshot','GET',undefined,device.token,app)).status,409,String(app));
    assert.equal((await request('/api/snapshot','PUT',{expectedVersion:2,envelope},device.token,app)).status,409,String(app));
  }
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:2,envelope},device.token)).status,409);
  assert.deepEqual(fs.readFileSync(path.join(dir,'snapshot.json')),protectedSnapshot);
  for(const app of ['1.5.116','1.5.117','1.6.0','2.0.0'])assert.equal((await request('/api/snapshot','GET',undefined,device.token,app)).status,200);
  await stop();await start();
  assert.equal((await request('/api/snapshot','GET',undefined,device.token,'1.5.115')).status,409);
  assert.equal((await request('/api/version','GET',undefined,device.token,'1.5.115')).status,200);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:2,envelope,minimumAppVersion:'1.5.116'},device.token)).status,200);
  assert.deepEqual(fs.readFileSync(path.join(dir,'config.json')),config);
});
