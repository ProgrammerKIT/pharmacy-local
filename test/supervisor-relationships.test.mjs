import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBundle,revision,project,validateBundle,supervisorRelationships,reviewSupervisorRelationship,supervisorReviewHistory,newMeta,derive,seal,unseal,merge} from '../public/core.js';
function fixture() {
 const b=emptyBundle('fictional-supervisor-vault');
 const put=(t,id,d)=>b.ops.push(revision(t,id,d,[],'fictional'));
 const store=n=>({name:n,city:'',district:'',channel:'',attr:'',contact:'',nextRemember:'原有待辦'});
 put('store','a',store('虛構甲店'));put('store','b',store('虛構乙店'));
 put('person','boss',{name:'虛構督導',role:'督導',desc:'',confirmed:true,sameAs:'',supervisorKey:'fictional'});
 put('person','peer',{name:'虛構店長',role:'',desc:'',confirmed:true,sameAs:''});
 put('visit','v1',{store:'a',date:'2026-10-01',text:'虛構督導與虛構店長討論新人培訓',next:'',source:'',people:['boss','peer'],topics:[],attachments:[]});
 put('visit','v2',{store:'b',date:'2026-10-02',text:'虛構店長分享新人培訓經驗',next:'',source:'',people:['peer'],topics:[],attachments:[]});
 return b;
}
const edit=(b,t,id,patch)=>{const p=project(b).find(r=>r.type===t&&r.id===id);b.ops.push(revision(t,id,{...p.heads[0].data,...patch},[p.heads[0].id],'fictional'));};
test('real evidence pair, review statuses persist without changing original notes, unchanged basis is quiet',()=>{
 const b=fixture(),before=structuredClone(b),entry=supervisorRelationships(b,'boss')[0];assert.equal(entry.evidence.length,2);assert.equal(entry.evidence[0].id,'v1');assert.equal(entry.evidence[1].id,'v2');
 let next=b;for(const status of ['confirmed','pending','rejected']){next=reviewSupervisorRelationship(next,'boss',supervisorRelationships(next,'boss')[0],status,'fictional');validateBundle(next);assert.equal(supervisorRelationships(next,'boss')[0].basis,entry.basis);}
 assert.equal(supervisorReviewHistory(next,'boss').length,3);assert.deepEqual(next.ops.slice(0,b.ops.length),before.ops);assert.deepEqual(project(next).filter(r=>r.type==='visit'),project(before).filter(r=>r.type==='visit'));
 assert.equal(reviewSupervisorRelationship(next,'boss',supervisorRelationships(next,'boss')[0],'rejected','fictional'),next);
});
test('material source change requires fresh evidence, unrelated text keeps prior decision basis',()=>{
 const b=fixture(),entry=supervisorRelationships(b,'boss')[0],reviewed=reviewSupervisorRelationship(b,'boss',entry,'confirmed','fictional');
 edit(reviewed,'visit','v2',{text:'虛構店長分享新人培訓經驗。另有無關事項'});assert.equal(supervisorRelationships(reviewed,'boss')[0].basis,entry.basis);
 edit(reviewed,'visit','v2',{text:'虛構店長現在負責乙店培訓'});assert.notEqual(supervisorRelationships(reviewed,'boss')[0].basis,entry.basis);assert.equal(supervisorReviewHistory(reviewed,'boss')[0].status,'confirmed');
 assert.throws(()=>reviewSupervisorRelationship(reviewed,'boss',entry,'rejected','fictional'),/來源/);
});
test('no invented ties for same area, ambiguous names, questions, deleted/conflicted sources',()=>{
 const b=fixture();edit(b,'visit','v1',{people:[],text:'甲店由虛構店長負責'});assert.deepEqual(supervisorRelationships(b,'boss'),[]);
 for(const patch of [{text:'虛構督導是否認識虛構店長？'},{text:'虛構督導不認識虛構店長'},{text:'虛構督導可能曾見過虛構店長'}]){const n=fixture();edit(n,'visit','v1',patch);assert.deepEqual(supervisorRelationships(n,'boss'),[]);}
 const n=fixture();n.ops.push(revision('person','duplicate',{name:'虛構店長',role:'',desc:'',confirmed:true,sameAs:''},[],'fictional'));assert.deepEqual(supervisorRelationships(n,'boss'),[]);
 const d=fixture(),v=d.ops.find(o=>o.entity==='v2');d.ops.push(revision('visit','v2',v.data,[v.id],'fictional',true));assert.deepEqual(supervisorRelationships(d,'boss'),[]);
 const c=fixture(),a=c.ops.find(o=>o.entity==='v2');c.ops.push(revision('visit','v2',{...a.data,text:'分支一'},[a.id],'one'),revision('visit','v2',{...a.data,text:'分支二'},[a.id],'two'));assert.deepEqual(supervisorRelationships(c,'boss'),[]);
});
test('own relationship notes participate; review-only person revisions never reopen evidence',()=>{
 const b=fixture();edit(b,'visit','v1',{text:'只有一般記錄',people:[]});edit(b,'person','boss',{relationshipNotes:'與虛構店長曾合作培訓'});
 const entry=supervisorRelationships(b,'boss')[0];assert.equal(entry.evidence[0].type,'person');const next=reviewSupervisorRelationship(b,'boss',entry,'confirmed','fictional');assert.equal(supervisorRelationships(next,'boss')[0].basis,entry.basis);assert.equal(supervisorRelationships(next,'boss')[0].evidence[0].revisionId,entry.evidence[0].revisionId);
});
test('manual topics yield evidence candidates without inferring social relationships',()=>{
 const b=fixture();b.ops.push(revision('topic','topic',{name:'虛構專案',desc:''},[],'fictional'));edit(b,'visit','v1',{text:'虛構督導規劃虛構專案',people:['boss'],topics:['topic']});edit(b,'visit','v2',{text:'虛構專案進度更新',people:[],topics:['topic']});assert.ok(supervisorRelationships(b,'boss').some(e=>e.id.includes('topic')&&e.title.includes('主題')));
});
test('tampered review provenance and duplicate event changes fail validation',()=>{
 const b=fixture(),entry=supervisorRelationships(b,'boss')[0],next=reviewSupervisorRelationship(b,'boss',entry,'confirmed','fictional');const bad=structuredClone(next);bad.ops.at(-1).data.relationshipReviews[0].entry.evidence[0].text='不存在的引文';assert.throws(()=>validateBundle(bad),/原文/);
 const bad2=structuredClone(next);edit(bad2,'person','boss',{relationshipReviews:[{...bad2.ops.at(-1).data.relationshipReviews[0],status:'rejected'}]});assert.throws(()=>validateBundle(bad2),/歷史識別/);
});
test('encrypted bundle roundtrip and merge preserve reviews, notes and original history',async()=>{
 const b=fixture();edit(b,'person','boss',{relationshipNotes:'自己的文字保留'});const next=reviewSupervisorRelationship(b,'boss',supervisorRelationships(b,'boss')[0],'pending','fictional');const m=newMeta(),key=await derive('fictional-password-only',m),encrypted=await seal(next,key,m);const opened=await unseal(encrypted,key);assert.deepEqual(opened,next);const merged=merge(opened,b);assert.deepEqual(supervisorReviewHistory(merged,'boss'),supervisorReviewHistory(next,'boss'));assert.equal(project(merged).find(p=>p.id==='boss').relationshipNotes,'自己的文字保留');
});

test('merge ordering does not manufacture changed evidence or reopen a review',()=>{const b=fixture(),entry=supervisorRelationships(b,'boss')[0],n=reviewSupervisorRelationship(b,'boss',entry,'confirmed','fictional'),m=merge(n,b);assert.deepEqual(supervisorRelationships(m,'boss'),supervisorRelationships(n,'boss'));assert.equal(supervisorReviewHistory(m,'boss').at(-1).status,'confirmed');});
