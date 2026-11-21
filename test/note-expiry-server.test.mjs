import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createService, atomic } from '../server.mjs';
import { makeCertificates } from '../scripts/setup.mjs';
import { newMeta, derive, seal, unseal, emptyBundle, MAX_BYTES, MAX_BACKUP_FILE_BYTES, exceedsLegacyCapacity, checkEnvelope } from '../public/core.js';

test('HTTPS compatibility barriers for note expiry and expanded snapshots survive restart and preserve pairing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-note-expiry-'));
  makeCertificates(dir, 'fictional-expiry.local');
  const admin = 'fictional-expiry-admin';
  atomic(path.join(dir, 'config.json'), {hostname:'fictional-expiry.local',port:8443,adminToken:admin,devices:[]});
  let service, address;
  const start = async () => { service = createService({dataDir:dir,host:'127.0.0.1',port:0,updateCommand:()=>{}}); address = await service.listen(); };
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
  for(const app of ['1.5.116','1.5.118','1.6.0','2.0.0'])assert.equal((await request('/api/snapshot','GET',undefined,device.token,app)).status,200);
  await stop();await start();
  assert.equal((await request('/api/snapshot','GET',undefined,device.token,'1.5.115')).status,409);
  assert.equal((await request('/api/version','GET',undefined,device.token,'1.5.115')).status,200);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:2,envelope,minimumAppVersion:'1.5.116'},device.token)).status,200);
  assert.deepEqual(fs.readFileSync(path.join(dir,'config.json')),config);
  const full = { marker: 'x'.repeat(MAX_BYTES - JSON.stringify({marker:''}).length) };
  const large = await seal(full, key, meta);
  assert.equal(checkEnvelope(large), large);
  assert.equal(exceedsLegacyCapacity(large), true);
  assert.ok(Buffer.byteLength(JSON.stringify({format:'pharmacy-backup-1',envelope:large})) < MAX_BACKUP_FILE_BYTES);
  await assert.rejects(seal({...full, extra:true}, key, meta), /容量上限/);
  const oldLocal = { bundle:full, draft:'local-only' };
  const deviceEnvelope = await seal(oldLocal, key, meta, 'device');
  assert.throws(() => checkEnvelope(deviceEnvelope), /超過支援大小/);
  assert.deepEqual(await unseal(deviceEnvelope, key, 'device'), oldLocal);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:3,envelope:large,minimumAppVersion:'1.5.116'},device.token,'1.5.118')).status,200);
  await stop();await start();
  assert.equal((await request('/api/snapshot','GET',undefined,device.token,'1.5.117')).status,409);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:4,envelope,minimumAppVersion:'1.5.116'},device.token,'1.5.117')).status,409);
  assert.equal((await request('/api/pair','POST',{code:'fictional',label:'old'},undefined,'1.5.116')).status,409);
  assert.equal((await request('/api/admin/update','POST',{action:'rollback'},admin,'1.5.118')).status,409);
  const reopened = await request('/api/snapshot','GET',undefined,device.token,'1.5.118');
  assert.equal(reopened.body.minimumAppVersion,'1.5.116');
  assert.deepEqual(await unseal(reopened.body.envelope,key),full);
  assert.deepEqual(fs.readFileSync(path.join(dir,'config.json')),config);

});
