import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/app-harness.mjs';
import { WORKSPACE_KEY } from '../js/workspace.js';

const customers = [
  { id: 'a', name: '临漳小宋车' }, { id: 'b', name: '石家庄老王' }, { id: 'c', name: '石家庄老何' }
];
const product = { id: 'p1', name: '后腿卷', unit: '件' };
const entry = (rawCustomer, customer = null) => ({
  product, parsed: { rawCustomer, customer, rawName: product.name, quantity: 1, unit: '件' }
});
const rowChoices = (h, container) => [...h.byId(container).querySelectorAll('.ep-customer-choice')];
function selectCustomer(h, select, id) {
  select.focus();
  select.value = id;
  select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
}

test('quick preview suggests similar names without auto-selecting; one decision fills only matching unselected rows', async t => {
  const h = await harness();
  t.after(h.close);
  h.state.customers = customers;
  h.win.initEntryPreviewGuards();
  const container = 'outboundParsePreview', typo = '临漳小松车';
  h.win.renderParsePreview(container, [entry(typo),entry(typo),entry(typo,customers[1]),entry('未登记'),entry('')], [product]);
  const choices = rowChoices(h,container);
  assert.deepEqual(choices.map(c => c.value), ['', '', 'b', '', '']);
  assert.equal(h.win.collectEditablePreview(container), null);
  assert.equal(choices[0].querySelector('optgroup')?.querySelector('option').value, 'a');
  assert.equal(choices[0].options.length, customers.length + 1);
  selectCustomer(h, choices[0], 'a');
  assert.deepEqual(choices.map(c => c.value), ['a','a','b','','']);
  assert.equal(h.win.collectEditablePreview(container), null);
  selectCustomer(h, choices[3], 'c');
  const items = Array.from(h.win.collectEditablePreview(container));
  assert.deepEqual(items.map(x => x.customerId), ['a','a','b','c',null]);
  assert.deepEqual(items.map(x => x.rawCustomer), [typo,typo,typo,'未登记','']);
  // An edited label must not retain the last selected ID even if the browser failed to send input.
  const input = choices[1].closest('tr').querySelector('.ep-customer');
  input.value = '完全不同的名字';
  assert.equal(h.win.collectEditablePreview(container), null);
  assert.equal(choices[1].value, '');
});

test('daily spreadsheet preview keeps an offline selection by ID, and never silently rebinds a deleted ID', async t => {
  const h = await harness();
  t.after(h.close);
  const container = 'inboundExcelPreview';
  h.win.initEntryPreviewGuards();
  h.win.renderParsePreview(container, [entry('小宋车',customers[0]),entry('')], [product]);
  const [choice,blank] = rowChoices(h,container);
  assert.equal(choice.value, 'a');
  assert.equal(choice.selectedOptions[0].dataset.name, '临漳小宋车');
  h.state.customers = [{id:'a',name:'临漳宋师傅'},customers[1]];
  h.win.refreshPreviewCustomers(h.state.customers);
  assert.equal(choice.selectedOptions[0].dataset.name,'临漳宋师傅');
  selectCustomer(h, blank, 'b');
  assert.equal(h.win.collectEditablePreview(container)[1].customerId,'b');
  h.state.customers = [{id:'replacement',name:'小宋车'},customers[1]];
  h.win.refreshPreviewCustomers(h.state.customers);
  assert.equal(choice.value, '');
  h.win.refreshPreviewCustomers(h.state.customers);
  assert.equal(h.win.collectEditablePreview(container), null);
  selectCustomer(h, choice, 'replacement');
  assert.deepEqual(Array.from(h.win.collectEditablePreview(container), x => x.customerId), ['replacement','b']);
});

test('reopening a quick entry draft books the manually chosen customer even when the pasted name matches someone else', async t => {
  const ledger = { products: [product], customers: [...customers], inbound: [], outbound: [] };
  const first = await harness({}, { ledger });
  let savedDraft;
  try {
    await first.win.initApp();
    await first.win.switchTab('outbound');
    first.win.switchOutboundMode('quick');
    const textarea = first.byId('outboundQuickText');
    textarea.value = '临漳小宋车\n后腿卷 8件';
    textarea.dispatchEvent(new first.win.Event('input', { bubbles: true }));
    await first.win.handleOutboundQuickParse();
    const [choice] = rowChoices(first, 'outboundParsePreview');
    assert.equal(choice.value, 'a');
    selectCustomer(first, choice, 'b');
    savedDraft = first.win.localStorage.getItem(WORKSPACE_KEY);
    assert.equal(ledger.outbound.length, 0);
  } finally {
    first.close();
  }
  const reopened = await harness({}, { ledger, savedStorage: { [WORKSPACE_KEY]: savedDraft } });
  t.after(reopened.close);
  await reopened.win.initApp();
  assert.equal(reopened.state.currentTab, 'outbound');
  assert.equal(rowChoices(reopened, 'outboundParsePreview')[0].value, 'b');
  await reopened.win.handleOutboundQuickSubmit();
  assert.deepEqual(ledger.outbound.map(r => [r.customer_id, r.customer_name, r.product_id, r.quantity]), [
    ['b', '石家庄老王', 'p1', 8]
  ]);
  assert.deepEqual(ledger.customers, customers);
});

