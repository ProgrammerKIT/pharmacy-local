// Synthetic names and stores only; never copy a real customer's notes here.
export async function makeAliasFixture(c,r){
 const bundle=c.emptyBundle('synthetic-alias-review-vault');
 const store={name:'虛構青禾店',city:'測試市',district:'測試區',channel:'虛構',attr:'',contact:'',nextRemember:'原提醒',everyTimeMust:'原必做'};
 bundle.ops.push(c.revision('store','s',store,[],'seed'),c.revision('store','t',{...store,name:'虛構晨光店'},[],'seed'));
 const texts=['雨晴是藥師，說博文是她以前的同事。雨晴分享展示架的介紹經驗。','雨清藥師接續談同一展示架的介紹，仍未確認是否為同人。','子安提過試用心得。'];
 for(const [i,text]of texts.entries())bundle.ops.push(c.revision('visit','v'+i,{store:'s',date:'',text,next:'原跟進',source:'虛構來源',people:[],topics:[],attachments:[]},[],'seed'));
 bundle.ops.push(c.revision('person','original-person',{name:'雨晴',role:'',desc:'原人物與關係保留',confirmed:false,sameAs:''},[],'seed'));
 const q=r.peopleReadingRequest(bundle,'s'),evidence=(i,quote)=>[{visitId:'v'+i,revisionId:q.plan.sources[i].revisionId,quote}];
 const input={format:'pharmacy-people-review-1',vaultId:bundle.vaultId,result:{format:q.plan.format,storeId:'s',basis:q.plan.basis,coveredRevisions:q.plan.sources.map(s=>s.revisionId),people:[
  {name:'雨晴',kind:'local',candidateGroup:'possible-alias',candidateReason:'兩個稱呼都以藥師身分接續同一展示架的互動；仍待人工核對。',items:[{category:'background',text:'原文記載為藥師。',evidence:evidence(0,'雨晴是藥師')},{category:'interaction',text:'分享展示架的介紹經驗。',evidence:evidence(0,'雨晴分享展示架的介紹經驗。')},{category:'relationship',text:'原文記載博文是她以前的同事。',evidence:evidence(0,'雨晴是藥師，說博文是她以前的同事。')}]},
  {name:'子安',kind:'local',items:[{category:'interaction',text:'提過試用心得。',evidence:evidence(2,texts[2])}]},
  {name:'雨清',kind:'uncertain',candidateGroup:'possible-alias',candidateReason:'兩個稱呼都以藥師身分接續同一展示架的互動；仍待人工核對。',items:[{category:'interaction',text:'接續談展示架的介紹，未確認是否為同人。',evidence:evidence(1,texts[1])}]}
 ]}};
 const saved=await r.applyPeopleReading(bundle,input,r.preparePeopleReading(bundle,input),'seed',new Date().toISOString(),'automatic');
 return {bundle:saved,input,readingId:r.currentPeopleReading(saved,'s').current.id};
}
