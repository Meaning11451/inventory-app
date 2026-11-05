import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickEntry, resolveProducts, parseExcelData, findProduct } from '../js/parser.js';

const products = [
  { id: 'plain', name: '后腿卷', unit: '件' },
  { id: 'one', name: '合胜源一号', unit: '件' },
  { id: 'brick', name: '合胜源后腿砖', unit: '件' },
  { id: 'sku', name: '型号1234567', unit: '箱' },
  { id: 'spaced', name: '精品 五花肉', unit: '斤' }
];
const example = '小寨，田志强\n后腿卷  15件\n\n济南，武\n合胜源后腿卷  20件\n合胜源一号        5件\n合胜源后腿砖    5件\n三胜达后腿卷   10件';

test('customer headings keep all five real-world example items in their groups', () => {
  assert.deepEqual(parseQuickEntry(example, [], products).map(r => [r.rawCustomer, r.rawName, r.quantity, r.unit, r.error]), [
    ['小寨，田志强', '后腿卷', 15, '件', null],
    ['济南，武', '合胜源后腿卷', 20, '件', null],
    ['济南，武', '合胜源一号', 5, '件', null],
    ['济南，武', '合胜源后腿砖', 5, '件', null],
    ['济南，武', '三胜达后腿卷', 10, '件', null]
  ]);
});
test('different brands never match by substring', () => {
  const rows = resolveProducts(parseQuickEntry(example, [], products), products);
  assert.equal(rows[0].product.id, 'plain');
  assert.equal(rows[1].product, null);
  assert.equal(rows[1].needCreate, true);
  assert.equal(rows[4].product, null);
  assert.equal(findProduct('后腿', products), null);
});
test('standalone and inline entries preserve explicit units', () => {
  const rows = parseQuickEntry('后腿卷 15箱\n张三 后腿卷 2.5 公斤', [{ id: 'c', name: '张三' }], products);
  assert.deepEqual(rows.map(r => [r.rawCustomer, r.rawName, r.quantity, r.unit]), [
    ['', '后腿卷', 15, '箱'], ['张三', '后腿卷', 2.5, '公斤']
  ]);
});
test('accepts full-width digits, compact quantities, tabs, thousands and CRLF', () => {
  const rows = parseQuickEntry('济南，武\r\n后腿卷１５件\r\n合胜源一号\t5件\r\n后腿卷 1,000 件', [], products);
  assert.deepEqual(rows.map(r => r.quantity), [15, 5, 1000]);
  assert.ok(rows.every(r => r.rawCustomer === '济南，武' && !r.error));
});
test('numeric customer names and telephone headings do not become quantities', () => {
  const customer = { id: 'c', name: '二号店2' };
  const rows = parseQuickEntry('二号店2\n后腿卷 3\n某地张三13800138000\n后腿卷 2', [customer], products);
  assert.equal(rows[0].customer, customer);
  assert.equal(rows[1].customer._phone, '13800138000');
  assert.equal(rows[1].rawCustomer, '某地张三');
});
test('comma variants of existing customers do not become duplicate customers', () => {
  const customer = { id: 'old', name: '小寨田志强' };
  const [row] = parseQuickEntry('小寨，田志强\n后腿卷 15件', [customer], products);
  assert.equal(row.customer, customer);
});
test('numeric SKUs without quantity remain errors and spaced product names stay whole', () => {
  const rows = parseQuickEntry('型号1234567\n精品 五花肉 5斤', [], products);
  assert.ok(rows[0].error);
  assert.equal(rows[0].quantity, null);
  assert.equal(rows[1].rawName, '精品 五花肉');
  assert.equal(rows[1].rawCustomer, '');
});
test('zero and negative quantities remain visible errors', () => {
  const rows = parseQuickEntry('济南，武\n后腿卷 0件\n后腿卷 -3件', [], products);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.error));
});
test('headerless Excel does not lose the first product row', () => {
  const { parsed } = parseExcelData([['张三', '精品 五花肉', 5, '斤']], [], products);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].quantity, 5);
});
test('Excel rejects missing, zero or partially numeric quantities', () => {
  const { parsed } = parseExcelData([
    ['客户名', '商品名', '数量', '单位'],
    ['张三', '后腿卷', '', '件'], ['张三', '后腿卷', '5箱', '件'],
    ['张三', '后腿卷', 0, '件'], ['张三', '后腿卷', '５', '件']
  ], [], products);
  assert.equal(parsed.length, 4);
  assert.ok(parsed.slice(0, 3).every(r => r.error));
  assert.equal(parsed[3].quantity, 5);
  assert.equal(parsed[3].error, null);
});
