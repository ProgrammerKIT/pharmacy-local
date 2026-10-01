import test from 'node:test';
import assert from 'node:assert/strict';
import { searchStoreVisitText, emptyBundle, revision, project } from '../public/core.js';

// Entirely synthetic projected records: no customer notes or production vault.
const visit = (id, text, extra = {}) => ({type:'visit',id,store:'synthetic-store',text,date:'2026-10-01',source:'synthetic',deleted:false,conflict:false,heads:[{id:`head-${id}`}],...extra});
const normalized = value => value.replace(/\r\n?/g,'\n');

test('literal punctuation and regex metacharacters are matched without executing a pattern',()=>{
  const special='.*+?^${}()|[]\\',note=`before ${special} after`,input=[visit('literal',note)];
  const result=searchStoreVisitText(input,'synthetic-store',special);
  assert.deepEqual(result,{query:special,matches:[{visitId:'literal',headId:'head-literal',start:7,end:7+special.length,text:special,date:'2026-10-01',source:'synthetic'}],truncated:false});
  assert.equal(searchStoreVisitText([visit('literal','arbitrary text')],'synthetic-store','.*').matches.length,0);
  for(const char of [...special])assert.ok(searchStoreVisitText(input,'synthetic-store',char).matches.length>0,`${char} remains literal`);
});

test('HTML stays literal text and only the exact matched fragment is returned',()=>{
  const text='prefix <img src=x onerror=synthetic()> suffix &lt;img&gt;';
  const result=searchStoreVisitText([visit('html',text)],'synthetic-store','<img src=x onerror=synthetic()>');
  assert.equal(result.matches.length,1);assert.equal(result.matches[0].text,'<img src=x onerror=synthetic()>');assert.equal(result.matches[0].start,7);
  assert.equal(searchStoreVisitText([visit('html','&lt;img&gt;')],'synthetic-store','<img>').matches.length,0);
});

test('case-insensitive literal search returns original casing without synonym or topic expansion',()=>{
  const input=[visit('terms','HAUD haud HaUd Complete 康復力 人工淚液')];
  const result=searchStoreVisitText(input,'synthetic-store','  hAuD  ');
  assert.equal(result.query,'hAuD');assert.deepEqual(result.matches.map(m=>m.text),['HAUD','haud','HaUd']);
  assert.deepEqual(searchStoreVisitText(input,'synthetic-store','HAMD').matches,[]);
  assert.deepEqual(searchStoreVisitText([visit('terms','Complete 康復力')],'synthetic-store','康富力').matches,[]);
  assert.deepEqual(searchStoreVisitText([visit('terms','現場上課')],'synthetic-store','CME').matches,[]);
});

test('emoji and Chinese matches retain UTF-16 offsets in the normalized visible text',()=>{
  const text='🧪前😀中文後😀中文',input=[visit('unicode',text)],result=searchStoreVisitText(input,'synthetic-store','😀中文');
  assert.deepEqual(result.matches.map(m=>[m.start,m.end,m.text]),[[3,7,'😀中文'],[8,12,'😀中文']]);
  for(const match of result.matches)assert.equal(text.slice(match.start,match.end),match.text);
  assert.deepEqual(searchStoreVisitText(input,'synthetic-store','中文').matches.map(m=>m.start),[5,10]);
});

test('CRLF and CR display line endings normalize to LF for multiline and later offsets without rewriting source',()=>{
  const text='🧪甲\r\n乙\r丙\n乙\r\n丙',input=[visit('lines',text)],before=JSON.stringify(input);
  const result=searchStoreVisitText(input,'synthetic-store','乙\n丙');
  assert.equal(result.matches.length,2);assert.deepEqual(result.matches.map(m=>[m.start,m.end]),[[4,7],[8,11]]);
  for(const match of result.matches)assert.equal(normalized(text).slice(match.start,match.end),match.text);
  assert.equal(JSON.stringify(input),before);assert.equal(input[0].text,text);
});

test('query edge whitespace is trimmed while internal spaces remain significant',()=>{
  const input=[visit('spaces','two  words two words')];
  assert.deepEqual(searchStoreVisitText(input,'synthetic-store',' \t two  words \r\n ').matches.map(m=>m.text),['two  words']);
  for(const query of ['', ' \r\n\t ', null, undefined])assert.deepEqual(searchStoreVisitText(input,'synthetic-store',query),{query:'',matches:[],truncated:false});
});

