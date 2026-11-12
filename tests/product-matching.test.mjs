import test from 'node:test';
import assert from 'node:assert/strict';
import {findProduct, matchingProducts, searchProducts, parseQuickEntry, resolveProducts} from '../js/parser.js';
const catalog=[
 {id:'s',name:'伊羴尚品后腿',unit:'件',aliases:[]},
 {id:'g',name:'五斤高钙',unit:'件',aliases:[]},
 {id:'c',name:'高钙',unit:'件',aliases:[]},
 {id:'m',name:'牧倍尔精选180',unit:'件',aliases:[]},
 {id:'h',name:'六斤合胜源高钙',unit:'件',aliases:[]}
];
test('detailed omitted brand prefixes work without an alias, including pasted quantities and trailing punctuation',()=>{
 for(const name of ['尚品后腿','尚品后腿卷','尚品 后腿'])assert.equal(findProduct(name,catalog)?.id,'s');
 const [row]=resolveProducts(parseQuickEntry('杰子\n尚品后腿 4件，',[],catalog),catalog);
 assert.equal(row.product.id,'s');assert.equal(row.parsed.quantity,4);assert.equal(row.parsed.error,null);
});
test('weight number variants do not require per-product aliases or merge weights',()=>{
 assert.equal(findProduct('5斤高钙',catalog)?.id,'g');assert.equal(findProduct('高钙',catalog)?.id,'c');
 assert.equal(findProduct('6斤合胜源高钙卷',catalog)?.id,'h');
 assert.equal(findProduct('合胜源高钙',catalog),null);assert.equal(findProduct('精选180',catalog),null);
 assert.equal(findProduct('后腿',[catalog[0]]),null);
 assert.equal(findProduct('5斤高钙',[{id:'x',name:'十五斤高钙'}]),null);
});
test('ambiguous suffixes require selection and literal full names always win',()=>{
 const ambiguous=[...catalog,{id:'other',name:'另一尚品后腿',unit:'件'}];
 assert.equal(matchingProducts('尚品后腿',ambiguous).length,2);assert.equal(findProduct('尚品后腿',ambiguous),null);
 assert.equal(findProduct('尚品后腿',[...ambiguous,{id:'literal',name:'尚品后腿'}])?.id,'literal');
});
test('search can suggest partial and alias matches while save matching stays conservative',()=>{
 const data=[...catalog,{id:'snow',name:'谷饲雪花',aliases:['雪花']},{id:'snow2',name:'雪花上脑'}];
 assert.deepEqual(searchProducts('后腿',data).map(p=>p.id),['s']);
 assert.deepEqual(searchProducts('５斤高钙',data).map(p=>p.id),['g']);
 assert.deepEqual(searchProducts('雪花',data).map(p=>p.id),['snow','snow2']);
 assert.equal(findProduct('后腿',data),null);
});

