// Synthetic-only fixture; no real sales, customer names, or private source files.
export async function makeFixture(c){
 let b=c.emptyBundle('synthetic-monthly-feedback-ui');
 const store=(name,channel='大樹')=>({name,channel,city:'虛構市',district:'虛構區',address:'虛構路1號',mapUrl:'',attr:'原門市文字',contact:'原窗口',nextRemember:'原待辦',everyTimeMust:'原例行'});
 b.ops.push(c.revision('store','qa-alert-a',store('大樹藥局-虛構青禾店'),[],'fixture'),c.revision('store','qa-alert-b',store('大樹藥局-虛構晨光店'),[],'fixture'),c.revision('store','qa-alert-other',store('佑全藥局-虛構青禾店','佑全'),[],'fixture'));
 b.ops.push(c.revision('visit','qa-alert-note',{store:'qa-alert-a',date:'',text:'原始筆記\r\n完全保留，不可被分析或回報覆蓋。',next:'原下次跟進',source:'虛構',topics:[],people:[],attachments:[]},[],'fixture'));
 const month=c.monthlyVisitMonth(),date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);const sales=date.toISOString().slice(0,7);
 const raw=new TextEncoder().encode(JSON.stringify({stores:[{name:'001大樹虛構青禾店',channel:'大樹',reason:'虛構銷量波動，請到店確認原因。',checkpoints:['數一數架上數量（不知道就留空）','詢問變動原因；只記錄真實回覆'] }]}));
 return c.applyMonthlyAnalysis(b,await c.prepareMonthlyAnalysis(b,[{name:'synthetic-alert.json',raw}],sales,month),[['qa-alert-a']],'fixture');
}