test('scope excludes other stores, deleted records, conflicts and non-visit records',()=>{
  const input=[visit('allowed','needle'),visit('other','needle',{store:'different-store'}),visit('trash','needle',{deleted:true}),visit('conflicted','needle',{conflict:true}),visit('store-record','needle',{type:'store'}),visit('topic-record','needle',{type:'topic'}),visit('field-only','unrelated',{next:'needle',source:'needle',name:'needle'})];
  assert.deepEqual(searchStoreVisitText(input,'synthetic-store','needle').matches.map(m=>m.visitId),['allowed']);
  assert.deepEqual(searchStoreVisitText(input,'missing-store','needle').matches,[]);
});

test('date descending then ID descending orders visits, with matches in left-to-right text order',()=>{
  const input=[visit('a','match match',{date:'2026-10-01'}),visit('newest','match',{date:'2026-10-02'}),visit('z','match',{date:'2026-10-01'}),visit('undated-a','match',{date:''}),visit('undated-z','match',{date:''})];
  const result=searchStoreVisitText(input,'synthetic-store','match');
  assert.deepEqual(result.matches.map(m=>[m.visitId,m.start]),[['newest',0],['z',0],['a',0],['a',6],['undated-z',0],['undated-a',0]]);
  assert.deepEqual(input.map(v=>v.id),['a','newest','z','undated-a','undated-z']);
});

test('repeated occurrences use non-overlapping literal matches and preserve the exact head ID',()=>{
  const input=[visit('overlap','aaaaa',{heads:[{id:'reviewed-head'}]})],result=searchStoreVisitText(input,'synthetic-store','aa');
  assert.deepEqual(result.matches.map(m=>[m.start,m.end,m.headId]),[[0,2,'reviewed-head'],[2,4,'reviewed-head']]);
  const bare=searchStoreVisitText([visit('bare','needle',{heads:undefined,date:undefined,source:undefined})],'synthetic-store','needle').matches[0];
  assert.equal(bare.headId,'');assert.equal(bare.date,'');assert.equal(bare.source,'');
});

test('cap is global across records and truncation is set only after finding one additional match',()=>{
  const input=[visit('b','hit hit'),visit('a','hit')];
  const exact=searchStoreVisitText(input,'synthetic-store','hit',3);assert.equal(exact.matches.length,3);assert.equal(exact.truncated,false);
  const capped=searchStoreVisitText(input,'synthetic-store','hit',2);assert.equal(capped.matches.length,2);assert.equal(capped.truncated,true);assert.deepEqual(capped.matches,exact.matches.slice(0,2));
  assert.deepEqual(searchStoreVisitText(input,'synthetic-store','hit',0),{query:'hit',matches:[],truncated:true});
  assert.deepEqual(searchStoreVisitText(input,'synthetic-store','absent',0),{query:'absent',matches:[],truncated:false});
  assert.deepEqual(searchStoreVisitText(input,'synthetic-store',' ',0),{query:'',matches:[],truncated:false});
});

test('default cap is 500 with honest exact-limit and overflow results',()=>{
  const input=[visit('large',Array(500).fill('hit').join(' '))];
  const exact=searchStoreVisitText(input,'synthetic-store','hit');assert.equal(exact.matches.length,500);assert.equal(exact.truncated,false);
  input[0].text+=' hit';const overflow=searchStoreVisitText(input,'synthetic-store','hit');assert.equal(overflow.matches.length,500);assert.equal(overflow.truncated,true);
});

test('invalid result limits fail explicitly instead of silently returning unlimited results',()=>{
  for(const limit of [-1,1.5,NaN,Infinity,'3',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>searchStoreVisitText([visit('cap','hit')],'synthetic-store','hit',limit),RangeError);
});

test('searching real projected current visits never reads previous versions or creates revisions',()=>{
  const bundle=emptyBundle('synthetic-search-vault'),data={store:'synthetic-store',date:'2026-10-01',text:'old-only phrase',next:'',source:'synthetic',topics:[],people:[],attachments:[]};
  const old=revision('visit','v',data,[],'synthetic'),current=revision('visit','v',{...data,text:'current-only phrase'},[old.id],'synthetic');bundle.ops.push(old,current);
  const records=project(bundle),before=JSON.stringify({bundle,records});
  assert.deepEqual(searchStoreVisitText(records,'synthetic-store','old-only').matches,[]);
  const result=searchStoreVisitText(records,'synthetic-store','current-only');assert.equal(result.matches.length,1);assert.equal(result.matches[0].headId,current.id);
  assert.equal(JSON.stringify({bundle,records}),before);
});

test('frozen inputs remain immutable and result edits cannot change any visit or version',()=>{
  const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
  const input=freeze([visit('b','needle',{versions:[{data:{text:'original historical needle'}}]}),visit('a','needle')]),before=JSON.stringify(input);
  const result=searchStoreVisitText(input,'synthetic-store','needle');result.matches[0].text='modified result';result.matches[0].visitId='different';result.matches.push({});
  assert.equal(JSON.stringify(input),before);
});
