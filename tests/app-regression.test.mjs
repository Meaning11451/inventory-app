import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/app-harness.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const event = {preventDefault(){}};
test('customer Excel skips a heading row and duplicates in the same import', async t=>{
 const h=await harness();t.after(h.close);
 h.win.readExcelFile=async()=>[['客户名','电话','备注'],['张三','13800138000',''],['张三','13800138000','']];
 await h.win.handleCustomerExcelImport({target:{files:[{}]}});
 await h.win.handleCustomerExcelSubmit();
 assert.deepEqual(h.customers.map(c=>c.name),['张三']);
});
test('editing customer source invalidates its old preview', async t=>{
 const h=await harness();t.after(h.close);h.win.bindEvents();
 h.byId('customerQuickText').value='张三';await h.win.handleCustomerQuickParse();
 h.byId('customerQuickText').value='李四';h.byId('customerQuickText').dispatchEvent(new h.win.Event('input'));
 await h.win.handleCustomerQuickSubmit();assert.equal(h.customers.length,0);
});
test('failed customer imports retain their source and retry only missing customers', async t=>{
 const h=await harness();t.after(h.close);const create=h.api.createCustomer;let first=true;
 h.api.createCustomer=async item=>{if(item.name==='李四'&&first){first=false;throw Error('断网');}return create(item);};
 h.byId('customerQuickText').value='张三\n李四';await h.win.handleCustomerQuickParse();await h.win.handleCustomerQuickSubmit();
 assert.match(h.byId('customerQuickText').value,/李四/);
 await h.win.handleCustomerQuickSubmit();assert.deepEqual(h.customers.map(c=>c.name),['张三','李四']);
});
test('single entry locks while saving and creates one movement on a double submit', async t=>{
 const h=await harness();t.after(h.close);const create=h.api.createInbound;
 h.api.createInbound=async item=>{await new Promise(r=>setTimeout(r,10));return create(item);};
 await h.win.renderInboundForm();h.byId('inboundProduct').value='p1';h.byId('inboundQty').value='15';
 await Promise.all([h.win.handleInboundSubmit(event),h.win.handleInboundSubmit(event)]);assert.equal(h.inbound.length,1);
});
test('returning to an entry form preserves product, customer and chosen business date', async t=>{
 const h=await harness();t.after(h.close);await h.win.renderInboundForm();
 h.byId('inboundProduct').value='p1';h.byId('inboundDate').value='2026-10-30';h.byId('inboundQty').value='7';
 await h.win.renderInboundForm();assert.equal(h.byId('inboundProduct').value,'p1');assert.equal(h.byId('inboundDate').value,'2026-10-30');assert.equal(h.byId('inboundQty').value,'7');
});
test('new and renamed products appear in forms after saving without a reload', async t=>{
 const h=await harness();t.after(h.close);await h.win.loadProducts();h.win.showProductModal();h.byId('productModalName').value='合胜源后腿砖';await h.win.handleProductSave();
 await h.win.renderInboundForm();assert.match(h.byId('inboundProduct').textContent,/合胜源后腿砖/);
});
test('CRUD, stock correction, business filters and deleting a movement update one mock ledger', async t=>{
 const h=await harness();t.after(h.close);
 h.win.showCustomerModal();h.byId('customerModalName').value='济南，武';await h.win.handleCustomerSave();assert.equal(h.customers.length,1);
 await h.win.renderInboundForm();h.byId('inboundProduct').value='p1';h.byId('inboundCustomer').value=h.customers[0].id;h.byId('inboundQty').value='20';await h.win.handleInboundSubmit(event);
 await h.win.renderOutboundForm();h.byId('outboundProduct').value='p1';h.byId('outboundCustomer').value=h.customers[0].id;h.byId('outboundQty').value='3';await h.win.handleOutboundSubmit(event);
 assert.equal((await h.api.fetchProductStock('p1')).stock_qty,17);
 await h.win.openEditModal('p1');h.byId('productModalAdjustQty').value='10';await h.win.handleProductSave();assert.equal((await h.api.fetchProductStock('p1')).stock_qty,10);
 h.byId('recordTypeFilter').value='outbound';h.byId('recordCustomerFilter').innerHTML=`<option value="${h.customers[0].id}">客户</option>`;h.byId('recordCustomerFilter').value=h.customers[0].id;await h.win.renderRecords();assert.match(h.byId('recordList').textContent,/济南，武/);
 await h.api.deleteOutboundRecord(h.outbound[0].id);assert.equal((await h.api.fetchProductStock('p1')).stock_qty,13);
 await assert.rejects(h.api.deleteProduct('p1'),/流水/);
});

