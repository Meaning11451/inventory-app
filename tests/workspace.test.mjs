import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/app-harness.mjs';
import { WORKSPACE_KEY } from '../js/workspace.js';

const input = (h,id,value,type='input') => {
  h.byId(id).value=value;
  h.byId(id).dispatchEvent(new h.win.Event(type,{bubbles:true}));
};
async function restart(h,overrides={}) {
  const savedStorage={[WORKSPACE_KEY]:h.win.localStorage.getItem(WORKSPACE_KEY)};
  const ledger={products:h.products,customers:h.customers,inbound:h.inbound,outbound:h.outbound};
  h.close();
  return harness(overrides,{savedStorage,ledger});
}
async function openQuick(h,direction='outbound') {
  await h.win.initApp();await h.win.switchTab(direction);
  h.win[direction==='outbound'?'switchOutboundMode':'switchInboundMode']('quick');
}

test('a hard restart restores the page, quick mode and latest pasted text without a hide event',async t=>{
 let h=await harness();t.after(()=>h.close());await openQuick(h);
 const text='杰子\n后腿卷 2件';input(h,'outboundQuickText',text);
 h=await restart(h);await h.win.initApp();
 assert.equal(h.state.currentTab,'outbound');
 assert.equal(h.byId('headerTitle').textContent,'出库');
 assert.ok(h.byId('outboundModeQuick').classList.contains('active'));
 assert.equal(h.byId('outboundQuickText').value,text);
 assert.equal(h.outbound.length,0);
 input(h,'outboundQuickText',text+'\n后腿卷 3件');
 h=await restart(h);await h.win.initApp();
 assert.equal(h.byId('outboundQuickText').value,text+'\n后腿卷 3件');
});

test('preview edits, empty units, invalid counts and removed rows survive a hard restart',async t=>{
 let h=await harness();t.after(()=>h.close());
 h.products.push({id:'p2',name:'公斤商品',unit:'公斤',spec:'大包'});
 h.customers.push({id:'a',name:'甲'},{id:'b',name:'乙'});await openQuick(h);
 input(h,'outboundQuickText','甲\n后腿卷 2件\n后腿卷 3件\n后腿卷 4件');
 await h.win.handleOutboundQuickParse();
 const rows=[...h.byId('outboundParsePreview').querySelectorAll('tbody tr')];
 const edit=(selector,value,type='input')=>{
  rows[0].querySelector(selector).value=value;
  rows[0].querySelector(selector).dispatchEvent(new h.win.Event(type,{bubbles:true}));
 };
 edit('.ep-product','p2','change');edit('.ep-customer','乙');edit('.ep-qty','7');edit('.ep-unit','');
 rows[1].querySelector('.ep-remove').click();
 rows[2].querySelector('.ep-qty').value='';rows[2].querySelector('.ep-qty').dispatchEvent(new h.win.Event('input',{bubbles:true}));
 h=await restart(h);await h.win.initApp();
 const restored=[...h.byId('outboundParsePreview').querySelectorAll('tbody tr')];
 assert.equal(restored.length,2);
 assert.equal(restored[0].querySelector('.ep-product').value,'p2');
 assert.equal(restored[0].querySelector('.ep-customer').value,'乙');
 assert.equal(restored[0].querySelector('.ep-qty').value,'7');
 assert.equal(restored[0].querySelector('.ep-unit').value,'');
 assert.equal(restored[1].querySelector('.ep-qty').value,'');
 await h.win.handleOutboundQuickSubmit();assert.equal(h.outbound.length,0);
});

test('editing the original text invalidates its preview durably instead of reviving old quantities',async t=>{
 let h=await harness();t.after(()=>h.close());await openQuick(h);
 input(h,'outboundQuickText','后腿卷 2件');await h.win.handleOutboundQuickParse();
 input(h,'outboundQuickText','后腿卷 9件');
 h=await restart(h);await h.win.initApp();
 assert.equal(h.byId('outboundQuickText').value,'后腿卷 9件');
 assert.equal(h.byId('outboundParsePreview').querySelectorAll('tbody tr').length,0);
 await h.win.handleOutboundQuickSubmit();assert.equal(h.outbound.length,0);
});

test('successful saves clear the durable draft and a subsequent identical order is a new movement',async t=>{
 let h=await harness();t.after(()=>h.close());await openQuick(h,'inbound');
 input(h,'inboundQuickText','后腿卷 2件');await h.win.handleInboundQuickParse();await h.win.handleInboundQuickSubmit();
 assert.equal(h.inbound.length,1);
 h=await restart(h);await h.win.initApp();
 assert.equal(h.byId('inboundQuickText').value,'');
 assert.equal(h.byId('inboundParsePreview').querySelectorAll('tbody tr').length,0);
 input(h,'inboundQuickText','后腿卷 2件');await h.win.handleInboundQuickParse();await h.win.handleInboundQuickSubmit();
 assert.equal(h.inbound.length,2);assert.notEqual(h.inbound[0].id,h.inbound[1].id);
});

