import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/app-harness.mjs';

async function search(h, query) {
  h.byId('customerSearch').value = query;
  await h.win.renderCustomers();
  return Array.from(h.byId('customerList').querySelectorAll('.card'));
}

test('directory searches order aliases, reordered names and phone fragments using the actual customer card', async t => {
  const h = await harness();
  t.after(h.close);
  h.customers.push(
    { id: 'old', name: '栖原小江', aliases: ['青檐小铺'], phone: '13000005678' },
    { id: 'similar', name: '青檐小辅' }
  );
  const cards = await search(h, '青檐小铺');
  assert.equal(cards[0].querySelector('.stock-card-name').textContent, '栖原小江');
  assert.match(cards[0].textContent, /别名 · 青檐小铺/);
  assert.match(cards[1].textContent, /可能匹配/);
  cards[0].querySelector('.edit-cust').click();
  assert.equal(h.byId('customerModalOverlay').dataset.editId, 'old');
  const canonical = await search(h, '小江，栖原');
  assert.equal(canonical[0].querySelector('.edit-cust').dataset.id, 'old');
  assert.equal((await search(h, '5678'))[0].querySelector('.edit-cust').dataset.id, 'old');
});

test('all partial matches and distinct records with the same literal name stay in directory searches', async t => {
  const h = await harness();
  t.after(h.close);
  for (let i = 0; i < 13; i++) h.customers.push({ id: String(i), name: i < 2 ? '新桥' : `新桥铺${i}` });
  h.customers.push({id:'alias',name:'林记',aliases:['新桥东街']});
  const cards = await search(h, '新桥');
  assert.equal(cards.length, 14);
  assert.deepEqual(cards.slice(0, 2).map(card => card.querySelector('.edit-cust').dataset.id), ['0', '1']);
  assert.equal((await search(h, '完全不相关')).length, 0);
  assert.equal((await search(h, '  ')).length, 14);
});
