import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as c from '../public/core.js';import * as r from '../public/relations.js';
import {makeAliasFixture}from'./qa/people-alias-fixture.mjs';
async function reviewed(){const f=await makeAliasFixture(c,r);f.bundle=await r.applyPeopleAliasReview(f.bundle,r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'confirmed','雨晴'),'fictional');f.bundle=await r.applyPeopleRelationshipReview(f.bundle,r.planPeopleRelationshipReview(f.bundle,f.readingId,0,2,'rejected'),'fictional');return f;}
async function rewrite(f,change){const input=structuredClone(f.input);change(input.result);const bundle=await r.applyPeopleReading(f.bundle,input,r.preparePeopleReading(f.bundle,input),'fictional',new Date().toISOString(),'automatic');return{bundle,input,id:r.currentPeopleReading(bundle,'s').current.id};}
test('same evidence with new wording stays a candidate; original confirmed alias and rejected claim remain operable',async()=>{
 const f=await reviewed(),before=structuredClone(f.bundle);const n=await rewrite(f,v=>{v.people[0].items[0].text='原文記載：'+v.people[0].items[0].text;v.people[0].items[2].text='原文記載：'+v.people[0].items[2].text;});
 const p=r.peopleReadingPresentation(n.bundle,'s');assert.equal(p.preserveHuman,true);assert.equal(p.current.id,n.id);assert.ok(p.panels.some(s=>s.source.id===f.readingId));
 assert.equal(c.peopleAliasReviewState(n.bundle,f.readingId,[0,2]).status,'confirmed');assert.equal(c.peopleRelationshipReviewState(n.bundle,f.readingId,0,2).status,'rejected');
 assert.equal(c.peopleAliasReviewState(n.bundle,n.id,[0,2]).status,null);assert.equal(c.peopleRelationshipReviewState(n.bundle,n.id,0,2).status,null,'do not copy old decisions onto rewritten claims');
 assert.equal(r.peopleAliasReviewAvailability(n.bundle,f.readingId,[0,2]).canReview,true);assert.equal(r.peopleRelationshipReviewAvailability(n.bundle,f.readingId,0,2).canReview,true);
 assert.deepEqual(n.bundle.ops.slice(0,before.ops.length),before.ops);for(const [id,bytes]of Object.entries(before.blobs))assert.equal(n.bundle.blobs[id],bytes);assert.deepEqual(f.bundle,before);
});
test('ordinary automatic readings with no human decision still refresh normally',async()=>{
 const f=await makeAliasFixture(c,r),n=await rewrite(f,v=>v.people[1].items[0].text='原文記載：'+v.people[1].items[0].text);assert.equal(r.peopleReadingPresentation(n.bundle,'s').preserveHuman,false);
});
test('unchanged reviewed units carry by existing exact keys, and unrelated profile changes do not block them',async()=>{
 const f=await reviewed(),n=await rewrite(f,v=>v.people[1].items[0].text='原文記載：'+v.people[1].items[0].text);const p=r.peopleReadingPresentation(n.bundle,'s');assert.equal(p.preserveHuman,false);assert.equal(c.peopleAliasReviewState(n.bundle,n.id,[0,2]).status,'confirmed');assert.equal(c.peopleRelationshipReviewState(n.bundle,n.id,0,2).status,'rejected');
});
test('same quote with a different interpretation never inherits a human decision',async()=>{
 const f=await reviewed(),n=await rewrite(f,v=>v.people[0].items[2].text='是否為現在同事仍待核對。');const p=r.peopleReadingPresentation(n.bundle,'s');assert.equal(p.preserveHuman,true);assert.equal(c.peopleRelationshipReviewState(n.bundle,n.id,0,2).status,null);assert.equal(c.peopleRelationshipReviewState(n.bundle,f.readingId,0,2).status,'rejected');
});
test('explicit withdrawal releases protection without deleting old decision history',async()=>{
 const f=await reviewed(),n=await rewrite(f,v=>{v.people[0].items[0].text+=' 原文記載。';v.people[0].items[2].text+=' 原文記載。';});let b=n.bundle;
 b=await r.applyPeopleAliasReview(b,r.planPeopleAliasReview(b,f.readingId,[0,2],'pending',''),'fictional');b=await r.applyPeopleRelationshipReview(b,r.planPeopleRelationshipReview(b,f.readingId,0,2,'pending'),'fictional');
 assert.equal(r.peopleReadingPresentation(b,'s').preserveHuman,false);assert.equal(c.peopleAliasReviewState(b,f.readingId,[0,2]).history.length,2);assert.equal(c.peopleRelationshipReviewState(b,f.readingId,0,2).history.length,2);
});
test('changed original evidence stays version-bound; old decisions can only be withdrawn',async()=>{
 const f=await reviewed(),n=await rewrite(f,v=>v.people[0].items[0].text+=' 原文記載。');const b=structuredClone(n.bundle),visit=b.ops.find(o=>o.type==='visit'&&o.entity==='v0');b.ops.push(c.revision('visit','v0',{...visit.data,text:visit.data.text+'新增原文。'},[visit.id],'fictional'));
 const p=r.peopleReadingPresentation(b,'s');assert.equal(p.preserveHuman,true);const scope=r.peopleAliasReviewAvailability(b,f.readingId,[0,2]);assert.equal(scope.canReview,false);assert.equal(scope.canWithdraw,true);assert.throws(()=>r.planPeopleAliasReview(b,f.readingId,[0,2],'confirmed','雨晴'));assert.equal(c.peopleAliasReviewState(b,f.readingId,[0,2]).status,'confirmed');
});
test('previously saved automatic versions are projected safely without migration or deletion',async()=>{
 const f=await reviewed(),n=await rewrite(f,v=>v.people[0].items[0].text+=' 原文記載。');const second=await rewrite({...f,bundle:n.bundle},v=>v.people[0].items[0].text+=' 曾經記載。');const before=JSON.stringify(second.bundle),p=r.peopleReadingPresentation(second.bundle,'s');assert.equal(p.preserveHuman,true);assert.equal(p.history.length,3);assert.equal(JSON.stringify(second.bundle),before);assert.equal(r.peopleReadingPresentation(second.bundle,'t').panels.length,0);
});
test('whole-reading manual approval remains primary until another explicit manual reading approval',async()=>{
 const f=await makeAliasFixture(c,r);let b=await r.applyPeopleReading(f.bundle,f.input,r.preparePeopleReading(f.bundle,f.input),'fictional');const manualId=r.currentPeopleReading(b,'s').current.id;const n=await rewrite({...f,bundle:b},v=>v.people[1].items[0].text+=' 原文記載。');assert.ok(r.peopleReadingPresentation(n.bundle,'s').panels.some(p=>p.source.id===manualId&&p.wholeReading));
 b=await r.applyPeopleReading(n.bundle,n.input,r.preparePeopleReading(n.bundle,n.input),'fictional');assert.equal(r.peopleReadingPresentation(b,'s').preserveHuman,false);
});
test('conflicting human decisions stay visible, never chosen automatically',async()=>{
 const f=await makeAliasFixture(c,r),p=r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'confirmed','雨晴'),a=await r.applyPeopleAliasReview(f.bundle,p,'a'),b=await r.applyPeopleAliasReview(f.bundle,r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'rejected',''),'b');const merged=await c.merge(a,b),n=await rewrite({...f,bundle:merged},v=>v.people[0].items[0].text+=' 原文記載。');const view=r.peopleReadingPresentation(n.bundle,'s');assert.ok(view.protectedCases.some(c=>c.type==='alias'&&c.conflict));assert.equal(c.peopleAliasReviewState(n.bundle,f.readingId,[0,2]).status,null);
});

