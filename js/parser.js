// ============================================
// parser.js - 快捷录入文本解析器（支持客户名识别）
// ============================================

/**
 * 解析快捷录入文本
 *
 * 支持的格式（每行）：
 *   商品名 数量 [单位]
 *   客户名 商品名 数量 [单位]
 *
 * 客户名通过在 customers 列表中匹配来识别
 *
 * 示例：
 *   张三 后腿卷  10件
 *   三号    8
 *   李四 乌鸡卷  3件
 *   精品五花 5kg
 *
 * @param {string} text - 原始多行文本
 * @param {Customer[]} customers - 已有客户列表（用于匹配客户名）
 * @returns {ParsedLine[]}
 */
export function parseQuickEntry(text, customers = []) {
  const lines = text.split('\n');
  const results = [];

  // 支持的单位关键词
  const unitPattern = '(?:件|个|箱|包|斤|公斤|kg|g|两|吨|盒|袋|桶|瓶|把|条|块|片|卷|只|双|套|台|辆|支|根|颗|粒|对|打|盘|筐|笼|提|板)';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 跳过空行
    if (!trimmed) continue;

    // 正则：所有文本 + 数量 + 可选单位
    const fullPattern = new RegExp(
      `^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*${unitPattern}?\\s*$`,
      'i'
    );

    const match = trimmed.match(fullPattern);

    if (match) {
      const namePart = match[1].trim();
      const quantity = parseFloat(match[2]);
      const unit = match[3] || null;

      // 尝试拆分客户名和商品名
      const { customer, customerName, productName } = splitCustomerAndProduct(namePart, customers);

      results.push({
        rawCustomer: customerName,
        customer: customer,       // 匹配到的客户对象，未匹配为 null
        rawName: productName,
        quantity,
        unit,
        lineIndex: i,
        rawLine: trimmed,
        error: null
      });
    } else {
      // 宽松匹配：只要 名称 + 数字
      const looseMatch = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
      if (looseMatch) {
        const namePart = looseMatch[1].trim();
        const quantity = parseFloat(looseMatch[2]);
        const { customer, customerName, productName } = splitCustomerAndProduct(namePart, customers);

        results.push({
          rawCustomer: customerName,
          customer: customer,
          rawName: productName,
          quantity,
          unit: null,
          lineIndex: i,
          rawLine: trimmed,
          error: null
        });
      } else {
        results.push({
          rawCustomer: '',
          customer: null,
          rawName: trimmed,
          quantity: null,
          unit: null,
          lineIndex: i,
          rawLine: trimmed,
          error: '无法识别格式，请使用：商品名 数量 [单位]'
        });
      }
    }
  }

  return results;
}

/**
 * 从文本中拆分客户名和商品名
 * 策略：在客户列表中查找最长匹配的客户名
 */
function splitCustomerAndProduct(namePart, customers) {
  // 按空格拆分
  const parts = namePart.split(/\s+/);

  if (parts.length === 1) {
    // 只有一个词，就是商品名
    return { customer: null, customerName: '', productName: parts[0] };
  }

  // 多个词：尝试将前面的词组合为客户名
  // 从长到短尝试匹配客户名
  for (let len = Math.min(parts.length - 1, 4); len >= 1; len--) {
    const candidateName = parts.slice(0, len).join('');
    const matched = customers.find(c => c.name === candidateName);

    if (matched) {
      return {
        customer: matched,
        customerName: matched.name,
        productName: parts.slice(len).join(' ')
      };
    }
  }

  // 没匹配到客户列表中的名字
  // 简单策略：如果第一部分长度 ≤ 5 且后面还有内容，视为客户名
  const firstPart = parts[0];
  if (firstPart.length <= 5 && parts.length >= 2) {
    return {
      customer: null,
      customerName: firstPart,
      productName: parts.slice(1).join(' ')
    };
  }

  // 全部视为商品名
  return { customer: null, customerName: '', productName: namePart };
}