test('a lost success response can be retried in the same form without adding stock twice',async t=>{
 const h=await harness();t.after(h.close);const create=h.api.createInbound;let first=true;
 h.api.createInbound=async row=>{const result=await create(row);if(first){first=false;throw Error('response lost');}return result;};
 await h.win.renderInboundForm();h.byId('inboundProduct').value='p1';h.byId('inboundQty').value='11';
 await h.win.handleInboundSubmit(event);assert.equal(h.inbound.length,1);assert.equal(h.byId('inboundQty').value,'11');
 await h.win.handleInboundSubmit(event);assert.equal(h.inbound.length,1);assert.equal(h.byId('inboundQty').value,'');
});
test('daily entries reject excess precision before writing, and failed lookups cannot create duplicate products',async t=>{
 const h=await harness();t.after(h.close);await h.win.renderInboundForm();h.byId('inboundProduct').value='p1';h.byId('inboundQty').value='1.005';await h.win.handleInboundSubmit(event);assert.equal(h.inbound.length,0);
 h.byId('inboundQuickText').value='后腿卷 2件';await h.win.handleInboundQuickParse();
 h.api.fetchProducts=async()=>{throw Error('network down');};
 await h.win.handleInboundQuickSubmit();assert.equal(h.inbound.length,0);assert.equal(h.products.length,1);
});
test('quick entries refuse ambiguous product specifications',async t=>{
 const h=await harness();t.after(h.close);h.products.push({id:'p2',name:'后腿卷',spec:'大箱',unit:'件'});
 h.byId('inboundQuickText').value='后腿卷 2件';await h.win.handleInboundQuickParse();await h.win.handleInboundQuickSubmit();
 assert.equal(h.inbound.length,0);assert.equal(h.products.length,2);
});

test('the actual XLS reader imports customer headers and daily Excel rows through the UI handlers',async t=>{
 const h=await harness();t.after(h.close);
 vm.runInContext(await readFile(new URL('../vendor/xlsx.full.min.js',import.meta.url),'utf8'),h.dom.getInternalVMContext());
 const file=(rows,name)=>{
   const book=h.win.XLSX.utils.book_new();h.win.XLSX.utils.book_append_sheet(book,h.win.XLSX.utils.aoa_to_sheet(rows),'导出数据');
   return new h.win.File([h.win.XLSX.write(book,{type:'array',bookType:'xls'})],name);
 };
 await h.win.handleCustomerExcelImport({target:{files:[file([['客户名','电话','备注'],['济南，武','13800138000','测试']], '客户.xls')]}});
 await h.win.handleCustomerExcelSubmit();assert.deepEqual(h.customers.map(row=>row.name),['济南，武']);
 await h.win.handleInboundExcelImport({target:{files:[file([['客户','商品','数量','单位'],['济南，武','后腿卷',15,'件']], '入库.xls')]}});
 await h.win.handleInboundExcelSubmit();assert.equal(h.inbound.length,1);assert.equal(h.inbound[0].quantity,15);assert.equal(h.inbound[0].customer_name,'济南，武');
});

test('database errors are visible instead of presenting a green connected status',async t=>{
 const h=await harness();t.after(h.close);const fetch=h.api.fetchProducts;
 h.api.fetchProducts=async()=>{throw Error('connection unavailable');};await h.win.renderDashboard();assert.match(h.byId('syncStatus').textContent,/未连接/);
 h.api.fetchProducts=fetch;await h.win.renderDashboard();assert.match(h.byId('syncStatus').textContent,/已连接/);
});

test('selecting another Excel file discards an older read that completes later',async t=>{
 const h=await harness();t.after(h.close);let release;
 h.win.readExcelFile=file=>file.old ? new Promise(resolve=>{release=resolve;}) : Promise.resolve([['客户名','电话','备注'],['新文件客户','','']]);
 const old=h.win.handleCustomerExcelImport({target:{files:[{old:true}]}});
 await h.win.handleCustomerExcelImport({target:{files:[{}]}});
 release([['客户名','电话','备注'],['旧文件客户','','']]);await old;
 assert.match(h.byId('customerExcelPreview').textContent,/新文件客户/);assert.doesNotMatch(h.byId('customerExcelPreview').textContent,/旧文件客户/);
});
