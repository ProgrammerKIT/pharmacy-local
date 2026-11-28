import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as c from '../public/core.js';import * as r from '../public/relations.js';
import {makeFixture} from './qa/confirmed-insight-fixture.mjs';
import {makeFixture as peopleFixture} from './qa/people-relationship-fixture.mjs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const part=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)+a.length));
function harness(bundle){const x=vm.createContext({...c,...r,payload:{bundle},peopleReadingViews:new Map(),esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),dateText:v=>v,by:(t,id)=>c.project(x.payload.bundle).find(v=>v.type===t&&v.id===id),insightDisplayReview:(s,e)=>e.review||c.insightReviewForEntry(s,e),peopleEvidenceHTML:()=>'<details><summary>原句</summary></details>',insightChangeBadgeHTML:()=>'',peopleReadingRecoveryHTML:()=>'',peopleAliasHistoryHTML:()=>'',peopleRelationshipHistoryHTML:()=>''});
vm.runInContext(part('function confirmedVisitHighlightsHTML(','function insightReviewArchiveHTML(')+part('const PEOPLE_RELATION_LABELS=','function refreshPeopleReadingPanel('),x);return x;}
test('both confirmed legacy conclusions are visible even without AI reading, and pending/rejected/history are not promoted',()=>{
const b=makeFixture(c),x=harness(b),before=JSON.stringify(b);x.peopleReadingViews.set('qa-insight-a',{state:'missing'});
const html=x.peopleReadingHTML('qa-insight-a');const top=html.slice(0,html.indexOf('people-reading-status'));
assert.match(top,/本店已確認重點/);assert.equal((top.match(/data-confirmed-highlight=/g)||[]).length,2);assert.match(top,/人物關係/);assert.match(top,/客群與互動/);assert.doesNotMatch(top,/<details/);
assert.equal(x.confirmedVisitHighlightsHTML('qa-insight-b'),'');assert.equal(JSON.stringify(b),before);
});
test('withdrawal removes the conclusion immediately; evidence revisions keep confirmation with a source notice',()=>{
let b=makeFixture(c);const x=harness(b),store=()=>c.project(x.payload.bundle).find(v=>v.id==='qa-insight-a');
x.payload.bundle=c.applyInsightReview(b,c.planInsightReview(b,'qa-insight-a','qa-confirmed-relationship','pending',store().heads[0].id),'qa');
assert.equal((x.confirmedVisitHighlightsHTML('qa-insight-a').match(/data-confirmed-highlight=/g)||[]).length,1);
const v=c.project(x.payload.bundle).find(v=>v.id==='qa-insight-note-a');x.payload.bundle.ops.push(c.revision('visit',v.id,{...v.heads[0].data,text:v.text+'\n新筆記'},v.heads.map(h=>h.id),'qa'));
assert.match(x.confirmedVisitHighlightsHTML('qa-insight-a'),/來源已有更新/);assert.match(x.confirmedVisitHighlightsHTML('qa-insight-a'),/Kit已確認/);
});
test('a person summary exposes only exact confirmed relationship decisions; later rejection and conflicts do not look confirmed',async()=>{
const f=await peopleFixture(c,r),x=harness(f.bundle),view={readingId:f.readingId,result:f.input.result};
let html=x.peopleReadingCardsHTML('s',view);assert.doesNotMatch(html.split('</summary>')[0],/Kit已確認|博文是/);
const p=r.planPeopleRelationshipReview(x.payload.bundle,f.readingId,0,0,'confirmed');x.payload.bundle=await r.applyPeopleRelationshipReview(x.payload.bundle,p,'qa');
html=x.peopleReadingCardsHTML('s',view);assert.match(html.split('</summary>')[0],/Kit已確認.*博文是她以前的同事/);assert.doesNotMatch(html,/<details[^>]* open/);
const historical={...view,result:structuredClone(view.result)};historical.result.people[0].kind='historical';const historicalHTML=x.peopleReadingCardsHTML('s',historical);assert.match(historicalHTML,/people-other-confirmed/);assert.ok(historicalHTML.indexOf('people-other-confirmed')<historicalHTML.indexOf('<summary>歷史人物'));
const before=JSON.stringify(x.payload.bundle);x.peopleReadingCardsHTML('s',view);assert.equal(JSON.stringify(x.payload.bundle),before);
x.payload.bundle=await r.applyPeopleRelationshipReview(x.payload.bundle,r.planPeopleRelationshipReview(x.payload.bundle,f.readingId,0,0,'rejected'),'qa');
assert.doesNotMatch(x.peopleReadingCardsHTML('s',view).split('</summary>')[0],/Kit已確認|博文是/);
x.peopleRelationshipReviewState=()=>({conflict:true,status:'confirmed'});assert.doesNotMatch(x.peopleReadingCardsHTML('s',view).split('</summary>')[0],/Kit已確認/);
});
test('highlight content is escaped, preserves full conclusion and uses explicit card IDs rather than person-name guesses',()=>{
const x=harness(makeFixture(c));x.storeInsightDisplayForStore=()=>({entries:[{id:'safe',kind:'relationship',headline:'<img src=x onerror=bad>完整結論',review:{status:'confirmed'},sourceCurrent:true}]});
const html=x.confirmedVisitHighlightsHTML('qa-insight-a');assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/data-confirmed-highlight-open="safe"/);assert.match(html,/完整結論/);
});
