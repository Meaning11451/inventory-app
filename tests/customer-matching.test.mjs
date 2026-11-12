import test from 'node:test';
import assert from 'node:assert/strict';
import { findCustomer, matchingCustomers, suggestedCustomers, parseQuickEntry, parseExcelData } from '../js/parser.js';

const ledger = [
  {id:'a',name:'柳桥青松车',aliases:['老青松']},
  {id:'b',name:'青松车（西街）'},
  {id:'c',name:'桃园青叶第３排第１２号'}
];
const ids = rows => rows.map(row => row.id);

test('either the order or the catalog may separate location and name, including round brackets and space', () => {
  assert.equal(findCustomer('青松车 / 柳桥', ledger)?.id, 'a');
  assert.equal(findCustomer('柳桥  青松车。', ledger)?.id, 'a');
  assert.equal(findCustomer('西街青松车', ledger)?.id, 'b');
  assert.equal(findCustomer('青叶·桃园', ledger)?.id, 'c');
  assert.equal(findCustomer('桃园青叶3排12号', ledger)?.id, 'c');
  assert.equal(findCustomer('桃园青叶3排11号', ledger), null);
  assert.equal(findCustomer('青松车柳桥', ledger), null);
  assert.equal(suggestedCustomers('青松车柳桥', ledger)[0].id, 'a');
});

test('verified aliases can resolve an order but conflicting aliases or other canonicals need review', () => {
  const conflicts=[...ledger,{id:'d',name:'老，青松',aliases:['另一家']},{id:'e',name:'安宁小铺',aliases:['老青松']}];
  assert.equal(findCustomer('老青松', ledger)?.id, 'a');
  assert.equal(findCustomer('老青松', conflicts), null);
  assert.deepEqual(ids(matchingCustomers('老青松', conflicts)).sort(), ['a','d','e']);
  assert.equal(findCustomer('老，青松', conflicts)?.id, 'd');
  const aliasConflict=[...ledger,{id:'other',name:'样例商铺',aliases:['西街青松车']}];
  assert.equal(findCustomer('西街青松车', aliasConflict), null);
  assert.equal(findCustomer('1-23饼铺',[{id:'x',name:'12-3饼铺'}]),null);
});

test('partial and mistyped names suggest candidates without assigning an order', () => {
  for(const query of ['柳桥青淞车','柳桥青车','柳桥松青车','青松车']) {
    assert.equal(findCustomer(query,ledger),null);
    assert.ok(ids(suggestedCustomers(query,ledger)).includes('a'),query);
  }
  assert.deepEqual(ids(suggestedCustomers('青松车',ledger)).sort(), ['a','b']);
  assert.equal(findCustomer('青松车',ledger), null);
  assert.deepEqual(suggestedCustomers('车',ledger), []);
  assert.deepEqual(suggestedCustomers('   ',ledger), []);
  assert.deepEqual(suggestedCustomers('完全无关',ledger), []);
  assert.equal(findCustomer('张', [{id:'z',name:'张1排2号'}]), null);
});

test('rank the shared name or nickname ahead of a common delivery route without auto-selecting it', () => {
  const route = Array.from({length:12}, (_, i) => ({id:`route-${i}`,name:`柳桥车商铺${i}`}));
  const people = [{id:'east',name:'东堤林木乔'}, {id:'west',name:'西堤林木乔'}];
  const roster = [...route, ...people, {id:'nickname',name:'南堤苗苗'}];
  for (const input of ['柳桥车，林木乔','林木乔 / 柳桥车']) {
    assert.equal(findCustomer(input,roster),null);
    assert.deepEqual(ids(suggestedCustomers(input,roster)).slice(0,2),['east','west']);
  }
  assert.equal(findCustomer('柳桥车，苗苗',roster),null);
  assert.equal(suggestedCustomers('柳桥车，苗苗',roster)[0].id,'nickname');
  assert.deepEqual(suggestedCustomers('小，车',roster),[]);
});

test('numeric stall headings with uncertain names start a new group instead of transferring their rows to the previous buyer', () => {
  const products=[{id:'p',name:'商品甲',unit:'件'}];
  const rows=parseQuickEntry('柳桥青松车\n商品甲 1件\n桃园青叶3排11号\n商品甲 2件',ledger,products);
  assert.equal(rows.length,2);
  assert.equal(rows[0].customer?.id,'a');
  assert.equal(rows[1].customer,null);
  assert.equal(rows[1].rawCustomer,'桃园青叶3排11号');
  const parsedExcel=parseExcelData([['客户','商品','数量'],['老青松','商品甲',3],['柳桥青淞车','商品甲',4]],ledger,products);
  assert.equal(parsedExcel.resolved[0].customer?.id,'a');
  assert.equal(parsedExcel.resolved[1].customer,null);
});
