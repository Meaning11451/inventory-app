import test from 'node:test';
import assert from 'node:assert/strict';
const tables = {};
const calls = [];
let failure = null;
class Query {
 constructor(table){this.table=table;this.start=0;this.end=999;this.filters=[];this.ops=[];}
 select(){return this;} order(){return this;}
 range(start,end){this.start=start;this.end=end;return this;}
 ilike(field,value){this.filters.push(row=>row[field].includes(value.replaceAll('%','')));return this;}
 in(field,values){this.filters.push(row=>values.includes(row[field]));return this;}
 eq(field,value){this.filters.push(row=>row[field]===value);return this;}
 is(field,value){this.filters.push(row=>row[field]===value);return this;}
 gte(field,value){this.filters.push(row=>row[field]>=value);return this;}
 lte(field,value){this.filters.push(row=>row[field]<=value);return this;}
 or(){this.filters.push(row=>row.note!=='期初库存（管家婆结转）');return this;}
 limit(value){this.end=this.start+value-1;return this;}
 upsert(rows,options){this.write={rows,options};return this;}
 update(fields){this.patch=fields;return this;}
 then(resolve,reject){
   calls.push(this);
   const data=(tables[this.table]||[]).filter(row=>this.filters.every(fn=>fn(row))).slice(this.start,this.end+1);
   if(this.patch && !failure) data.forEach(row=>Object.assign(row,this.patch));
   return Promise.resolve({data:structuredClone(data),error:failure}).then(resolve,reject);
 }
}
globalThis.window = {supabase:{createClient:()=>({from:table=>new Query(table)})}};
const api=await import('../js/supabase.js');
const rows=count=>Array.from({length:count},(_,i)=>({id:String(i).padStart(5,'0'),name:'商品'+i,note:'',recorded_at:'2026-11-06'}));
test('catalogs and daily record totals are not truncated at 200 or 1000 rows',async()=>{
 tables.products=rows(1001);tables.current_stock=rows(1001);tables.customers=rows(1001);tables.inbound_records=rows(1201);tables.outbound_records=rows(1201);
 assert.equal((await api.fetchProducts()).length,1001);
 assert.equal((await api.fetchCurrentStock()).length,1001);
 assert.equal((await api.fetchCustomers()).length,1001);
 assert.equal((await api.fetchInboundRecords({from:'2026-11-06',to:'2026-11-06'})).length,1201);
 assert.equal((await api.fetchOutboundRecords({})).length,1201);
});
test('ordinary record filters exclude opening balances before pagination and respect customer/date',async()=>{
 tables.inbound_records=[...rows(600).map(row=>({...row,note:'期初库存（管家婆结转）'})),{id:'z',name:'业务',note:'',customer_id:'c',recorded_at:'2026-11-06'}];
 const data=await api.fetchInboundRecords({excludeOpening:true,customerId:'c',from:'2026-11-06',to:'2026-11-06'});
 assert.deepEqual(data.map(row=>row.id),['z']);
});
test('query failures propagate instead of reporting an empty successful catalog',async()=>{
 failure=new Error('network down');await assert.rejects(api.fetchProducts(),/network down/);failure=null;
});
test('opening writes ignore duplicate IDs and preserve batch size limits',async()=>{
 calls.length=0;await api.ensureOpeningProducts(rows(401));
 assert.deepEqual(calls.map(call=>call.write.rows.length),[200,200,1]);
 assert.ok(calls.every(call=>call.write.options.onConflict==='id'&&call.write.options.ignoreDuplicates===true));
 calls.length=0;await api.insertOpeningRecords('outbound',rows(201));
 assert.deepEqual(calls.map(call=>call.write.rows.length),[200,1]);
 await assert.rejects(api.insertOpeningRecords('invalid',[]),/无效/);
});

test('daily writes retain caller IDs and ignore duplicates instead of overwriting movements',async()=>{
 calls.length=0;const record={id:'fixed-save',product_id:'p',quantity:4,recorded_at:'2026-11-06'};
 await api.createInbound(record);await api.createOutbound(record);await api.batchCreateInbound([record]);await api.batchCreateOutbound([record]);
 assert.deepEqual(calls.map(call=>call.table),['inbound_records','outbound_records','inbound_records','outbound_records']);
 assert.ok(calls.every(call=>(Array.isArray(call.write.rows)?call.write.rows[0]:call.write.rows).id==='fixed-save'));
 assert.ok(calls.every(call=>call.write.options.ignoreDuplicates===true));
});

test('inventory follows persisted sheet order, including numeric strings and unranked goods', async()=>{
  tables.current_stock = [
    {id:'a',name:'甲',display_order:'3'},
    {id:'z',name:'丙',display_order:'1'},
    {id:'b',name:'乙',display_order:2},
    {id:'u',name:'新商品',display_order:null}
  ];
  assert.deepEqual((await api.fetchCurrentStock()).map(row=>row.id), ['z','b','a','u']);
});

