import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExcelData, parseQuickEntry, resolveProducts } from '../js/parser.js';

const customers = [
  { id: 'route', name: '任师傅', aliases: ['货拉拉', '任林'] },
  { id: 'known', name: '货拉拉高峰' },
  { id: 'next', name: '东城小宋' }
];
const products = [{ id: 'roll', name: '后腿卷' }, { id: 'boxed', name: '精选 大盒 后腿卷' }];
const preview = (text, catalog = products) => resolveProducts(parseQuickEntry(text, customers, catalog), catalog);

test('the known product bounds the whole customer label in inline entries, including new recipients', () => {
  for (const separator of [' ', '，', '、', ':']) {
    const name = ['货拉拉', '新店客人'].join(separator);
    const [row] = preview([name, '后腿卷', '2件'].join(separator));
    assert.equal(row.product.id, 'roll');
    assert.equal(row.parsed.rawCustomer, name);
    assert.equal(row.parsed.customer?.id, undefined);
  }
});

test('mixed inline and grouped customer orders carry the latest full customer label', () => {
  const rows = preview('货拉拉\n后腿卷 2件\n货拉拉 新店客人 后腿卷 3件\n后腿卷 4件\n小宋，东城\n精选 大盒 后腿卷 5件');
  assert.deepEqual(rows.map(row => [row.parsed.customer?.id, row.product.id]), [
    [undefined, 'roll'], [undefined, 'roll'], [undefined, 'roll'], ['next', 'boxed']
  ]);
  assert.equal(rows[2].parsed.rawCustomer, '货拉拉 新店客人');
});

test('a whole catalog name wins over internal separators and ambiguous specifications stay with the product picker', () => {
  const catalog = products.concat({id:'boxed2', name:'精选 大盒 后腿卷', spec:'大箱'});
  const rows = preview('精选 大盒 后腿卷 1件\n货拉拉 高峰 精选 大盒 后腿卷 2件', catalog);
  assert.equal(rows[0].parsed.rawCustomer, '');
  assert.equal(rows[1].parsed.customer.id, 'known');
  assert.ok(rows.every(row => row.parsed.rawName === '精选 大盒 后腿卷' && row.product === null));
});

test('preview keeps original customer wording across headings, inline entries and Excel', () => {
  const [heading, inline, withPhone] = preview('任林\n后腿卷 2件\n高峰，货拉拉，后腿卷 2件\n货拉拉 高峰 13800138000 后腿卷 3件');
  const [excel] = parseExcelData([['任林','后腿卷',2,'件']], customers, products).parsed;
  for (const row of [heading.parsed, excel]) {
    assert.equal(row.rawCustomer, '任师傅');
    assert.equal(row.originalCustomer, '任林');
  }
  assert.equal(inline.parsed.originalCustomer, '高峰，货拉拉');
  assert.equal(withPhone.parsed.customer.id, 'known');
  assert.equal(withPhone.parsed.originalCustomer, '货拉拉 高峰');
});
