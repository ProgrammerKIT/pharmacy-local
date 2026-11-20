// Synthetic only; no formal App connection, customer names or notes.
export async function makeFixture(c) {
 const b=c.emptyBundle('fictional-visit-trash');
 b.ops.push(c.revision('store','s',{name:'虛構青禾藥局',city:'虛構市',district:'測試區',channel:'獨立',attr:'',contact:'',nextRemember:'原門市提醒',everyTimeMust:''},[],'qa'));
 for(const [id,text] of [['one','第一筆虛構原文：只移除此筆，完整空白與歷史保留。'],['two','第二筆虛構原文：這一筆必須保持不變。']]) b.ops.push(c.revision('visit',id,{store:'s',date:'2026-11-01',source:'虛構隔離測試',text,next:'原下次跟進',people:[],topics:[],attachments:[]},[],'qa'));
 return b;
}
