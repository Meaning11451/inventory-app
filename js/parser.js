// Matching rules are shared by parsing, preview, and saving.
const UNITS = '公斤|千克|kg|克|g|件|个|箱|包|斤|两|吨|盒|袋|桶|瓶|把|条|块|片|卷|只|双|套|台|辆|支|根|颗|粒|对|打|盘|筐|笼|提|板';
const QUANTITY = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const normalizeDigits = text => text.replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const nameKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function findProduct(name, products = []) {
  const exact = products.find(p => p.name === name);
  if (exact) return exact;
  const key = nameKey(name);
  const matches = key ? products.filter(p => nameKey(p.name) === key) : [];
  return matches.length === 1 ? matches[0] : null;
}

export function findCustomer(name, customers = []) {
  const exact = customers.find(c => c.name === name);
  if (exact) return exact;
  const key = nameKey(name).replace(/,/g, '');
  const matches = key ? customers.filter(c => nameKey(c.name).replace(/,/g, '') === key) : [];
  return matches.length === 1 ? matches[0] : null;
}

function parseProductLine(text, products) {
  if (findProduct(text, products)) return null;
  const line = normalizeDigits(text);
  const patterns = [
    new RegExp(`^(.+?)(?:\\s+|[，,:：]\\s*)(${QUANTITY})\\s*(${UNITS})?\\s*$`, 'i'),
    new RegExp(`^(.+?)(${QUANTITY})\\s*(${UNITS})\\s*$`, 'i'),
    new RegExp(`^(.+?[^\\d\\s])(${QUANTITY})$`, 'i')
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) return { name: match[1].trim(), quantity: Number(match[2].replace(/,/g, '')), unit: match[3] || null };
  }
  return null;
}

function phoneHeader(text) {
  const match = normalizeDigits(text).match(/^(.+?)[\s，,]*((?:1[3-9]\d{9})|(?:\d{3,4}-\d{7,8}))\s*$/);
  return match ? { name: match[1].replace(/[\s，,]+$/, ''), phone: match[2] } : null;
}

function splitCustomerAndProduct(name, customers, products, grouped) {
  if (findProduct(name, products)) return { productName: name, customer: null };
  const parts = name.split(/\s+/);
  for (let i = parts.length - 1; i > 0; i--) {
    const customer = findCustomer(parts.slice(0, i).join(' '), customers);
    if (customer) return { customerName: customer.name, customer, productName: parts.slice(i).join(' ') };
  }
  if (!grouped) {
    for (let i = 1; i < parts.length; i++) {
      const productName = parts.slice(i).join(' ');
      if (findProduct(productName, products)) return { customerName: parts.slice(0, i).join(' '), customer: null, productName };
    }
    if (parts.length > 1) return { customerName: parts[0], customer: null, productName: parts.slice(1).join(' ') };
  }
  return { productName: name, customer: null };
}

/** A customer heading applies until the next heading; standalone product lines also work. */
export function parseQuickEntry(text, customers = [], products = []) {
  const results = [];
  let currentCustomer = null;
  let currentCustomerName = '';
  String(text ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((rawLine, lineIndex) => {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line) return;
    const heading = line.replace(/^客户\s*[:：]\s*/, '').replace(/[:：]\s*$/, '').trim();
    const knownCustomer = findCustomer(heading, customers);
    const phone = findProduct(line, products) ? null : phoneHeader(heading);
    const productLine = parseProductLine(line, products);
    const explicitHeading = /^客户\s*[:：]/.test(line) || /[:：]$/.test(line);
    if (knownCustomer || phone || explicitHeading || (!productLine && !/\d/.test(normalizeDigits(line)) && !findProduct(line, products))) {
      currentCustomerName = knownCustomer?.name || phone?.name || heading;
      currentCustomer = knownCustomer || findCustomer(currentCustomerName, customers) || (phone ? { _phone: phone.phone, _isNew: true } : null);
      return;
    }
    const split = productLine ? splitCustomerAndProduct(productLine.name, customers, products, Boolean(currentCustomerName)) : null;
    const customerName = split?.customerName ?? currentCustomerName;
    const quantity = productLine?.quantity ?? null;
    results.push({
      rawCustomer: customerName,
      customer: split?.customer || (split?.customerName ? findCustomer(customerName, customers) : currentCustomer),
      rawName: split?.productName || line,
      quantity,
      unit: productLine?.unit || null,
      lineIndex,
      rawLine: line,
      error: !productLine ? '无法识别数量，请使用：商品名 数量 单位' : !Number.isFinite(quantity) || quantity <= 0 ? '数量必须大于 0' : null
    });
  });
  return results;
}

export function resolveProducts(parsedLines, existingProducts = []) {
  return parsedLines.map(parsed => {
    const product = parsed.error ? null : findProduct(parsed.rawName, existingProducts);
    return { parsed, product, needCreate: !parsed.error && !product, suggestedUnit: parsed.unit || product?.unit || '件' };
  });
}

/** Columns: customer, product, quantity, unit, legacy price, note. */
export function parseExcelData(rows, customers = [], products = []) {
  if (!rows?.length) return { parsed: [], resolved: [] };
  const headerPattern = /^(客户(?:名|名称)?|姓名|商品(?:名|名称)?|品名|数量|件数|单位|单价|备注|日期)$/;
  const hasHeader = rows[0].filter(cell => headerPattern.test(String(cell ?? '').trim())).length >= 2;
  const offset = hasHeader ? 1 : 0;
  const resolved = [];
  rows.slice(offset).forEach((row, index) => {
    if (!row || row.every(c => String(c ?? '').trim() === '')) return;
    const customerName = String(row[0] ?? '').trim();
    const productName = String(row[1] ?? '').trim();
    const quantityText = normalizeDigits(String(row[2] ?? '')).trim().replace(/[,，]/g, '');
    const quantity = quantityText ? Number(quantityText) : NaN;
    const unit = String(row[3] ?? '').trim();
    const priceText = String(row[4] ?? '').trim();
    const customer = findCustomer(customerName, customers);
    const product = findProduct(productName, products);
    const error = !productName ? '缺少商品名' : !Number.isFinite(quantity) || quantity <= 0 ? '数量必须是大于 0 的数字' : null;
    const parsed = {
      rawCustomer: customer?.name || customerName, customer, rawName: productName,
      quantity: Number.isFinite(quantity) ? quantity : null, unit: unit || null,
      lineIndex: index + offset, rawLine: row.join(' | '), error
    };
    resolved.push({
      parsed, product, customer, needCreate: !error && !product, suggestedUnit: unit || product?.unit || '件',
      unitPrice: priceText && Number.isFinite(Number(priceText)) ? Number(priceText) : null,
      note: String(row[5] ?? '').trim()
    });
  });
  return { parsed: resolved.map(r => r.parsed), resolved };
}