test('product filters run before pagination, combine with dates/customers, and empty IDs cannot query every product',async()=>{
 const selected=rows(1001).map(row=>({...row,product_id:'chosen',customer_id:'c'}));
 const unrelated=rows(700).map(row=>({...row,id:'other'+row.id,product_id:'other',customer_id:'c'}));
 tables.outbound_records=[...unrelated,...selected,{id:'old',product_id:'chosen',customer_id:'c',recorded_at:'2026-11-05'}, {id:'customer',product_id:'chosen',customer_id:'other',recorded_at:'2026-11-06'}];
 const result=await api.fetchOutboundRecords({productIds:['chosen'],from:'2026-11-06',to:'2026-11-06',customerId:'c',excludeOpening:true});
 assert.equal(result.length,1001);assert.ok(result.every(row=>row.product_id==='chosen'));
 assert.equal((await api.fetchOutboundRecords({productId:'other'})).length,700);
 calls.length=0;assert.deepEqual(await api.fetchOutboundRecords({productIds:[]}),[]);assert.equal(calls.length,0);
});

test('editing an old movement updates only its allowed fields and tolerates a lost response',async()=>{
 for(const direction of ['inbound','outbound']) {
   const original={id:'r',product_id:'p1',customer_id:null,customer_name:'原客户（旧名）',quantity:10,note:null,created_at:'2026-11-01T12:00:00Z',recorded_at:'2026-10-25',unit_price:35};
   const originalOther={...original,id:'r2'};
   const table=tables[direction+'_records']=[{...original},{...originalOther}];
   const desired={product_id:'p2',customer_id:'c2',customer_name:'乙',quantity:3};
   const expected={...original,...desired};
   calls.length=0;
   const edited=await api.updateLedgerRecord(direction,original,{...desired,unit_price:0,recorded_at:'2026-11-13',id:'wrong'});
   assert.deepEqual(edited,expected);
   assert.deepEqual(table,[expected,originalOther]);
   assert.equal(calls.length,1);
   assert.deepEqual(calls[0].patch,desired);
   assert.deepEqual(await api.updateLedgerRecord(direction,original,desired),expected);
   assert.deepEqual(table,[expected,originalOther]);
   calls.length=0;
   await api.updateLedgerRecord(direction,edited,desired);
   assert.equal(calls.length,0);
 }
});

test('product or quantity corrections preserve null and blank customer snapshots, including idempotent retries',async()=>{
  for(const customer_id of [null,'c']) for(const customer_name of [null,'']) {
    const original={id:'r',product_id:'p',customer_id,customer_name,quantity:8,note:''};
    tables.outbound_records=[{...original}];
    const target={product_id:'q',quantity:4,customer_id,customer_name};
    const result=await api.updateLedgerRecord('outbound',original,target);
    assert.deepEqual(result,{...original,...target});
    assert.deepEqual(await api.updateLedgerRecord('outbound',original,target),result);
    tables.outbound_records[0].customer_name = customer_name === null ? '' : null;
    await assert.rejects(api.updateLedgerRecord('outbound',original,target),{code:'RECORD_CHANGED'});
    await assert.rejects(api.updateLedgerRecord('outbound',original,{...target,customer_id:'new',customer_name:null}),/选择已有客户/);
  }
});

test('a stale edit cannot overwrite a changed, reclassified or deleted movement',async()=>{
 const original={id:'r',product_id:'p',customer_id:'c',customer_name:'甲',quantity:5,note:'旧备注'};
 const desired={product_id:'p',customer_id:null,customer_name:'',quantity:8};
 for(const changed of [{...original,quantity:6},{...original,customer_id:null},{...original,customer_name:'乙'},
                        {...original,note:'期初库存（管家婆结转）'}, {...original,note:'🔧 盘存'},null]) {
   tables.outbound_records=changed?[structuredClone(changed)]:[];
   await assert.rejects(api.updateLedgerRecord('outbound',original,desired), {code:'RECORD_CHANGED'});
   assert.deepEqual(tables.outbound_records,changed?[changed]:[]);
 }
});

test('protected movements and invalid product, customer or quantity are rejected without a request',async()=>{
 const original={id:'r',product_id:'p',customer_id:null,customer_name:null,quantity:4,note:''};
 const target={product_id:'p',customer_id:null,customer_name:'',quantity:6};
 calls.length=0;
 for(const fields of [{quantity:0},{quantity:0.5},{quantity:10000000000},{product_id:''},
                      {customer_id:'c',customer_name:''},{customer_name:'临时写个名字'}]) {
   await assert.rejects(api.updateLedgerRecord('inbound',original,{...target,...fields}));
 }
 await assert.rejects(api.updateLedgerRecord('unknown',original,target),/无法确定/);
 for(const note of ['期初库存（管家婆结转）','🔧 盘点']) {
   await assert.rejects(api.updateLedgerRecord('inbound',{...original,note},target),/库存页/);
 }
 assert.equal(calls.length,0);
 tables.inbound_records=[{...original}];
 failure=new Error('network down');
 try { await assert.rejects(api.updateLedgerRecord('inbound',original,target),/network down/); }
 finally { failure=null; }
 assert.deepEqual(tables.inbound_records,[original]);
});
