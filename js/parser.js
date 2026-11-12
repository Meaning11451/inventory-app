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

const stallAddress = /(?:第)?\d+排(?:第)?\d+号$/u;
const customerSeparators = /[\s,、;:·•/()\[\]【】.。—-]+/u;

function customerNameParts(name) {
  return String(name ?? '').normalize('NFKC').toLowerCase().split(customerSeparators).filter(Boolean);
}

function joinedCustomerName(parts) {
  // Keep numeric groups distinct: a stall such as 1-23 must not collapse into 12-3.
  return parts.reduce((key, part) => key + (/\d$/.test(key) && /^\d/.test(part) ? '-' : '') + part, '')
    .replace(/第?(\d+)排第?(\d+)号$/u, '$1排$2号');
}

function customerNameForms(parts) {
  const key = joinedCustomerName(parts);
  if (parts.length === 2 && parts.every(part => /\p{L}/u.test(part))) {
    return [key, joinedCustomerName([parts[1], parts[0]])];
  }
  return [key];
}

function customerNames(customer) {
  return [customer.name, ...(Array.isArray(customer.aliases) ? customer.aliases : [])].filter(Boolean);
}

function matchesCustomerForms(input, stored) {
  return stored.some(key => {
    if (input.includes(key)) return true;
    const withoutAddress = key.replace(stallAddress, '');
    return key !== withoutAddress && withoutAddress.length >= 2 && input.includes(withoutAddress);
  });
}

export function matchingCustomers(name, customers = []) {
  const parts = customerNameParts(name);
  if (!parts.length) return [];
  const exact = customers.filter(customer => customer.name === name);
  if (exact.length) return exact;
  const input = customerNameForms(parts);
  const normalized = [];
  const aliases = [];
  const contextual = [];
  for (const customer of customers) {
    const canonical = customerNameForms(customerNameParts(customer.name));
    if (canonical[0] === input[0]) normalized.push(customer);
    else if (matchesCustomerForms(input, canonical)) contextual.push(customer);
    if (Array.isArray(customer.aliases) && customer.aliases.some(alias =>
      matchesCustomerForms(input, customerNameForms(customerNameParts(alias))))) aliases.push(customer);
  }
  return [...new Set([...(normalized.length ? normalized : contextual), ...aliases])];
}

export function findCustomer(name, customers = []) {
  const matches = matchingCustomers(name, customers);
  return matches.length === 1 ? matches[0] : null;
}

// Only suggestions use typo tolerance. One missing, different, or transposed character
// can be a different person; the order must never be assigned based on that alone.
function oneNameEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let index = 0;
  while (index < a.length && a[index] === b[index]) index++;
  if (a.length > b.length) return a.slice(index + 1) === b.slice(index);
  if (b.length > a.length) return a.slice(index) === b.slice(index + 1);
  return a.slice(index + 1) === b.slice(index + 1) ||
    (a[index] === b[index + 1] && a[index + 1] === b[index] && a.slice(index + 2) === b.slice(index + 2));
}

function customerSuggestionScore(input, candidate) {
  const short = Math.min(input.length, candidate.length);
  const long = Math.max(input.length, candidate.length);
  if (short < 2) return 0;
  if (input === candidate) return 100;
  if (input.includes(candidate) || candidate.includes(input)) return 60 + 30 * short / long;
  if (short >= 3 && oneNameEdit(input, candidate)) return 75;
  if (short >= 4 && short === long) {
    // No separator tells us which part is the location; offer both orders for review.
    const cut = (candidate + candidate).indexOf(input, 1);
    if (cut >= 2 && cut <= short - 2) return 85;
  }
  return 0;
}

export function suggestedCustomers(name, customers = []) {
  const parts = customerNameParts(name);
  if (!parts.length) return [];
  const strong = matchingCustomers(name, customers);
  const inputs = customerNameForms(parts).flatMap(key => [key, key.replace(stallAddress, '')]);
  const fragments = parts.length > 1 ? [...new Set(parts.filter(part => part.length >= 2 && /\p{L}/u.test(part)))] : [];
  const frequency = new Map();
  const suggestions = [];
  for (const customer of customers) {
    if (strong.includes(customer)) continue;
    let score = 0;
    const matched = new Set();
    for (const value of customerNames(customer)) {
      for (const form of customerNameForms(customerNameParts(value))) {
        const base = form.replace(stallAddress, '');
        for (const part of fragments) {
          if (base.includes(part)) matched.add(part);
        }
        for (const input of inputs) {
          score = Math.max(score, customerSuggestionScore(input, form), customerSuggestionScore(input, base));
        }
      }
    }
    if (score || matched.size) suggestions.push({ customer, score, matched });
    for (const part of matched) frequency.set(part, (frequency.get(part) || 0) + 1);
  }
  // A shared name can identify useful choices even when the delivery route changed.
  // Let a rare fragment outrank a locality repeated across many customers.
  for (const item of suggestions) {
    if (!item.matched.size) continue;
    let fragmentScore = 40 + 8 * Math.min(2, item.matched.size);
    for (const part of item.matched) fragmentScore += Math.min(4, part.length) * 3 / Math.sqrt(frequency.get(part));
    item.score = Math.max(item.score, fragmentScore);
  }
  suggestions.sort((a, b) => b.score - a.score);
  return [...strong, ...suggestions.slice(0, Math.max(0, 8 - strong.length)).map(item => item.customer)];
}

function parseProductLine(text, products) {
  const line = normalizeDigits(text).replace(/[\s，,、;；。]+$/, '');
  if (findProduct(line, products)) return null;
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
    const customerMatches = matchingCustomers(heading, customers);
    const knownCustomer = customerMatches.length === 1 ? customerMatches[0] : null;
    const phone = findProduct(line, products) ? null : phoneHeader(heading);
    const productLine = parseProductLine(line, products);
    const explicitHeading = /^客户\s*[:：]/.test(line) || /[:：]$/.test(line);
    const stallHeading = stallAddress.test(joinedCustomerName(customerNameParts(heading)));
    if (customerMatches.length || phone || explicitHeading ||
        (!productLine && (stallHeading || !/\d/.test(normalizeDigits(line))) && !findProduct(line, products))) {
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
