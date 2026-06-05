// ============================================
// parser.js - 快捷录入文本解析器（支持客户名识别）
// ============================================

/**
 * 解析快捷录入文本
 *
 * 支持两种格式，自动检测：
 *
 * 格式一（每行独立）：
 *   客户名 商品名 数量 [单位]
 *   商品名 数量 [单位]
 *
 * 格式二（客户名单独一行，下面列举商品）：
 *   客户名 [手机号]
 *   商品名 数量 [单位]
 *   商品名 数量 [单位]
 * 示例：
 *   冬盼
 *   后腿卷  10件
 *   三号    8件
 *   乌鸡卷  3件
 *
 *   廊坊固安郭15127611970
 *   后腿卷 10件
 *
 * 自动检测规则：第一行不含数字或第一行是"名字+手机号" → 格式二；否则格式一
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

  // 先收集所有非空行
  const nonEmpty = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed) nonEmpty.push({ lineIndex: i, trimmed });
  }

  if (nonEmpty.length === 0) return results;

  // 自动检测格式：第一行不含数字 或 是"客户名+手机号" → 格式二
  const firstTrimmed = nonEmpty[0].trimmed;
  const firstIsCustomer = !/\d/.test(firstTrimmed) || isPhoneLine(firstTrimmed);

  if (firstIsCustomer) {
    // ============ 格式二：客户名分组（客户名单独一行） ============
    let currentCustomer = null;
    let currentCustomerName = '';

    for (const line of nonEmpty) {
      const { lineIndex, trimmed } = line;

      // 判断这一行是什么
      if (isPhoneLine(trimmed)) {
        // → 客户名 + 手机号行
        const info = extractNameAndPhone(trimmed);
        currentCustomerName = info.name;
        const matchedCustomer = customers.find(c => c.name === currentCustomerName);
        currentCustomer = matchedCustomer || { _phone: info.phone, _isNew: true };
      } else if (/\d/.test(trimmed)) {
        // → 包含短数字 → 商品行
        const parsed = parseProductLine(trimmed, unitPattern);

        if (parsed && parsed.quantity <= 100000) {
          results.push({
            rawCustomer: currentCustomerName,
            customer: currentCustomer,
            rawName: parsed.name,
            quantity: parsed.quantity,
            unit: parsed.unit,
            lineIndex,
            rawLine: trimmed,
            error: null
          });
        } else if (parsed && parsed.quantity > 100000) {
          // 数字太大了，不可能是数量 → 当作客户名行
          currentCustomerName = trimmed;
          const matchedCustomer = customers.find(c => c.name === trimmed);
          currentCustomer = matchedCustomer || null;
        } else {
          results.push({
            rawCustomer: currentCustomerName,
            customer: currentCustomer,
            rawName: trimmed,
            quantity: null,
            unit: null,
            lineIndex,
            rawLine: trimmed,
            error: '无法识别数量和单位'
          });
        }
      } else {
        // → 纯文字 → 客户名行
        currentCustomerName = trimmed;
        const matchedCustomer = customers.find(c => c.name === currentCustomerName);
        currentCustomer = matchedCustomer || null;
      }
    }
  } else {
    // ============ 格式一：每行独立（原有逻辑） ============
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      const fullPattern = new RegExp(
        `^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*${unitPattern}?\\s*$`,
        'i'
      );

      const match = trimmed.match(fullPattern);

      if (match) {
        const namePart = match[1].trim();
        const quantity = parseFloat(match[2]);
        const unit = match[3] || null;

        const { customer, customerName, productName } = splitCustomerAndProduct(namePart, customers);

        results.push({
          rawCustomer: customerName,
          customer,
          rawName: productName,
          quantity,
          unit,
          lineIndex: i,
          rawLine: trimmed,
          error: null
        });
      } else {
        const looseMatch = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
        if (looseMatch) {
          const namePart = looseMatch[1].trim();
          const quantity = parseFloat(looseMatch[2]);
          const { customer, customerName, productName } = splitCustomerAndProduct(namePart, customers);

          results.push({
            rawCustomer: customerName,
            customer,
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
  }

  return results;
}

// ==================== 辅助函数 ====================

/**
 * 判断一行是否是"名字+手机号"格式
 * 规则：包含 ≥ 7 位连续数字，且没有小数点
 */
