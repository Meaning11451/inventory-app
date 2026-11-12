import test from 'node:test';
import assert from 'node:assert/strict';
import { findCustomer, suggestedCustomers } from '../js/parser.js';

const roster = [
  { id: 'old', name: '陈舟', aliases: ['北湾', '北门专线', '北门专线，陈'] },
  { id: 'bay', name: '北湾青禾商店' },
  { id: 'truck', name: '北门专线田家铺' },
  { id: 'person', name: '宋禾' },
  { id: 'receiver', name: '松河车章沐风' }
];

test('a shared location or a delivery service alone requires a choice; the remembered recipient is suggested first', () => {
  for (const short of ['北湾', '北 湾', '北门专线']) {
    assert.equal(findCustomer(short, roster), null);
    assert.equal(suggestedCustomers(short, roster)[0].id, 'old');
  }
  assert.equal(findCustomer('北门专线，陈', roster)?.id, 'old');
  assert.equal(findCustomer('北湾青禾商店', roster)?.id, 'bay');
  const carrier = { id: 'carrier', name: '星禾物流', aliases: ['配送'] };
  assert.equal(findCustomer('星禾物流', [carrier]), carrier);
  assert.equal(findCustomer('配送', [carrier]), null);
});

test('an unseen truck and recipient combination can use the whole recipient, with or without punctuation', () => {
  for (const name of ['北门专线，宋禾', '宋禾 / 北门专线', '北门专线宋禾', '新村配送 宋禾']) {
    assert.equal(findCustomer(name, roster)?.id, 'person', name);
  }
  assert.equal(findCustomer('新村车，章沐风', roster)?.id, 'receiver');
  assert.equal(findCustomer('北门专线，钱师傅', roster), null);
  assert.equal(findCustomer('北门专线，宋', roster), null);
});

test('same-name people or a different location keep the order open with the plausible recipients ahead of the route', () => {
  const sameName = [...roster, { id: 'second', name: '西岸宋禾' }];
  assert.equal(findCustomer('北门专线宋禾', sameName), null);
  assert.deepEqual(suggestedCustomers('北门专线宋禾', sameName).slice(0, 2).map(c => c.id), ['person','second']);
  assert.equal(findCustomer('北湾，章沐风', roster), null);
  assert.equal(suggestedCustomers('北湾章沐风', roster)[0].id, 'receiver');
  assert.equal(findCustomer('北门专线，田家镇', roster), null);
});

test('a route alone never qualifies a suggestion for an explicitly different recipient; a close recipient name can qualify', () => {
  const people = [...roster, { id: 'teacher', name: '赵师傅' }];
  for (const unknown of ['北门专线，许师傅', '北门专线，汪远亭', '北门专线汪远亭', '北门专线，汪']) {
    assert.equal(findCustomer(unknown, people), null);
    assert.deepEqual(suggestedCustomers(unknown, people), [], unknown);
  }
  const typo = '新村车，章沐枫';
  assert.equal(findCustomer(typo, people), null);
  assert.deepEqual(suggestedCustomers(typo, people).map(c => c.id), ['receiver']);
  assert.equal(suggestedCustomers('北门专线', people)[0].id, 'old');
});
