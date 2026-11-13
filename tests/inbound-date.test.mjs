import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/app-harness.mjs';
import { WORKSPACE_KEY } from '../js/workspace.js';

const businessDay = '2024-02-29';
const entryDay = '2024-03-01';

function setLocalClock(h, day) {
  const BrowserDate = h.win.Date;
  h.win.Date = class extends BrowserDate {
    constructor(...args) { super(...(args.length ? args : [2024, 2, day, 0, 5])); }
  };
}

async function newTab(h, day, tab) {
  setLocalClock(h, day);
  await h.win.initApp();
  await h.win.switchTab(tab);
}

function yesterday(h, field) {
  assert.equal(h.byId(field).value, entryDay);
  const button = h.win.document.querySelector(`[data-yesterday-for="${field}"]`);
  assert.ok(button, 'there is a yesterday button next to the business date');
  button.click();
  assert.equal(h.byId(field).value, businessDay);
}

test('manual receipt and the stock shortcut save the selected calendar date and reset for the next receipt', async t => {
  const h = await harness();
  t.after(h.close);
  await newTab(h, 1, 'inbound');
  yesterday(h, 'inboundDate');
  h.byId('inboundProduct').value = 'p1';
  h.byId('inboundQty').value = '3';
  await h.win.handleInboundSubmit({preventDefault() {}});
  assert.equal(h.byId('inboundDate').value, entryDay);
  await h.win.switchTab('stock');
  await h.win.openQuickInModal('p1', '后腿卷', '件');
  yesterday(h, 'quickInDate');
  h.byId('quickInQty').value = '4';
  await h.win.handleQuickIn();
  assert.deepEqual(h.inbound.map(row => [row.quantity, row.recorded_at]), [[3, businessDay], [4, businessDay]]);
  await h.win.openQuickInModal('p1', '后腿卷', '件');
  assert.equal(h.byId('quickInDate').value, entryDay);
});

for (const mode of ['quick', 'excel']) {
  test(`the ${mode} receipt date survives a restart and a lost response without creating duplicate receipts`, async t => {
    let h = await harness();
    t.after(() => h.close());
    await newTab(h, 1, 'inbound');
    h.win.switchInboundMode(mode);
    const field = mode === 'quick' ? 'inboundQuickDate' : 'inboundExcelDate';
    const submit = mode === 'quick' ? 'handleInboundQuickSubmit' : 'handleInboundExcelSubmit';
    yesterday(h, field);
    if (mode === 'quick') {
      const input = h.byId('inboundQuickText');
      input.value = '后腿卷 2件\n后腿卷 5件';
      input.dispatchEvent(new h.win.Event('input', {bubbles:true}));
      await h.win.handleInboundQuickParse();
    } else {
      h.win.readExcelFile = async () => [['客户','商品','数量'], ['', '后腿卷', 2], ['', '后腿卷', 5]];
      await h.win.handleInboundExcelImport({target:{files:[{}]}});
    }
    const write = h.api.batchCreateInbound;
    h.api.batchCreateInbound = async rows => { await write(rows); throw Error('response lost'); };
    await h.win[submit]();
    assert.deepEqual(h.inbound.map(row => [row.quantity, row.recorded_at]), [[2,businessDay],[5,businessDay]]);
    const saved = structuredClone(h.inbound);
    const storage = {[WORKSPACE_KEY]: h.win.localStorage.getItem(WORKSPACE_KEY)};
    const ledger = {products:h.products, customers:h.customers, inbound:h.inbound, outbound:h.outbound};
    h.close();
    h = await harness({}, {savedStorage:storage, ledger});
    setLocalClock(h, 2);
    await h.win.initApp();
    assert.equal(h.byId(field).value, businessDay);
    await h.win[submit]();
    assert.deepEqual(h.inbound, saved);
    assert.equal(h.byId(field).value, '2024-03-02');
  });
}