const application=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function render(bundle){
 let ctx;const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{open:false,dataset:{},innerHTML:'original-editor',querySelectorAll:()=>[]});return nodes.get(id);};
 ctx=vm.createContext({...c,...r,Map,Set,JSON,Date,TextEncoder,structuredClone,$,payload:{bundle},key:{},document:{hidden:false},pendingLock:false,inlineTextContext:null,editorContext:null,singleStoreContext:null,esc:v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),dateText:v=>v,insightChangeBadgeHTML:()=>'',all:type=>c.project(ctx.payload.bundle).filter(o=>o.type===type)});
 const start=application.indexOf('const peopleReadingViews'),end=application.indexOf('function peopleReadingTick()',start);
 vm.runInContext(application.slice(start,end),ctx);ctx.loadPeopleReadingView('s');return ctx.peopleReadingHTML('s');
}
test('actual App renders preserved merged names and denied statement above collapsed new AI interpretation',async()=>{
 const f=await reviewed(),n=await rewrite(f,v=>{v.people[0].items[0].text='新 AI 措辭：'+v.people[0].items[0].text;v.people[0].items[2].text='新 AI 措辭：'+v.people[0].items[2].text;});const before=JSON.stringify(n.bundle),html=render(n.bundle),cut=html.indexOf('<details class="people-reading-ai-candidates">');assert.ok(cut>0);const stable=html.slice(0,cut),candidate=html.slice(cut);
 assert.match(stable,/雨晴（雨清）/);assert.match(stable,/你的判斷：否定/);assert.ok(stable.includes('data-reading-alias-reading="'+f.readingId+'"'));assert.ok(stable.includes('data-reading-relation-reading="'+f.readingId+'"'));assert.doesNotMatch(stable,/新 AI 措辭/);assert.match(candidate,/新 AI 措辭/);assert.doesNotMatch(html,/<details[^>]*\sopen/);assert.equal(JSON.stringify(n.bundle),before);
});
test('rejected identity is preserved as separate cards with its original decision control',async()=>{
 const f=await makeAliasFixture(c,r);f.bundle=await r.applyPeopleAliasReview(f.bundle,r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'rejected',''),'fictional');const n=await rewrite(f,v=>v.people[0].items[0].text+=' 原文記載。');const html=render(n.bundle).split('<details class="people-reading-ai-candidates">')[0];assert.doesNotMatch(html,/雨晴（雨清）/);assert.match(html,/不同人/);assert.ok(html.includes('data-reading-alias-reading="'+f.readingId+'"'));
});
test('independent AI candidate is escaped and rendering never writes a review or original note',async()=>{
 const f=await reviewed(),n=await rewrite(f,v=>v.people[0].items[0].text+=' <script>fictional()</script>');const before=JSON.stringify(n.bundle),html=render(n.bundle);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.equal(JSON.stringify(n.bundle),before);
});
