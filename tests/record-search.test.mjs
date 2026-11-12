import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/app-harness.mjs';

const ledger = () => ({
  products: [
    {id:'shang',name:'伊羴尚品后腿',unit:'件',aliases:[]},
    {id:'other',name:'牧倍尔后腿',unit:'件',aliases:[]},
    {id:'five',name:'五斤高钙',unit:'件',aliases:['5斤高钙']}
  ],
  customers:[{id:'c1',name:'张三'},{id:'c2',name:'李四'}],
  inbound:[{id:'in',product_id:'shang',quantity:20,recorded_at:'2026-11-12'}],
  outbound:[
    {id:'a',product_id:'shang',quantity:4,customer_id:'c1',customer_name:'张三',recorded_at:'2026-11-12'},
    {id:'b',product_id:'other',quantity:8,customer_id:'c1',customer_name:'张三',recorded_at:'2026-11-12'},
    {id:'c',product_id:'shang',quantity:2,customer_id:'c2',customer_name:'李四',recorded_at:'2026-11-11'}
  ]
});
test('record search accepts detailed shorthand and combines product, customer, direction and dates', async t => {
  const h=await harness({}, {ledger:ledger()});t.after(h.close);
  h.byId('recordTypeFilter').value='outbound';
  h.byId('recordProductSearch').value='尚品后腿';await h.win.renderRecords();
  assert.match(h.byId('recordList').textContent,/伊羴尚品后腿/);
  assert.doesNotMatch(h.byId('recordList').textContent,/牧倍尔/);
  assert.equal(h.byId('recordSummary').textContent,'出库 2 条，共 6件');
  h.byId('recordCustomerFilter').value='c1';h.byId('recordFromDate').value='2026-11-12';h.byId('recordToDate').value='2026-11-12';
  await h.win.renderRecords();assert.equal(h.byId('recordSummary').textContent,'出库 1 条，共 4件');
  h.byId('recordTypeFilter').value='inbound';h.byId('recordCustomerFilter').value='';
  await h.win.renderRecords();assert.equal(h.byId('recordSummary').textContent,'入库 1 条，共 20件');
});
test('broad search lists candidates, specific selection survives refresh and clear restores all products', async t => {
  const h=await harness({}, {ledger:ledger()});t.after(h.close);h.win.bindEvents();
  h.byId('recordTypeFilter').value='outbound';h.byId('recordProductSearch').value='后腿';await h.win.renderRecords();
  assert.equal(h.byId('recordProductFilter').options.length,3);
  assert.equal(h.byId('recordSummary').textContent,'出库 3 条，共 14件');
  h.byId('recordProductFilter').value='other';await h.win.renderRecords();await h.win.renderRecords();
  assert.equal(h.byId('recordProductFilter').value,'other');assert.equal(h.byId('recordSummary').textContent,'出库 1 条，共 8件');
  h.byId('recordClearFilters').click();await new Promise(r=>setTimeout(r,0));
  assert.equal(h.byId('recordProductSearch').value,'');assert.equal(h.byId('recordProductFilter').value,'');
  assert.equal(h.byId('recordSummary').textContent,'出库 3 条，共 14件');
});
test('unknown product, reversed dates and failed loads never display unrelated successful results',async t=>{
  const h=await harness({}, {ledger:ledger()});t.after(h.close);
  h.byId('recordProductSearch').value='不存在';await h.win.renderRecords();
  assert.equal(h.byId('recordSummary').textContent,'未找到匹配商品');assert.equal(h.byId('recordList').getAttribute('aria-busy'),'false');
  h.byId('recordProductSearch').value='';h.byId('recordFromDate').value='2026-11-13';h.byId('recordToDate').value='2026-11-12';await h.win.renderRecords();
  assert.match(h.byId('recordSummary').textContent,/开始日期不能/);assert.equal(h.byId('recordList').textContent,'');
  h.byId('recordFromDate').value='';h.byId('recordToDate').value='';h.api.fetchInboundRecords=async()=>{throw Error('offline');};await h.win.renderRecords();
  assert.equal(h.byId('recordSummary').textContent,'记录加载失败');assert.ok(h.byId('recordList').querySelector('.record-retry'));
});
test('an older response cannot overwrite a newer search or its loading state',async t=>{
  const h=await harness({}, {ledger:ledger()});t.after(h.close);await h.win.renderRecords();
  let release;const fetch=h.api.fetchOutboundRecords;
  h.api.fetchOutboundRecords=options=>options.productIds?.[0]==='shang'
    ? new Promise(resolve=>{release=()=>resolve([{product_id:'shang',products:h.products[0],quantity:99,recorded_at:'2026-11-12'}]);}) : fetch(options);
  h.byId('recordTypeFilter').value='outbound';h.byId('recordProductSearch').value='尚品后腿';const old=h.win.renderRecords();
  await new Promise(r=>setTimeout(r,0));h.byId('recordProductSearch').value='牧倍尔';await h.win.renderRecords();
  release();await old;assert.equal(h.byId('recordSummary').textContent,'出库 1 条，共 8件');assert.doesNotMatch(h.byId('recordList').textContent,/伊羴/);
});
