// Synthetic acceptance only. Never imports a formal snapshot or device pairing.
export async function makeFixture(c){
 const b=c.emptyBundle('fictional-save-resilience');
 b.ops.push(c.revision('store','s',{name:'虛構青禾藥局',city:'虛構市',district:'測試區',channel:'獨立',attr:'原門市文字',contact:'',nextRemember:'原提醒',everyTimeMust:''},[],'qa'));
 b.ops.push(c.revision('person','p',{name:'虛構督導',role:'督導',desc:'原人物筆記',relationshipNotes:'原關係資訊',confirmed:true,sameAs:'',supervisorKey:'fictional'},[],'qa'));
 b.ops.push(c.revision('visit','v',{store:'s',date:'2026-11-01',source:'虛構隔離測試',text:'原筆記，修改後應建立新版本；原文與人物都保留。',next:'原下次跟進',people:['p'],topics:[],attachments:[]},[],'qa'));
 return b;
}
