// Synthetic reading preview only; no real customers or monthly sales.
import * as r from '../../public/relations.js';
import {v2Document} from './monthly-analysis-v2-fixture.mjs';
export async function makeFixture(c){
 const month=c.monthlyVisitMonth(),date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);const sales=date.toISOString().slice(0,7);
 let b=c.emptyBundle('compact-fictional');
 for(const [id,name,channel] of [['saved','大樹藥局-虛構青禾店','大樹'],['pending','大樹藥局-虛構晨光店','大樹'],['typed','佑全藥局-虛構晴川店','佑全']]){
  b.ops.push(c.revision('store',id,c.addReminderTasks({name,channel,city:'虛構市',district:'測試區',address:'虛構路1號',contact:'',attr:'',mapUrl:'',everyTimeMust:'帶上已約好的產品說明'},'下次帶產品說明'),'','qa'));
  for(let n=1;n<=2;n++)b.ops.push(c.revision('visit',id+'-note-'+n,{store:id,date:month+'-01',text:n===1?'林藥師：偏好下午再訪。上次聊到陳列，希望下次帶產品說明。':'陳店長：剛調任此店，先詢問店內目前安排。原文可直接修改，全部歷史保留。',next:'',source:'虛構閱讀測試',topics:[],people:[],attachments:[]},[],'qa'));
 }
 const raw=new TextEncoder().encode(JSON.stringify({stores:[['saved','虛構青禾'],['pending','虛構晨光']].map(([id,name])=>({name,channel:'大樹',reason:'虛構分析：本次測試不代表真實銷量或建議。',checkpoints:['詢問陳列是否完成','核對架上數量','詢問店員產品回饋','確認是否需要補充資料']}))}));
 b=await c.applyMonthlyAnalysis(b,await c.prepareMonthlyAnalysis(b,[{name:'fictional-tree.json',raw}],sales,month),[['saved','pending']],'qa');
 const source=c.monthlyAnalysisSources(b)[0];b=await c.applyMonthlyFeedback(b,c.prepareMonthlyFeedback(b,source.id,0),{visitDate:month+'-01',answers:['已確認陳列位置','0','還在試用，未有新回饋','下次帶產品說明'],notes:'虛構回報備註，僅供展開查看'},'qa');
 const doc=v2Document(c);doc.salesMonth=sales;doc.visitMonth=month;doc.stores[0].name='4321虛構晴川';
 b=await c.applyMonthlyAnalysis(b,await c.prepareMonthlyAnalysis(b,[{name:'fictional-youquan.json',raw:new TextEncoder().encode(JSON.stringify(doc))}],sales,month),[['typed']],'qa');
 const typed=c.monthlyAnalysisSources(b).find(s=>s.format==='yq-alert-2'),plan=c.prepareTypedFeedback(b,typed.id,0,'qa-report',month);
 const answers=plan.questions.map(()=>({value:null,otherText:null}));answers[0].value=0;
 b=await c.applyTypedVisit(b,plan,{answers,note:null,noteId:'unused',noteParents:[]},'qa');
 for(const id of ['saved','pending','typed']){
  const q=r.peopleReadingRequest(b,id),evidence=(n,quote)=>[{visitId:id+'-note-'+n,revisionId:q.plan.sources.find(s=>s.visitId===id+'-note-'+n).revisionId,quote}];
  const input={format:'pharmacy-people-review-1',vaultId:b.vaultId,result:{format:q.plan.format,storeId:id,basis:q.plan.basis,coveredRevisions:q.plan.sources.map(s=>s.revisionId),people:[
   {name:'林藥師',kind:'local',items:[{category:'interaction',text:'偏好下午再訪；上次希望帶產品說明。',evidence:evidence(1,'林藥師：偏好下午再訪。上次聊到陳列，希望下次帶產品說明。')}]},
   {name:'陳店長',kind:'local',items:[{category:'background',text:'剛調任此店；可接續詢問店內安排。',evidence:evidence(2,'陳店長：剛調任此店，先詢問店內目前安排。')}]}
  ]}};
  b=await r.applyPeopleReading(b,input,r.preparePeopleReading(b,input),'qa',new Date().toISOString(),'automatic');
 }
 return b;
}
