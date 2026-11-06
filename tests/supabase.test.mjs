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
 gte(field,value){this.filters.push(row=>row[field]>=value);return this;}
 lte(field,value){this.filters.push(row=>row[field]<=value);return this;}
 or(){this.filters.push(row=>row.note!=='期初库存（管家婆结转）');return this;}
 limit(value){this.end=this.start+value-1;return this;}
 upsert(rows,options){this.write={rows,options};return this;}
 then(resolve,reject){
   calls.push(this);
   const data=(tables[this.table]||[]).filter(row=>this.filters.every(fn=>fn(row))).slice(this.start,this.end+1);
   return Promise.resolve({data,error:failure}).then(resolve,reject);
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
