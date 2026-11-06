import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickEntry, resolveProducts, parseExcelData, findProduct, findCustomer, matchingCustomers } from '../js/parser.js';

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
  assert.equal(rows[1].needCreate, false);
  assert.equal(rows[1].needsSelection, true);
  assert.equal(rows[4].product, null);
  assert.equal(findProduct('后腿', products), null);
});
test('standalone and inline entries preserve explicit units', () => {
  const rows = parseQuickEntry('后腿卷 15箱\n张三 后腿卷 2 公斤', [{ id: 'c', name: '张三' }], products);
  assert.deepEqual(rows.map(r => [r.rawCustomer, r.rawName, r.quantity, r.unit]), [
    ['', '后腿卷', 15, '箱'], ['张三', '后腿卷', 2, '公斤']
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

test('fractional quick and Excel quantities remain errors without rounding', () => {
  const [quick] = parseQuickEntry('后腿卷 2.5件', [], products);
  assert.equal(quick.quantity, 2.5);
  assert.match(quick.error, /整数/);
  const { parsed } = parseExcelData([['张三', '后腿卷', 1.01, '件']], [], products);
  assert.equal(parsed[0].quantity, 1.01);
  assert.match(parsed[0].error, /整数/);
});

test('explicit product aliases select the intended brand and keep other brands separate', () => {
  const catalog = [
    {id:'san',name:'三胜达后腿卷',unit:'件',aliases:['后腿卷']},
    {id:'he',name:'合胜源后腿卷',unit:'件',aliases:[]}
  ];
  const resolved = resolveProducts(parseQuickEntry('后腿卷 15件\n合胜源后腿卷 20件', [], catalog), catalog);
  assert.deepEqual(resolved.map(row=>row.product.id), ['san','he']);
  assert.ok(resolved.every(row=>!row.needCreate));
  assert.equal(findProduct('后腿', catalog), null);
  const ambiguous = [...catalog, {id:'other',name:'其他后腿卷',unit:'件',aliases:['后腿卷']}];
  const [row] = resolveProducts(parseQuickEntry('后腿卷 2件', [], ambiguous), ambiguous);
  assert.equal(row.needsSelection, true);
  assert.equal(row.product, null);
  assert.equal(row.needCreate, false);
});

test('customer regions may swap around commas and known aisle addresses may be omitted', () => {
  const customers = [
    {id:'lin',name:'临漳小宋车'}, {id:'ci',name:'小宋车磁县'},
    {id:'hai',name:'海洋金庭3排25号'}, {id:'other',name:'海洋西排39号'}
  ];
  assert.equal(findCustomer('小宋车，临漳', customers).id, 'lin');
  assert.equal(findCustomer('磁县，小宋车', customers).id, 'ci');
  assert.equal(findCustomer('海洋，金庭', customers).id, 'hai');
  assert.equal(findCustomer('海洋', customers), null);
  const parsed = parseQuickEntry('海洋，金庭\n后腿卷 3件', customers, products);
  assert.equal(parsed[0].customer.id, 'hai');
  assert.equal(parsed[0].rawCustomer, '海洋金庭3排25号');
  const duplicates = [...customers, {id:'hai2',name:'海洋金庭5排10号'}];
  assert.equal(matchingCustomers('海洋，金庭', duplicates).length, 2);
  assert.match(parseQuickEntry('海洋，金庭\n后腿卷 3件', duplicates, products)[0].error, /多个客户/);
  assert.equal(findCustomer('海洋金庭3排25号', duplicates).id, 'hai');
});

test('the confirmed shorthand names select different existing catalog items without merging 三号', () => {
  const catalog=[
    {id:'yi',name:'三胜达一号',aliases:['一号','1号'],unit:'件'},
    {id:'snow',name:'谷饲雪花',aliases:['雪花'],unit:'件'},
    {id:'calcium',name:'五斤高钙',aliases:['5斤高钙'],unit:'件'},
    {id:'five',name:'五斤三号',aliases:['5斤三号'],unit:'件'},
    {id:'three',name:'三号',aliases:[],unit:'件'},
    {id:'brick',name:'5斤后腿砖',aliases:['后腿肉砖','五斤后腿砖'],unit:'件'},
    {id:'japan',name:'日式一号',aliases:[],unit:'件'}
  ];
  const input='一号 2件\n雪花 3件\n5斤高钙 4件\n5斤三号 5件\n三号 6件\n后腿肉砖 7件\n日式一号 8件';
  const rows=resolveProducts(parseQuickEntry(input,[],catalog),catalog);
  assert.deepEqual(rows.map(row=>row.product?.id),['yi','snow','calcium','five','three','brick','japan']);
  assert.ok(rows.every(row=>!row.needCreate&&!row.needsSelection));
});

test('chat order punctuation keeps all three products and quantities in the customer group', () => {
  const catalog = [
    {id:'snow',name:'谷饲雪花',aliases:['雪花'],unit:'件'},
    {id:'180',name:'精选180',aliases:['180','180卷'],unit:'件'},
    {id:'five',name:'五斤三号',aliases:['5斤三号'],unit:'件'},
    {id:'other180',name:'牧倍尔精选180',aliases:[],unit:'件'}
  ];
  const input='杰子\n雪花    4件，\n180卷 12件，\n5斤三号8件';
  const rows=resolveProducts(parseQuickEntry(input,[{id:'jie',name:'杰子'}],catalog),catalog);
  assert.deepEqual(rows.map(row=>[row.parsed.rawCustomer,row.product?.id,row.parsed.quantity,row.parsed.error]),[
    ['杰子','snow',4,null],['杰子','180',12,null],['杰子','five',8,null]
  ]);
  assert.equal(rows[0].parsed.rawLine,'雪花    4件，');
});

test('trailing chat punctuation preserves thousands, integer validation and numeric SKU guards', () => {
  const rows=parseQuickEntry('后腿卷 1,000件，\n后腿卷 2件,\n后腿卷 3件。\n后腿卷 4件；\n后腿卷 5件、\n后腿卷 6件， ；\n后腿卷 2.5件，\n后腿卷 -3件，\n型号1234567，',[],products);
  assert.deepEqual(rows.slice(0,6).map(row=>[row.quantity,row.error]),[[1000,null],[2,null],[3,null],[4,null],[5,null],[6,null]]);
  assert.equal(rows[6].quantity,2.5);assert.match(rows[6].error,/整数/);
  assert.equal(rows[7].quantity,-3);assert.match(rows[7].error,/整数/);
  assert.equal(rows[8].quantity,null);assert.ok(rows[8].error);
});

test('optional roll wording reuses known names and aliases while keeping weights and brands distinct', () => {
  const catalog=[
    {id:'180',name:'精选180',aliases:['180'],unit:'件'},
    {id:'other180',name:'牧倍尔精选180',aliases:[],unit:'件'},
    {id:'three',name:'三号',aliases:[],unit:'件'},
    {id:'five',name:'五斤三号',aliases:['5斤三号'],unit:'件'},
    {id:'calcium',name:'高钙',aliases:[],unit:'件'},
    {id:'fiveCalcium',name:'五斤高钙',aliases:['5斤高钙'],unit:'件'}
  ];
  const inputs=['180卷','精选180卷','牧倍尔精选180卷','三号卷','5斤三号卷','高钙卷','5斤高钙卷'];
  assert.deepEqual(inputs.map(name=>findProduct(name,catalog)?.id),['180','180','other180','three','five','calcium','fiveCalcium']);
  assert.equal(findProduct('精选',catalog),null);
  const exact=[...catalog,{id:'literal',name:'180卷',aliases:[],unit:'件'}];
  assert.equal(findProduct('180卷',exact).id,'literal');
  const ambiguous=[...catalog,{id:'duplicate',name:'另一180',aliases:['180'],unit:'件'}];
  assert.equal(findProduct('180卷',ambiguous),null);
});