/**
 * 将解析结果与已有商品进行匹配
 *
 * @param {ParsedLine[]} parsedLines - 解析结果
 * @param {Product[]} existingProducts - 已有商品列表
 * @returns {ResolvedLine[]}
 */
export function resolveProducts(parsedLines, existingProducts) {
  return parsedLines.map(line => {
    if (line.error) {
      return { parsed: line, product: null, needCreate: false, suggestedUnit: line.unit || '件' };
    }

    // 1. 精确匹配商品名
    let product = existingProducts.find(p => p.name === line.rawName);

    // 2. 忽略大小写匹配
    if (!product) {
      product = existingProducts.find(p =>
        p.name.toLowerCase() === line.rawName.toLowerCase()
      );
    }

    // 3. 包含匹配（双向）
    if (!product) {
      product = existingProducts.find(p =>
        p.name.includes(line.rawName) || line.rawName.includes(p.name)
      );
    }

    // 4. 去空格后匹配
    if (!product) {
      const normalized = line.rawName.replace(/\s+/g, '');
      product = existingProducts.find(p =>
        p.name.replace(/\s+/g, '') === normalized
      );
    }

    if (product) {
      return {
        parsed: line,
        product,
        needCreate: false,
        suggestedUnit: line.unit || product.unit
      };
    }

    return {
      parsed: line,
      product: null,
      needCreate: true,
      suggestedUnit: line.unit || '件'
    };
  });
}

/**
 * 解析 Excel 导入的数据（二维数组）
 *
 * 支持的列顺序：客户名, 商品名, 数量, 单位, 单价, 备注
 * 第一行如果是标题则跳过
 *
 * @param {Array<Array<string|number>>} rows - Excel 行数据
 * @param {Customer[]} customers - 已有客户列表
 * @param {Product[]} products - 已有商品列表
 * @returns {{ parsed: ParsedLine[], resolved: ResolvedLine[] }}
 */
export function parseExcelData(rows, customers, products) {
  if (!rows || rows.length === 0) return { parsed: [], resolved: [] };

  // 判断第一行是否为标题（包含中文或不含数字）
  const firstRow = rows[0];
  const isHeader = firstRow.some(cell =>
    typeof cell === 'string' &&
    /[客户|商品|名称|数量|单位|单价|备注|姓名|品名|件数|个数]/.test(String(cell))
  );

  const dataRows = isHeader ? rows.slice(1) : rows;

  const parsed = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

    const customerName = String(row[0] || '').trim();
    const productName = String(row[1] || '').trim();
    const quantity = parseFloat(String(row[2] || '0').replace(/[,，]/g, ''));
    const unit = String(row[3] || '').trim();
    const unitPrice = parseFloat(String(row[4] || '0').replace(/[,，]/g, ''));

    // 匹配客户
    let customer = null;
    if (customerName) {
      customer = customers.find(c => c.name === customerName) ||
                 customers.find(c => c.name.includes(customerName)) ||
                 null;
    }

    // 匹配商品
    let product = null;
    if (productName) {
      product = products.find(p => p.name === productName) ||
                products.find(p => p.name.includes(productName)) ||
                null;
    }

    parsed.push({
      parsed: {
        rawCustomer: customerName,
        customer,
        rawName: productName,
        quantity: isNaN(quantity) ? null : quantity,
        unit: unit || null,
        lineIndex: i,
        rawLine: row.join(' | '),
        error: (!productName || isNaN(quantity))
          ? '缺少商品名或数量' : null
      },
      product,
      customer,
      needCreate: !product && productName && !isNaN(quantity),
      suggestedUnit: unit || (product ? product.unit : '件'),
      unitPrice: isNaN(unitPrice) ? null : unitPrice
    });
  }

  return {
    parsed: parsed.map(p => p.parsed),
    resolved: parsed
  };
}
