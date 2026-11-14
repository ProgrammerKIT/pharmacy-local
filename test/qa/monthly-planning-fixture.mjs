// Synthetic only. No customer names or notes. Served by a local test harness.
export async function makeFixture(c){
 let b=c.emptyBundle('fictional-monthly-planning');
 for(const [id,name,city,district] of [['tree','大樹藥局-虛構青禾店','虛構市','甲區'],['you','佑全藥局-虛構晴川店','虛構市','乙區'],['other','虛構獨立藥局','虛構市','甲區']]){
  b.ops.push(c.revision('store',id,{name,city,district,channel:'',address:'虛構路1號',mapUrl:'',attr:'',contact:'',nextRemember:'',everyTimeMust:''},[],'qa'));
  b.ops.push(c.revision('visit',id+'-note',{store:id,date:'',text:'完整虛構原文，保持不變。',next:'虛構跟進',source:'虛構隔離測試',people:[],topics:[],attachments:[]},[],'qa',false,id==='tree'?c.makeVisitAttendance(id,new Date().toISOString()):undefined));
 }
 for(const [kind,value] of [['roster',['tree','you']],['focus','虛構本月重點：拜訪前先看既有原文。']])b=await c.applyMonthlyPlanning(b,{kind,month:c.monthlyVisitMonth(),expectedBasis:c.monthlyPlanningBasis(b,kind,c.monthlyVisitMonth()),[kind==='roster'?'storeIds':'text']:value},'qa');
 return b;
}
