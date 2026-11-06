import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningStock, prepareOpeningPlan, checkOpeningRecords, openingRowErrors, importOpeningStock, OPENING_NOTE } from '../js/opening-stock.js';

const headings = ['行号', '商品编号', '商品名称', '单位', '库存数量', '成本均价', '库存金额', '期初数量'];
const report = [ ['库存状况'], ['商    品'], ['仓   库'], ['公司名称'], ['公司地址'], ['公司电话'], ['公司邮箱'], [], headings, [1, '', '测试冻品', '', -3, 50, -150, 800] ];

function memoryApi() {
  const products = [], inbound = [], outbound = [];
  let failNegative = false;
  return {
    products, inbound, outbound,
    set failNegative(value) { failNegative = value; },
    async fetchProducts() { return structuredClone(products); },
    async fetchCurrentStock() { return products.map(product => {
      const total_inbound = inbound.filter(row => row.product_id === product.id).reduce((sum, row) => sum + row.quantity, 0);
      const total_outbound = outbound.filter(row => row.product_id === product.id).reduce((sum, row) => sum + row.quantity, 0);
      return { ...product, total_inbound, total_outbound, stock_qty: total_inbound - total_outbound };
    }); },
    async fetchOpeningRecords(ids) { return [...inbound.filter(row => ids.includes(row.id)).map(row => ({ ...row, direction: 'inbound' })), ...outbound.filter(row => ids.includes(row.id)).map(row => ({ ...row, direction: 'outbound' }))]; },
    async ensureOpeningProducts(rows) { for (const row of rows) if (!products.some(product => product.id === row.id)) products.push(structuredClone(row)); },
    async insertOpeningRecords(direction, rows) {
      if (direction === 'outbound' && failNegative) { failNegative = false; throw new Error('模拟网络失败'); }
      const table = direction === 'inbound' ? inbound : outbound;
      for (const row of rows) if (!table.some(existing => existing.id === row.id)) table.push(structuredClone(row));
    }
  };
}