test('a saved batch with a lost response retries after restart and midnight without deducting twice',async t=>{
 let h=await harness();t.after(()=>h.close());await openQuick(h);
 h.win.today=()=> '2026-11-08';
 const write=h.api.batchCreateOutbound;
 h.api.batchCreateOutbound=async rows=>{await write(rows);throw Error('response lost');};
 input(h,'outboundQuickText','后腿卷 2件');await h.win.handleOutboundQuickParse();await h.win.handleOutboundQuickSubmit();
 assert.equal(h.outbound.length,1);const firstId=h.outbound[0].id;
 h=await restart(h);h.win.today=()=> '2026-11-09';await h.win.initApp();
 assert.equal(h.outbound.length,1);await h.win.handleOutboundQuickSubmit();
 assert.equal(h.outbound.length,1);assert.equal(h.outbound[0].id,firstId);
 assert.equal(h.outbound[0].recorded_at,'2026-11-08');
 assert.equal(h.byId('outboundQuickText').value,'');
});

test('offline startup keeps the source and selected product for later review without writing',async t=>{
 let h=await harness();t.after(()=>h.close());await openQuick(h);
 input(h,'outboundQuickText','后腿卷 6件');await h.win.handleOutboundQuickParse();
 h=await restart(h,{fetchProducts:async()=>{throw Error('offline');},fetchCustomers:async()=>{throw Error('offline');}});
 await h.win.initApp();
 assert.equal(h.state.currentTab,'outbound');assert.equal(h.byId('outboundQuickText').value,'后腿卷 6件');
 assert.equal(h.byId('outboundParsePreview').querySelector('.ep-product').value,'p1');
 await h.win.handleOutboundQuickSubmit();assert.equal(h.outbound.length,0);
});

test('a deleted product in a restored preview requires selection and is never recreated',async t=>{
 let h=await harness();t.after(()=>h.close());await openQuick(h);
 input(h,'outboundQuickText','后腿卷 6件');await h.win.handleOutboundQuickParse();h.products.splice(0);
 h=await restart(h);await h.win.initApp();
 assert.equal(h.byId('outboundParsePreview').querySelector('.ep-product').value,'');
 await h.win.handleOutboundQuickSubmit();assert.equal(h.outbound.length,0);assert.equal(h.products.length,0);
});

test('a parsed daily Excel preview survives without the original file being selected again',async t=>{
 let h=await harness();t.after(()=>h.close());await h.win.initApp();await h.win.switchTab('inbound');h.win.switchInboundMode('excel');
 h.win.readExcelFile=async()=>[['客户','商品','数量','单位'],['','后腿卷',5,'件']];
 await h.win.handleInboundExcelImport({target:{files:[{}]}});
 h=await restart(h);await h.win.initApp();
 assert.ok(h.byId('inboundModeExcel').classList.contains('active'));
 assert.equal(h.byId('inboundExcelFile').files.length,0);
 assert.equal(h.byId('inboundExcelPreview').querySelector('.ep-qty').value,'5');
 assert.equal(h.inbound.length,0);await h.win.handleInboundExcelSubmit();assert.equal(h.inbound[0].quantity,5);
});

test('slow initialization does not send a user back home after they already opened quick entry',async t=>{
 const h=await harness();t.after(h.close);let release;
 h.win.getPendingCount=()=>new Promise(resolve=>{release=resolve;});const startup=h.win.initApp();
 await h.win.switchTab('outbound');h.win.switchOutboundMode('quick');input(h,'outboundQuickText','后腿卷 3件');
 release(0);await startup;
 assert.equal(h.state.currentTab,'outbound');assert.equal(h.byId('headerTitle').textContent,'出库');
 assert.equal(h.byId('outboundQuickText').value,'后腿卷 3件');
});

test('invalid saved data or blocked local storage cannot break entry and storage failure is visible',async t=>{
 const h=await harness({}, {savedStorage:{[WORKSPACE_KEY]:'broken json'}});t.after(h.close);
 Object.defineProperty(h.win,'localStorage',{get(){throw Error('blocked');}});
 await openQuick(h);input(h,'outboundQuickText','后腿卷 3件');
 assert.equal(h.byId('outboundQuickText').value,'后腿卷 3件');
 assert.match(h.byId('toastContainer').textContent,/本机无法保存录入草稿/);
 assert.equal([...h.byId('toastContainer').querySelectorAll('.toast')].filter(e=>e.textContent.includes('本机无法保存录入草稿')).length,1);
});
