import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, revision, project, planStoreMerge, applyStoreMerge } from '../public/core.js';
import { prepareCSV, planCSV, buildCSVImport, sop1Report } from '../public/csv.js';

test('retired store maps and original names require review rather than resurrection or silent duplication', async () => {
  let bundle = emptyBundle('fictional-retired-csv');
  const data = (name, mapUrl) => ({ name, address: '虛構路1號', city: '', district: '', channel: '', contact: '', attr: '', mapUrl });
  const firstURL = 'https://www.google.com/maps?cid=1234567';
  const secondURL = 'https://www.google.com/maps?cid=7654321';
  bundle.ops.push(revision('store', 'keeper', { ...data('虛構甲藥局', firstURL) }, [], 'qa'));
  const donor = revision('store', 'donor', data('虛構乙藥局', secondURL), [], 'qa');
  bundle.ops.push(donor);
  const mergePlan = await planStoreMerge(bundle, { keeperId: 'keeper', donorId: 'donor', name: '虛構合併藥局' });
  bundle = (await applyStoreMerge(bundle, mergePlan, 'qa')).bundle;
  const before = JSON.stringify(bundle);
  for (const [name, url] of [['虛構乙藥局', secondURL], ['虛構新名稱藥局', secondURL], ['虛構甲藥局', firstURL], ['虛構合併藥局', firstURL]]) {
    const file = await prepareCSV('虛構來源.csv', new TextEncoder().encode(`Title,Note,URL\n${name},保留來源原文,${url}`));
    const plan = await planCSV([file], bundle);
    assert.equal(plan.rows[0].choice, 'review');
    assert.equal(sop1Report(plan, bundle).ready, false);
    assert.throws(() => buildCSVImport(plan, bundle, 'qa'), /SOP1/);
    for (const forced of ['store:keeper', 'new']) {
      plan.rows[0].choice = forced;
      assert.equal(sop1Report(plan, bundle).ready, false);
      assert.throws(() => buildCSVImport(plan, bundle, 'qa'), /SOP1/);
    }
    assert.equal(JSON.stringify(bundle), before);
  }
  assert.equal(project(bundle).filter(record => record.type === 'store' && !record.deleted).length, 1);
});