test('locates the real ninth-row header and uses current quantity, not old opening quantity', () => {
  const result = parseOpeningStock(report);
  assert.equal(result.headerRow, 9);
  assert.deepEqual(result.items[0], { sourceRow: 10, code: '', name: '测试冻品', spec: '', unit: '', quantity: -3 });
  assert.ok(openingRowErrors(result.items[0]).includes('请填写单位'));
});
test('skips empty rows, repeated page headers and labelled totals; preserves zero and negative', () => {
  const result = parseOpeningStock([headings, [1, '001', '甲', '件', 0], [], headings, [2, '002', '乙', '件', '-2'], ['合计', '', '', '', -2]]);
  assert.deepEqual(result.items.map(row => row.quantity), [0, -2]);
  assert.equal(result.skippedSummaryRows, 1);
});
test('rejects history reports and duplicated stock headers', () => {
  assert.throws(() => parseOpeningStock([['日期', '单据编号', '单位名称', '金额']]), /没有找到/);
  assert.throws(() => parseOpeningStock([['商品名称', '库存数量', '库存数量']]), /重复/);
});
test('missing quantities stay missing and precision is validated', () => {
  const { items } = parseOpeningStock([headings, [1, '', '甲', '件', ''], [2, '', '乙', '件', '1,000.25'], [3, '', '丙', '件', '1.234']]);
  assert.equal(items[0].quantity, null);
  assert.equal(items[1].quantity, 1000.25);
  assert.ok(openingRowErrors(items[1]).some(error=>error.includes('整数')));
  assert.ok(openingRowErrors(items[2]).length);
});
test('blocks duplicate goods, ambiguous existing names and incompatible units', async () => {
  const rows = [{ sourceRow: 1, name: '冻品', spec: '', unit: '箱', quantity: 5 }];
  const plan = await prepareOpeningPlan([...rows, ...rows], [{ id: 'a', name: '冻品', spec: '', unit: '件' }], []);
  assert.ok(plan[0].errors.some(error => error.includes('单位')));
  assert.ok(plan[1].errors.some(error => error.includes('多行')));
});
test('rejects existing business even when net stock is zero', async () => {
  const rows = [{ sourceRow: 1, name: '冻品', unit: '件', quantity: 5 }];
  const plan = await prepareOpeningPlan(rows, [{ id: 'a', name: '冻品', unit: '件' }], [{ id: 'a', stock_qty: 0, total_inbound: 5, total_outbound: 5 }]);
  assert.ok(checkOpeningRecords(plan, [])[0].errors.some(error => error.includes('已有进出库')));
});
test('imports positive, zero and confirmed negative balances with no duplicate on retry', async () => {
  const api = memoryApi();
  const rows = [12, 0, -3].map((quantity, i) => ({ sourceRow: i + 1, name: `商品${i}`, unit: '件', quantity }));
  await assert.rejects(importOpeningStock(rows, '2026-11-06', { api }), /负库存/);
  assert.equal(api.products.length, 0);
  const first = await importOpeningStock(rows, '2026-11-06', { api, allowNegative: true });
  assert.equal(first.imported, 3);
  assert.equal(api.inbound.length, 1);
  assert.equal(api.outbound.length, 1);
  assert.equal(api.inbound[0].note, OPENING_NOTE);
  const second = await importOpeningStock(rows, '2026-11-06', { api, allowNegative: true });
  assert.equal(second.imported, 1); // zero stock creates no ledger movement and is harmless to repeat
  assert.equal(second.skipped, 2);
  assert.deepEqual((await api.fetchCurrentStock()).map(row => row.stock_qty), [12, 0, -3]);
});
test('recovers a partial network failure without adding the successful positive rows again', async () => {
  const api = memoryApi();
  const rows = [{ sourceRow: 1, name: '甲', unit: '件', quantity: 10 }, { sourceRow: 2, name: '乙', unit: '件', quantity: -2 }];
  api.failNegative = true;
  await assert.rejects(importOpeningStock(rows, '2026-11-06', { api, allowNegative: true }), /模拟网络失败/);
  assert.equal(api.inbound.length, 1);
  await importOpeningStock(rows, '2026-11-06', { api, allowNegative: true });
  assert.equal(api.inbound.length, 1);
  assert.equal(api.outbound.length, 1);
  assert.deepEqual((await api.fetchCurrentStock()).map(row => row.stock_qty), [10, -2]);
});
test('does not overwrite a prior opening with a different quantity or create writes for invalid dates', async () => {
  const api = memoryApi();
  const row = { sourceRow: 10, name: '测试冻品', unit: '件', quantity: 8 };
  await assert.rejects(importOpeningStock([row], '2026-02-30', { api }), /结转日期/);
  await assert.rejects(importOpeningStock([row], '2026-99-99', { api }), /结转日期/);
  await importOpeningStock([row], '2026-11-06', { api });
  await assert.rejects(importOpeningStock([{ ...row, quantity: 9 }], '2026-11-06', { api }), /不能再次覆盖/);
  assert.equal(api.inbound[0].quantity, 8);
});

test('a renamed product cannot be mistaken for a new import with a colliding reserved ID', async () => {
  const row = { sourceRow: 1, name: '原名称', unit: '件', quantity: 1 };
  const [first] = await prepareOpeningPlan([row], [], []);
  const [next] = await prepareOpeningPlan([row], [{ ...first.product, name: '修改后名称' }], []);
  assert.ok(next.errors.some(error => error.includes('改过名称')));
});
test('concurrent copies of the same import converge on one opening movement', async () => {
  const api = memoryApi();
  const rows = [{ sourceRow: 10, name: '并发测试', unit: '件', quantity: 7 }];
  await Promise.all([importOpeningStock(rows, '2026-11-06', { api }), importOpeningStock(rows, '2026-11-06', { api })]);
  assert.equal(api.products.length, 1);
  assert.equal(api.inbound.length, 1);
});