function isPhoneLine(line) {
  const digits = line.match(/\d+/g);
  if (!digits || digits.length === 0) return false;
  const allDigits = digits.join('');
  return allDigits.length >= 7 && !line.includes('.');
}

/**
 * 从"名字+手机号"行提取名字和手机号
 * 如："廊坊固安郭15127611970" → { name: "廊坊固安郭", phone: "15127611970" }
 *     "张三 13654798567"   → { name: "张三", phone: "13654798567" }
 */
function extractNameAndPhone(line) {
  const digits = line.match(/\d+/g);
  const allDigits = digits.join('');
  const firstDigitIdx = line.search(/\d/);
  const namePart = line.substring(0, firstDigitIdx).trim();
  return { name: namePart || line, phone: allDigits };
}

/**
 * 从产品行解析：名称、数量、单位
 * 支持格式：
 *   "后腿卷 10件"   → { name: "后腿卷", quantity: 10, unit: "件" }
 *   "三号  8"       → { name: "三号", quantity: 8, unit: null }
 *   "五花肉5斤"    → { name: "五花肉", quantity: 5, unit: "斤" }
 *   "后腿卷10"      → { name: "后腿卷", quantity: 10, unit: null }
 */
function parseProductLine(line, unitPattern) {
  // 匹配：名称 + 空格 + 数字 + 可选空格 + 可选单位
  const fullRe = new RegExp(
    `^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})?\\s*$`,
    'i'
  );
  const m1 = line.match(fullRe);
  if (m1) {
    return { name: m1[1].trim(), quantity: parseFloat(m1[2]), unit: m1[3] || null };
  }

  // 匹配：名称(无空格)数字 + 单位（如 "五花肉5斤"）
  const noSpaceRe = new RegExp(
    `^(.+?)(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})?\\s*$`,
    'i'
  );
  const m2 = line.match(noSpaceRe);
  if (m2) {
    return { name: m2[1].trim(), quantity: parseFloat(m2[2]), unit: m2[3] || null };
  }

  // 匹配：名称 + 空格 + 纯数字（无单位）
  const simpleRe = /^(.+?)\s+(\d+(?:\.\d+)?)\s*$/;
  const m3 = line.match(simpleRe);
  if (m3) {
    return { name: m3[1].trim(), quantity: parseFloat(m3[2]), unit: null };
  }

  return null;
}

/**
 * 从文本中拆分客户名和商品名
 * 策略：在客户列表中查找最长匹配的客户名
 */
function splitCustomerAndProduct(namePart, customers) {
  const parts = namePart.split(/\s+/);

  if (parts.length === 1) {
    return { customer: null, customerName: '', productName: parts[0] };
  }

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

  const firstPart = parts[0];
  if (firstPart.length <= 5 && parts.length >= 2) {
    return {
      customer: null,
      customerName: firstPart,
      productName: parts.slice(1).join(' ')
    };
  }

  return { customer: null, customerName: '', productName: namePart };
}

/**
 * 将解析结果与已有商品进行匹配
 */
export function resolveProducts(parsedLines, existingProducts) {
  return parsedLines.map(line => {
    if (line.error) {
      return { parsed: line, product: null, needCreate: false, suggestedUnit: line.unit || '件' };
    }

    let product = existingProducts.find(p => p.name === line.rawName);

    if (!product) {
      product = existingProducts.find(p =>
        p.name.toLowerCase() === line.rawName.toLowerCase()
      );
    }

    if (!product) {
      product = existingProducts.find(p =>
        p.name.includes(line.rawName) || line.rawName.includes(p.name)
      );
    }

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
 */
export function parseExcelData(rows, customers, products) {
  if (!rows || rows.length === 0) return { parsed: [], resolved: [] };

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

    let customer = null;
    if (customerName) {
      customer = customers.find(c => c.name === customerName) ||
                 customers.find(c => c.name.includes(customerName)) ||
                 null;
    }

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
