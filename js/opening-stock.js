// Initial balances use reserved ledger IDs, so retrying cannot add stock twice.
export const OPENING_NOTE = '期初库存（管家婆结转）';
const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const unitKey = value => ({ kg: '公斤', '千克': '公斤', g: '克' })[key(value)] || key(value);
const headerNames = {
  name: ['商品名称', '商品全名', '品名'],
  quantity: ['库存数量', '当前库存', '现有库存'],
  unit: ['单位', '基本单位'],
  code: ['商品编号', '商品编码'],
  spec: ['规格', '规格型号', '商品规格']
};

export function isOpeningRecord(record) { return record?.note === OPENING_NOTE; }

export function parseStockQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').normalize('NFKC').trim();
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) return null;
  const result = Number(text.replace(/,/g, ''));
  return Number.isFinite(result) ? result : null;
}

export function openingRowErrors(row) {
  const errors = [];
  if (!String(row.name ?? '').trim()) errors.push('请填写商品名称');
  if (!String(row.unit ?? '').trim()) errors.push('请填写单位');
  if (row.quantity === null || !Number.isFinite(row.quantity)) errors.push('库存数量必须是数字，空白不视为零');
  else if (!Number.isSafeInteger(row.quantity)) errors.push('库存数量必须是整数');
  else if (Math.abs(row.quantity) > 9999999999) errors.push('库存数量过大');
  return errors;
}

export function parseOpeningStock(rows) {
  if (!Array.isArray(rows)) throw new Error('无法读取库存表');
  const headerIndex = rows.findIndex(row => {
    const cells = row.map(key);
    return headerNames.name.some(name => cells.includes(name)) && headerNames.quantity.some(name => cells.includes(name));
  });
  if (headerIndex < 0) throw new Error('没有找到“商品名称”和“库存数量”表头。请选择管家婆的“库存状况”导出表，不要选择经营历程或进出库明细。');
  const header = rows[headerIndex].map(key);
  const columns = {};
  for (const [field, aliases] of Object.entries(headerNames)) {
    const matches = header.flatMap((value, index) => aliases.includes(value) ? [index] : []);
    if (matches.length > 1) throw new Error(`表头中有重复的${aliases[0]}列，请保留一列后再导入`);
    columns[field] = matches[0] ?? -1;
  }
  const items = [];
  let skippedSummaryRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index] || [];
    if (row.every(value => String(value ?? '').trim() === '')) continue;
    if (headerNames.name.includes(key(row[columns.name])) && headerNames.quantity.includes(key(row[columns.quantity]))) continue;
    if (/^(合计|总计|小计|本页合计|本页小计)$/.test(key(row[0])) && !String(row[columns.name] ?? '').trim()) { skippedSummaryRows++; continue; }
    const cell = field => columns[field] < 0 ? '' : String(row[columns[field]] ?? '').trim();
    items.push({ sourceRow: index + 1, code: cell('code'), name: cell('name'), spec: cell('spec'), unit: cell('unit'), quantity: parseStockQuantity(row[columns.quantity]) });
  }
  if (!items.length) throw new Error('找到了库存表头，但下面没有商品明细。请确认已查询出商品库存后再导出。');
  return { items, headerRow: headerIndex + 1, skippedSummaryRows };
}

