import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const part=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)+a.length));
function harness(){
 const actions={innerHTML:'',writes:0,set innerHTML(value){this.html=value;this.writes++;},get innerHTML(){return this.html||'';}};
 const form={hidden:true},output={textContent:'',scrollIntoView(){this.revealed=true;}};
 const review={open:true,dataset:{singleStoreId:'s'},classList:{contains:()=>true}};
 const c=vm.createContext({payload:{bundle:{ops:[]},inlineTextDraft:null},inlineTextContext:null,singleStoreContext:null,by:(type,id)=>type==='visit'?{id,store:id==='other'?'other-store':'s'}:{id},$:id=>({'review':review,'review-persistent-actions':actions,'single-store-capture-form':form,'single-store-error':output})[id],esc:s=>s,toast:s=>{c.notice=s;},storeIdentityPending:()=>false});
 vm.runInContext(part('function pendingInlineTextId(','function inlineTextElement(')+part('function singleStoreIdleActions(','function resumeSingleDraftFromReview(')+part('async function reviewInlineTextEdit(','function diffSegmentsHTML('),c);
 return{c,actions,review,form,output};
}
test('unsaved and encrypted inline edits route the footer to the same note, never an empty new-visit submit',()=>{
 for(const saved of [false,true]){const h=harness();if(saved)h.c.payload.inlineTextDraft={format:'inline-text-draft-1',id:'v',after:'fictional edit',parents:['h']};else h.c.inlineTextContext={id:'v',before:'original',after:'fictional edit'};
  const before=JSON.stringify(h.c.payload);h.c.refreshBriefEditActions();assert.match(h.actions.innerHTML,/data-inline-review="v"/);assert.match(h.actions.innerHTML,/完成這筆原文修改/);assert.doesNotMatch(h.actions.innerHTML,/data-start-single-store-capture|type="submit"/);
  const writes=h.actions.writes;h.c.refreshBriefEditActions();assert.equal(h.actions.writes,writes,'no repeated footer replacement while typing');
  h.c.activateSingleStoreCapture();assert.equal(h.c.singleStoreContext,null);assert.equal(h.form.hidden,true);assert.equal(JSON.stringify(h.c.payload),before);assert.match(h.c.notice,/原文修改/);
 }
});
test('an unchanged read-only focus does not turn the footer into a save button; another store edit is not misrouted',()=>{
 const h=harness();h.c.inlineTextContext={id:'v',before:'same',after:'same'};h.c.refreshBriefEditActions();assert.match(h.actions.innerHTML,/data-start-single-store-capture/);
 h.c.inlineTextContext={id:'other',before:'same',after:'changed'};h.c.refreshBriefEditActions();assert.doesNotMatch(h.actions.innerHTML,/data-inline-review/);h.c.activateSingleStoreCapture();assert.equal(h.form.hidden,true);assert.equal(h.c.inlineTextContext.after,'changed');
});
test('an open new-visit form retains its own footer and entered values',()=>{
 const h=harness();h.c.singleStoreContext={storeId:'s',draftTouched:true};h.actions.innerHTML='existing capture buttons';h.form.hidden=false;
 h.c.refreshBriefEditActions();assert.equal(h.actions.innerHTML,'existing capture buttons');assert.equal(h.c.singleStoreContext.draftTouched,true);assert.equal(h.form.hidden,false);
});
test('legacy overlapping forms give a visible local explanation without discarding either draft',async()=>{
 const h=harness();h.c.singleStoreContext={storeId:'s',draftTouched:true};h.c.inlineTextContext={id:'v',before:'original',after:'changed'};h.c.payload.inlineTextDraft={format:'inline-text-draft-1',id:'v',after:'changed'};
 const before=JSON.stringify(h.c.payload);await h.c.reviewInlineTextEdit('v','s');assert.match(h.output.textContent,/先收起/);assert.equal(h.output.revealed,true);assert.equal(JSON.stringify(h.c.payload),before);assert.equal(h.c.inlineTextContext.after,'changed');assert.equal(h.c.singleStoreContext.draftTouched,true);
});
