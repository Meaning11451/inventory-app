import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/app-harness.mjs';
import { OPENING_NOTE } from '../js/opening-stock.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const businessDay = '2024-03-08';
const createdAt = '2024-03-08T06:12:04.000Z';

async function records(t) {
  const receipt = {
    id: 'receipt', product_id: 'a', customer_id: 'first', customer_name: '青桥商行',
    quantity: 20, recorded_at: businessDay, created_at: createdAt, unit_price: 23.4, note: '下午收货'
  };
  const sale = { ...receipt, id: 'sale', quantity: 4, unit_price: 25, note: '送到店内' };
  const ledger = {
    products: [{ id: 'a', name: '商品甲', unit: '件' }, { id: 'b', name: '商品乙', unit: '件' }],
    customers: [
      { id: 'first', name: '青桥商行' },
      { id: 'second', name: '西街鲜品', phone: '13900007531', aliases: ['西街铺'] }
    ],
    inbound: [receipt, { ...receipt, id: 'other', product_id: 'b', quantity: 30 }],
    outbound: [sale]
  };
  const h = await harness({}, { ledger });
  t.after(h.close);
  h.api.updateLedgerRecord = async (direction, original, patch) => {
    const rows = ledger[direction];
    const row = rows.find(r => r.id === original.id);
    if (!row || ['product_id','customer_id','customer_name','quantity'].some(key => row[key] !== original[key])) {
      throw Object.assign(new Error('这条记录已发生变化，请重新打开'), { code: 'RECORD_CHANGED' });
    }
    Object.assign(row, patch);
    return { ...row };
  };
  h.win.bindEvents();
  h.win.initEntryPreviewGuards();
  h.state.currentTab = 'records';
  return h;
}

async function open(h, direction, id) {
  h.byId('recordTypeFilter').value = direction;
  await h.win.renderRecords();
  const edit = h.byId('recordList').querySelector(`.record-edit[data-id="${id}"]`);
  assert.ok(edit, 'record has an edit action');
  edit.click();
  await tick();
  assert.ok(h.byId('recordEditDialog').open);
}

async function save(h) {
  h.byId('recordEditSave').click();
  await tick();
}

function chooseCustomer(h, input, id) {
  h.byId('recordEditCustomer').click();
  const search = h.byId('entryCustomerSearch');
  search.value = input;
  search.dispatchEvent(new h.win.Event('input', { bubbles: true }));
  const choice = h.byId('entryCustomerResults').querySelector(`[data-customer-id="${id}"]`);
  assert.ok(choice, 'search includes the desired customer');
  choice.click();
}

async function stock(h) {
  await h.win.renderStock();
  return [...h.byId('stockList').querySelectorAll('.stock-card')]
    .map(card => [card.dataset.productId, Number(card.querySelector('.qty-num').textContent)]);
}

test('editing an old sale reassigns the same record and updates both stock balances and its filtered history', async t => {
  const h = await records(t);
  h.byId('recordTypeFilter').value = 'outbound';
  await h.win.renderRecords();
  h.byId('recordCustomerFilter').value = 'first';
  h.byId('recordFromDate').value = businessDay;
  h.byId('recordToDate').value = businessDay;
  h.byId('recordProductSearch').value = '商品甲';
  const initial = structuredClone(h.outbound[0]);
  await open(h, 'outbound', 'sale');
  assert.equal(h.byId('recordEditProduct').value, 'a');
  assert.equal(h.byId('recordEditQuantity').value, '4');
  assert.match(h.byId('recordEditCustomer').textContent, /青桥商行/);
  h.byId('recordEditProduct').value = 'b';
  h.byId('recordEditQuantity').value = '7';
  chooseCustomer(h, '7531', 'second');
  await save(h);
  assert.equal(h.byId('recordEditDialog').open, false);
  assert.deepEqual(h.outbound, [{...initial, product_id:'b', customer_id:'second', customer_name:'西街鲜品', quantity:7}]);
  assert.equal(h.byId('recordCustomerFilter').value, 'first');
  assert.equal(h.byId('recordProductSearch').value, '商品甲');
  assert.equal(h.byId('recordFromDate').value, businessDay);
  assert.equal(h.byId('recordToDate').value, businessDay);
  assert.equal(h.byId('recordSummary').textContent, '出库 0 条');
  assert.deepEqual(await stock(h), [['a',20],['b',23]]);
  h.byId('recordCustomerFilter').value = 'second';
  h.byId('recordProductSearch').value = '商品乙';
  await h.win.renderRecords();
  assert.equal(h.byId('recordSummary').textContent, '出库 1 条，共 7件');
  assert.match(h.byId('recordList').textContent, /西街鲜品/);
});

test('an old receipt can change product and remove the customer while other receipts and sales keep their values', async t => {
  const h = await records(t);
  const before = structuredClone(h.inbound);
  const sale = structuredClone(h.outbound);
  await open(h, 'inbound', 'receipt');
  h.byId('recordEditProduct').value = 'b';
  h.byId('recordEditQuantity').value = '12';
  h.byId('recordEditCustomer').click();
  h.byId('entryCustomerUnset').click();
  await save(h);
  assert.deepEqual(h.inbound,[{...before[0],product_id:'b',customer_id:null,customer_name:'',quantity:12},before[1]]);
  assert.deepEqual(h.outbound, sale);
  assert.deepEqual(await stock(h), [['a',-4],['b',42]]);
  assert.equal(h.byId('recordSummary').textContent,'入库 2 条，共 42件');
});

test('cancelling, fractional quantities, a failed save, and a stale edit cannot change the ledger', async t => {
  const h = await records(t);
  const original = structuredClone(h.outbound[0]);
  await open(h, 'outbound', 'sale');
  h.byId('recordEditQuantity').value='8';
  h.byId('recordEditCancel').click();
  assert.deepEqual(h.outbound, [original]);
  await open(h, 'outbound', 'sale');
  let writes=0;
  const update=h.api.updateLedgerRecord;
  h.api.updateLedgerRecord=async()=>{writes++;throw Error('网络暂时断开');};
  h.byId('recordEditQuantity').value='2.4';
  await save(h);
  assert.equal(writes,0);
  assert.ok(h.byId('recordEditDialog').open);
  h.byId('recordEditQuantity').value='8';
  await save(h);
  assert.equal(writes,1);
  assert.deepEqual(h.outbound,[original]);
  assert.ok(h.byId('recordEditDialog').open);
  assert.equal(h.byId('recordEditQuantity').value,'8');
  h.api.updateLedgerRecord=update;
  h.outbound[0].quantity=11; // Another device has saved since this editor opened.
  await save(h);
  assert.deepEqual(h.outbound,[{...original,quantity:11}]);
});

test('opening balances and stock corrections are not offered as editable sales or receipts', async t => {
  const h = await records(t);
  h.inbound.push({...h.inbound[0],id:'opening',note:OPENING_NOTE},
    {...h.inbound[0],id:'correction',note:'🔧 日终盘点'});
  await h.win.renderRecords();
  const editIds=[...h.byId('recordList').querySelectorAll('.record-edit')].map(button=>button.dataset.id);
  assert.deepEqual(new Set(editIds),new Set(['receipt','other']));
});
