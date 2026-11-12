import { findCustomer, matchingCustomers, isCustomerStallHeading } from './customer-match.js';
export { findCustomer, matchingCustomers, suggestedCustomers } from './customer-match.js';

// Matching rules are shared by parsing, preview, and saving.
const UNITS = '公斤|千克|kg|克|g|件|个|箱|包|斤|两|吨|盒|袋|桶|瓶|把|条|块|片|卷|只|双|套|台|辆|支|根|颗|粒|对|打|盘|筐|笼|提|板';
const QUANTITY = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const normalizeDigits = text => text.replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const nameKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const productKey = name => nameKey(name).replace(/(?<![零一二两三四五六七八九十百])[一二两三四五六七八九十](?=斤)/g,
  digit => ({一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10})[digit]);

export function matchingProducts(name, products = []) {
  const literal=nameKey(name);
  const key=productKey(name);
  if (!key) return [];
  const exact = products.filter(product=>nameKey(product.name)===literal);
  if (exact.length) return exact;
  const equivalent = products.filter(product=>productKey(product.name)===key);
  if (equivalent.length) return equivalent;
  const aliases = products.filter(product =>
    Array.isArray(product.aliases) && product.aliases.some(alias=>productKey(alias)===key));
  if (aliases.length) return aliases;
  // Chat orders may append 卷 to an existing name or alias. Keep brand and weight;
  // never remove a meaningful form such as 砖 or guess an arbitrary substring.
  const base = key.endsWith('卷') && !/[卷砖块]卷$/.test(key) ? key.slice(0, -1) : key;
  const withoutRoll = products.filter(product => productKey(product.name) === base ||
    (Array.isArray(product.aliases) && product.aliases.some(alias=>productKey(alias)===base)));
  if (withoutRoll.length) return withoutRoll;
  // A detailed suffix can omit a brand prefix (尚品后腿 → 伊羴尚品后腿).
  // Short generic words and omitted weights/numeric specifications cannot select stock.
  if ((base.match(/[\u3400-\u9fff]/g) || []).length < 4) return [];
  return products.filter(product => {
    const full = productKey(product.name);
    if (!full.endsWith(base)) return false;
    const omitted = full.slice(0, -base.length);
    return omitted && !/\d|斤|公斤|千克|kg|克|号/.test(omitted);
  });
}

// Search may show several candidates; only findProduct may automatically select one.
export function searchProducts(name, products = []) {
  const key = productKey(name);
  if (!key) return products;
  const preferred = matchingProducts(name, products);
  return [...preferred, ...products.filter(product => !preferred.includes(product) &&
    [product.name, ...(Array.isArray(product.aliases) ? product.aliases : [])]
      .some(value => productKey(value).includes(key)))];
}
export function findProduct(name, products = []) {
  const matches=matchingProducts(name,products);
  return matches.length === 1 ? matches[0] : null;
}

function parseProductLine(text, products) {
  const line = normalizeDigits(text).replace(/[\s，,、;；。]+$/, '');
  if (findProduct(line, products)) return null;
  const patterns = [
    new RegExp(`^(.+?)(?:\\s+|[，,、;；:：]\\s*)(${QUANTITY})\\s*(${UNITS})?\\s*$`, 'i'),
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

function splitCustomerAndProduct(name, products) {
  // A complete product name, including a name shared by two specifications,
  // can contain spaces. Let the product picker resolve specifications.
  if (matchingProducts(name, products).length) return { productName: name };
  let lastSplit;
  for (const separator of name.matchAll(/[\s，,、;；:：]+/gu)) {
    const customerName = name.slice(0, separator.index).trim();
    const productName = name.slice(separator.index + separator[0].length).trim();
    if (!customerName || !productName) continue;
    lastSplit = { customerName, productName };
    // Try the longest product suffix first. The whole prefix is the customer,
    // even when its first word already matches a known delivery-route alias.
    if (matchingProducts(productName, products).length) return lastSplit;
  }
  return lastSplit || { productName: name };
}

/** A customer heading applies until the next heading; standalone product lines also work. */
export function parseQuickEntry(text, customers = [], products = []) {
  const results = [];
  let currentCustomer = null;
  let currentCustomerText = '';
  function selectCustomer(text, matched = null, phone = null) {
    currentCustomerText = phone?.name || text;
    currentCustomer = matched || findCustomer(currentCustomerText, customers) || (phone ? { _phone: phone.phone } : null);
  }
  String(text ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((rawLine, lineIndex) => {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line) return;
    const heading = line.replace(/^客户\s*[:：]\s*/, '').replace(/[:：]\s*$/, '').trim();
    const customerMatches = matchingCustomers(heading, customers);
    const knownCustomer = customerMatches.length === 1 ? customerMatches[0] : null;
    const phone = findProduct(line, products) ? null : phoneHeader(heading);
    const productLine = parseProductLine(line, products);
    const explicitHeading = /^客户\s*[:：]/.test(line) || /[:：]$/.test(line);
    const stallHeading = isCustomerStallHeading(heading);
    if (customerMatches.length || phone || explicitHeading ||
        (!productLine && (stallHeading || !/\d/.test(normalizeDigits(line))) && !findProduct(line, products))) {
      selectCustomer(heading, knownCustomer, phone);
      return;
    }
    const split = productLine ? splitCustomerAndProduct(productLine.name, products) : null;
    if (split?.customerName) {
      selectCustomer(split.customerName, null, phoneHeader(split.customerName));
    }
    const customerName = currentCustomer?.name || currentCustomerText;
    const quantity = productLine?.quantity ?? null;
    results.push({
      rawCustomer: customerName,
      ...(currentCustomer?.id && currentCustomerText !== customerName ? { originalCustomer: currentCustomerText } : {}),
      customer: currentCustomer,
      rawName: split?.productName || line,
      quantity,
      unit: productLine?.unit || null,
      lineIndex,
      rawLine: line,
      error: matchingCustomers(customerName, customers).length > 1 ? '客户名称对应多个客户，请补充完整名称或地址' : !productLine ? '无法识别数量，请使用：商品名 数量 单位' : !Number.isSafeInteger(quantity) || quantity <= 0 ? '数量必须是大于 0 的整数' : null
    });
  });
  return results;
}

export function resolveProducts(parsedLines, existingProducts = []) {
  return parsedLines.map(parsed => {
    const matches = matchingProducts(parsed.rawName, existingProducts);
    const product = matches.length === 1 ? matches[0] : null;
    return { parsed, product, needCreate: false, needsSelection: !product, suggestedUnit: parsed.unit || product?.unit || '件' };
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
    const error = matchingCustomers(customerName, customers).length > 1 ? '客户名称对应多个客户，请补充完整名称或地址' : !Number.isSafeInteger(quantity) || quantity <= 0 ? '数量必须是大于 0 的整数' : null;
    const parsed = {
      rawCustomer: customer?.name || customerName, customer, rawName: productName,
      ...(customer?.id && customerName !== customer.name ? { originalCustomer: customerName } : {}),
      quantity: Number.isFinite(quantity) ? quantity : null, unit: unit || null,
      lineIndex: index + offset, rawLine: row.join(' | '), error
    };
    resolved.push({
      parsed, product, customer, needCreate: false, needsSelection: !product, suggestedUnit: unit || product?.unit || '件',
      unitPrice: priceText && Number.isFinite(Number(priceText)) ? Number(priceText) : null,
      note: String(row[5] ?? '').trim()
    });
  });
  return { parsed: resolved.map(r => r.parsed), resolved };
}