async function stableId(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function prepareOpeningPlan(rows, products, stocks) {
  const stockMap = new Map(stocks.map(stock => [stock.id, stock]));
  const identities = new Set();
  const plan = [];
  for (const source of rows) {
    const row = { ...source, name: String(source.name ?? '').trim(), spec: String(source.spec ?? '').trim(), unit: String(source.unit ?? '').trim() };
    const errors = openingRowErrors(row);
    const identity = `${key(row.name)}\0${key(row.spec)}`;
    if (identities.has(identity)) errors.push('同一商品和规格出现多行，请先核对并合并数量；不同商品请补充规格区分');
    identities.add(identity);
    const matches = products.filter(product => key(product.name) === key(row.name) && key(product.spec) === key(row.spec));
    if (matches.length > 1) errors.push('系统中有多个同名同规格商品，请先整理商品资料');
    const existing = matches.length === 1 ? matches[0] : null;
    if (!existing && !row.spec && products.some(product => key(product.name) === key(row.name))) errors.push('系统中存在这个名称的带规格商品，请补充规格后再匹配');
    if (existing && unitKey(existing.unit) !== unitKey(row.unit)) errors.push(`系统商品单位为“${existing.unit}”，请核对单位和数量`);
    const product = existing || { id: await stableId(`inventory-product:v1:${identity}`), name: row.name, spec: row.spec, unit: row.unit };
    if (!existing && products.some(saved => saved.id === product.id)) errors.push('这个商品曾经登记后改过名称或规格，请先在商品资料中核对，不能另建期初库存');
    const openingId = await stableId(`inventory-opening:v1:${product.id}`);
    plan.push({ ...row, product, openingId, isNew: !existing, stock: stockMap.get(product.id), errors, status: errors.length ? 'error' : 'ready' });
  }
  return plan;
}

export function checkOpeningRecords(plan, records) {
  const byId = new Map();
  for (const record of records) {
    const matches = byId.get(record.id) || [];
    matches.push(record);
    byId.set(record.id, matches);
  }
  return plan.map(item => {
    const errors = [...item.errors];
    const matches = byId.get(item.openingId) || [];
    let status = item.status;
    if (!errors.length && matches.length) {
      const record = matches[0];
      const signed = record.direction === 'inbound' ? Number(record.quantity) : -Number(record.quantity);
      if (matches.length !== 1 || !isOpeningRecord(record) || record.product_id !== item.product.id || signed !== item.quantity) errors.push('该商品已结转过不同的期初库存，不能再次覆盖；后续变化请用正常进出库或盘点调整');
      else status = 'skip';
    } else if (!errors.length && !item.isNew) {
      if (!item.stock) errors.push('无法核验这个商品的现有库存，请刷新后重试');
      else if (Number(item.stock.total_inbound) !== 0 || Number(item.stock.total_outbound) !== 0 || Number(item.stock.stock_qty) !== 0) errors.push('该商品已有进出库记录，不能再叠加期初库存');
    }
    return { ...item, errors, status: errors.length ? 'error' : status };
  });
}

export async function loadOpeningPlan(rows, api) {
  const [products, stocks] = await Promise.all([api.fetchProducts(), api.fetchCurrentStock()]);
  const plan = await prepareOpeningPlan(rows, products, stocks);
  const records = await api.fetchOpeningRecords(plan.map(item => item.openingId));
  return checkOpeningRecords(plan, records);
}

function validateDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('请选择有效的结转日期');
}

export async function importOpeningStock(rows, date, options) {
  validateDate(date);
  const { api, allowNegative = false, onProgress = () => {} } = options;
  const plan = await loadOpeningPlan(rows, api);
  const invalid = plan.find(item => item.errors.length);
  if (invalid) throw new Error(`原表第 ${invalid.sourceRow} 行：${invalid.errors.join('；')}`);
  if (!allowNegative && plan.some(item => item.status === 'ready' && item.quantity < 0)) throw new Error('存在负库存，请先核对并勾选负库存确认');
  const ready = plan.filter(item => item.status === 'ready');
  onProgress(`核验完成，准备结转 ${ready.length} 个商品`);
  if (ready.length) {
    const newProducts = ready.filter(item => item.isNew).map(item => item.product);
    if (newProducts.length) await api.ensureOpeningProducts(newProducts);
    // Recheck after preparing products, including another browser's completed import.
    const rechecked = await loadOpeningPlan(rows, api);
    const conflict = rechecked.find(item => item.errors.length);
    if (conflict) throw new Error(`原表第 ${conflict.sourceRow} 行：${conflict.errors.join('；')}`);
    const remaining = rechecked.filter(item => item.status === 'ready');
    const record = item => ({ id: item.openingId, product_id: item.product.id, quantity: Math.abs(item.quantity), customer_id: null, customer_name: '', note: OPENING_NOTE, unit_price: null, recorded_at: date });
    const inbound = remaining.filter(item => item.quantity > 0).map(record);
    const outbound = remaining.filter(item => item.quantity < 0).map(record);
    if (inbound.length) { onProgress('正在保存正数期初库存'); await api.insertOpeningRecords('inbound', inbound); }
    if (outbound.length) { onProgress('正在保存负数期初库存'); await api.insertOpeningRecords('outbound', outbound); }
    const confirmed = await api.fetchOpeningRecords(remaining.filter(item => item.quantity !== 0).map(item => item.openingId));
    const verified = checkOpeningRecords(remaining, confirmed);
    if (verified.some(item => item.quantity !== 0 && item.status !== 'skip')) throw new Error('尚未确认所有库存已保存，请保留清单并重试；已完成的商品会自动跳过');
    return { imported: remaining.length, skipped: rechecked.length - remaining.length, zero: remaining.filter(item => item.quantity === 0).length };
  }
  return { imported: 0, skipped: plan.length, zero: 0 };
}
