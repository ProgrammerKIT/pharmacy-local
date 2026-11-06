// Synthetic-only relationship review fixture; contains no customer data.
export async function makeFixture(c,r){
 const bundle=c.emptyBundle('synthetic-relationship-review-vault');
 const store=name=>({name,city:'測試市',district:'測試區',channel:'虛構',attr:'',contact:'',nextRemember:'原提醒',everyTimeMust:'原必做'});
 bundle.ops.push(c.revision('store','s',store('虛構青禾店'),[],'seed'),c.revision('store','t',store('虛構晨光店'),[],'seed'));
 const text='雨晴說博文是她以前的同事。雨晴說子安認識她。雨清也提過博文。';
 bundle.ops.push(c.revision('visit','v',{store:'s',date:'',text,next:'原跟進',source:'虛構來源',people:[],topics:[],attachments:[]},[],'seed'));
 bundle.ops.push(c.revision('person','person-original',{name:'雨晴',role:'',desc:'原人物資料',confirmed:false,sameAs:''},[],'seed'));
 const q=r.peopleReadingRequest(bundle,'s'),revisionId=q.plan.sources[0].revisionId;
 const evidence=quote=>[{visitId:'v',revisionId,quote}];
 const input={format:'pharmacy-people-review-1',vaultId:bundle.vaultId,result:{format:q.plan.format,storeId:'s',basis:q.plan.basis,coveredRevisions:[revisionId],people:[
  {name:'雨晴',kind:'local',items:[{category:'relationship',text:'筆記記載博文是她以前的同事。',evidence:evidence('雨晴說博文是她以前的同事。')},{category:'relationship',text:'本段子安認識「她」，依上下文指雨晴，仍待核對。',evidence:evidence('雨晴說子安認識她。')}]},
  {name:'雨清',kind:'uncertain',items:[{category:'interaction',text:'提過博文。',evidence:evidence('雨清也提過博文。')}]}
 ]}};
 const saved=await r.applyPeopleReading(bundle,input,r.preparePeopleReading(bundle,input),'seed',new Date().toISOString(),'automatic');
 return {bundle:saved,input,readingId:r.currentPeopleReading(saved,'s').current.id};
}