test('daily Excel writes no rows or customers if one customer is unresolved or replaced by a namesake before submission', async t => {
  const ledger = { products: [product], customers: [...customers], inbound: [], outbound: [] };
  const h = await harness({}, { ledger });
  t.after(h.close);
  let attemptedWrites = 0;
  for (const method of ['batchCreateInbound','createInbound','createCustomer']) {
    const write = h.api[method];
    h.api[method] = async (...args) => {
      attemptedWrites++;
      return write(...args);
    };
  }
  await h.win.initApp();
  await h.win.switchTab('inbound');
  h.win.switchInboundMode('excel');
  h.win.readExcelFile = async () => [
    ['客户','商品','数量','单位'], ['石家庄老王','后腿卷',3,'件'], ['临漳小松车','后腿卷',4,'件']
  ];
  await h.win.handleInboundExcelImport({ target: { files: [{}] } });
  const choices = rowChoices(h, 'inboundExcelPreview');
  assert.deepEqual(choices.map(c => c.value), ['b','']);
  await h.win.handleInboundExcelSubmit();
  assert.equal(attemptedWrites, 0);
  assert.deepEqual(ledger.inbound, []);
  assert.deepEqual(ledger.customers, customers);

  selectCustomer(h, choices[1], 'a');
  const replacement = { id: 'replacement', name: customers[0].name };
  ledger.customers[0] = replacement;
  await h.win.handleInboundExcelSubmit();
  assert.equal(attemptedWrites, 0);
  assert.deepEqual(ledger.inbound, []);
  assert.deepEqual(ledger.customers, [replacement, ...customers.slice(1)]);
  assert.deepEqual(rowChoices(h, 'inboundExcelPreview').map(c => c.value), ['b','']);
});

test('pending cards cannot shadow the real customer in pasted orders or Excel; they remain in historical filters', async t => {
  const pending = { id: 'duplicate', name: '小宋车，临漳', entry_match_pending: true };
  const unmatched = { id: 'other-duplicate', name: '未知小李', entry_match_pending: true };
  const ledger = { products: [product], customers: [pending, ...customers, unmatched], inbound: [], outbound: [] };
  const h = await harness({}, { ledger });
  t.after(h.close);
  await h.win.initApp();
  const headings = [pending.name, unmatched.name];
  h.byId('outboundQuickText').value = headings.map(name => name + '\n后腿卷 1件').join('\n');
  await h.win.handleOutboundQuickParse();
  h.win.readExcelFile = async () => headings.map(name => [name, '后腿卷', 1, '件']);
  await h.win.handleInboundExcelImport({ target: { files: [{}] } });
  for (const preview of ['outboundParsePreview', 'inboundExcelPreview']) {
    const [resolved, missing] = rowChoices(h, preview);
    assert.equal(resolved.value, 'a');
    assert.equal(missing.value, '');
    missing.focus();
    const offered = [...missing.options].map(o => o.value);
    assert.ok(offered.includes('a'));
    assert.ok(!offered.includes(pending.id) && !offered.includes(unmatched.id));
  }
  await h.win.handleOutboundQuickSubmit();
  await h.win.handleInboundExcelSubmit();
  assert.equal(ledger.outbound.length + ledger.inbound.length, 0);
  await h.win.renderRecords();
  assert.ok([...h.byId('recordCustomerFilter').options].some(option => option.value === pending.id));
  await h.win.renderCustomers();
  assert.ok(h.byId('customerList').textContent.includes(unmatched.name));
});

test('flagging a chosen card while away clears a restored draft and a late change blocks the entire save', async t => {
  const ledger = { products: [product], customers: customers.map(c => ({...c})), inbound: [], outbound: [] };
  const first = await harness({}, { ledger });
  let savedDraft;
  try {
    await first.win.initApp();
    await first.win.switchTab('outbound');
    first.win.switchOutboundMode('quick');
    first.byId('outboundQuickText').value = '石家庄老何\n后腿卷 2件\n临漳小松车\n后腿卷 4件';
    await first.win.handleOutboundQuickParse();
    const choices = rowChoices(first, 'outboundParsePreview');
    selectCustomer(first, choices[1], 'a');
    savedDraft = first.win.localStorage.getItem(WORKSPACE_KEY);
  } finally {
    first.close();
  }
  ledger.customers[0].entry_match_pending = true;
  const reopened = await harness({}, { ledger, savedStorage: { [WORKSPACE_KEY]: savedDraft } });
  t.after(reopened.close);
  await reopened.win.initApp();
  const restored = rowChoices(reopened, 'outboundParsePreview');
  assert.deepEqual(restored.map(c => c.value), ['c','']);
  await reopened.win.handleOutboundQuickSubmit();
  assert.deepEqual(ledger.outbound, []);
  selectCustomer(reopened, restored[1], 'b');
  ledger.customers[1].entry_match_pending = true;
  await reopened.win.handleOutboundQuickSubmit();
  assert.deepEqual(ledger.outbound, []);
  assert.deepEqual(restored.map(c => c.value), ['c','']);
});

test('manual and stock shortcut forms exclude pending cards and reject a choice flagged while the form is open', async t => {
  const ledger = { products: [product], customers: customers.map(c => ({...c})), inbound: [], outbound: [] };
  ledger.customers[0].entry_match_pending = true;
  const h = await harness({}, { ledger });
  t.after(h.close);
  await h.win.initApp();
  await h.win.switchTab('inbound');
  await h.win.openQuickOutModal(product.id, product.name, product.unit);
  for (const elementId of ['inboundCustomer','quickOutCustomer']) {
    const select = h.byId(elementId);
    assert.ok(![...select.options].some(option => option.value === 'a'));
    select.value = 'b';
  }
  h.byId('inboundProduct').value = product.id;
  h.byId('inboundQty').value = '1';
  h.byId('quickOutQty').value = '2';
  ledger.customers[1].entry_match_pending = true;
  await h.win.handleQuickOut();
  await h.win.renderInboundForm();
  assert.equal(h.byId('inboundCustomer').value,'b');
  assert.ok(h.byId('inboundCustomer').selectedOptions[0].disabled);
  await h.win.handleInboundSubmit({ preventDefault() {} });
  assert.equal(ledger.outbound.length + ledger.inbound.length, 0);
});
