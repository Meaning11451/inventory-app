import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { verifyInventoryBackup, backupFilename, initBackup } from '../js/backup.js';
function snapshot() {
 const tables={products:[{id:'p1',name:'后腿卷',unit:'件',spec:''}],customers:[{id:'c1',name:'测试客户'}],inbound_records:[{id:'in',product_id:'p1',customer_id:'c1',quantity:2.35,note:'原备注',recorded_at:'2026-06-08'}],outbound_records:[{id:'out',product_id:'p1',customer_id:null,customer_name:'已删除客户',quantity:3.15}],current_stock:[{id:'p1',name:'后腿卷',unit:'件',total_inbound:2.35,total_outbound:3.15,stock_qty:-0.8}]};
 return {format:'inventory-app-backup',version:1,kind:'application-data',exported_at:'2026-11-06T01:50:00Z',tables,counts:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length]))};
}
test('backup preserves original IDs, historical dates, notes, quantities and deleted customer names',()=>{
 const backup=snapshot();const original=JSON.stringify(backup);const counts=verifyInventoryBackup(backup);
 assert.equal(counts.inbound_records,1);assert.equal(JSON.stringify(backup),original);
 const loaded=JSON.parse(JSON.stringify(backup));assert.equal(loaded.tables.inbound_records[0].recorded_at,'2026-06-08');assert.equal(loaded.tables.outbound_records[0].customer_name,'已删除客户');
});
test('empty ledgers are valid backups',()=>{
 const backup=snapshot();for(const name of Object.keys(backup.tables)){backup.tables[name]=[];backup.counts[name]=0;}
 assert.equal(verifyInventoryBackup(backup).products,0);
});
test('backup refuses truncated tables, duplicate IDs and broken references',()=>{
 let backup=snapshot();backup.counts.products=2;assert.throws(()=>verifyInventoryBackup(backup),/数量/);
 backup=snapshot();backup.tables.products.push({...backup.tables.products[0]});backup.counts.products++;assert.throws(()=>verifyInventoryBackup(backup),/重复/);
 backup=snapshot();backup.tables.inbound_records[0].product_id='missing';assert.throws(()=>verifyInventoryBackup(backup),/对不上/);
});
test('backup refuses inconsistent inventory totals and missing quantities',()=>{
 let backup=snapshot();backup.tables.current_stock[0].stock_qty=0;assert.throws(()=>verifyInventoryBackup(backup),/库存与流水不一致/);
 backup=snapshot();backup.tables.inbound_records[0].quantity=null;assert.throws(()=>verifyInventoryBackup(backup),/数量/);
});
test('backup filenames use the device local date and include seconds',()=>{
 assert.equal(backupFilename(new Date(2026,10,6,9,5,2)),'进销存账本备份-20261106-090502.json');
});
test('backup button locks while reading, downloads once, and can retry a network failure',async t=>{
 const dom=new JSDOM('<button id="exportBackup">下载完整备份</button><p id="backupStatus"></p>');t.after(()=>dom.window.close());globalThis.document=dom.window.document;
 const button=document.getElementById('exportBackup');const status=document.getElementById('backupStatus');let release;let downloads=[];let first=true;
 initBackup({getPendingCount:async()=>0,api:{exportInventoryBackup:()=>first ? new Promise(resolve=>{release=resolve;}) : Promise.reject(Error('模拟断网'))},download:(content,filename)=>downloads.push({content,filename})});
 button.click();button.click();assert.equal(button.disabled,true);await new Promise(resolve=>setImmediate(resolve));release(snapshot());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(downloads.length,1);assert.equal(JSON.parse(downloads[0].content).tables.products[0].id,'p1');assert.match(status.textContent,/请确认文件已保存/);assert.equal(button.disabled,false);
 first=false;button.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(downloads.length,1);assert.match(status.textContent,/没有修改/);assert.equal(button.disabled,false);
});

test('pending or unreadable local entries stop backup without writing or downloading',async t=>{
 const dom=new JSDOM('<button id="exportBackup">下载完整备份</button><p id="backupStatus"></p>');t.after(()=>dom.window.close());globalThis.document=dom.window.document;
 let count=1,reads=0,downloads=0;
 initBackup({getPendingCount:async()=>{if(count===-1)throw Error('storage unavailable');return count;},api:{exportInventoryBackup:async()=>{reads++;return snapshot();}},download:()=>{downloads++;}});
 const button=document.getElementById('exportBackup');button.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads,0);assert.equal(downloads,0);assert.match(document.getElementById('backupStatus').textContent,/1 条待同步/);
 count=-1;button.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,0);assert.match(document.getElementById('backupStatus').textContent,/无法核对/);
});
test('entries added while cloud data is loading are detected before download',async t=>{
 const dom=new JSDOM('<button id="exportBackup">下载完整备份</button><p id="backupStatus"></p>');t.after(()=>dom.window.close());globalThis.document=dom.window.document;
 let checks=0,downloads=0;
 initBackup({getPendingCount:async()=>checks++===0 ? 0 : 1,api:{exportInventoryBackup:async()=>snapshot()},download:()=>{downloads++;}});
 document.getElementById('exportBackup').click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(checks,2);assert.equal(downloads,0);assert.match(document.getElementById('backupStatus').textContent,/待同步/);
});
