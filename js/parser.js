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
 * 示例：
 *   张三 后腿卷  10件
 *   三号    8
 *
 * 格式二（客户名单独一行，下面列举商品）：
 *   客户名
 *   商品名 数量 [单位]
 *   商品名 数量 [单位]
 * 示例：
 *   冬盼
 *   后腿卷  10件
 *   三号    8件
 *   乌鸡卷  3件
 *
 * 自动检测规则：如果第一行不含数字 → 格式二；否则格式一
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

  // 自动检测格式：第一行不含数字 或 是"客户名+手机号" → 分组格式
  const firstTrimmed = nonEmpty[0].trimmed;
  const firstIsCustomer = !/\d/.test(firstTrimmed) || !!checkCustomerWithPhone(firstTrimmed);

  if (firstIsCustomer) {
    // ============ 格式二：客户名分组（客户名单独一行，下面列商品） ============
    let currentCustomer = null;
    let currentCustomerName = '';

    for (const line of nonEmpty) {
      const { lineIndex, trimmed } = line;

      // 先检查是否包含数字
      const hasDigit = /\d/.test(trimmed);

      if (hasDigit) {
        // 检查是否是"客户名 + 手机号"格式（手机号 ≥ 7位，无小数点）
        const phoneMatch = checkCustomerWithPhone(trimmed);
        if (phoneMatch) {
          // → 客户信息行
          currentCustomerName = phoneMatch.name;
          const matchedCustomer = customers.find(c => c.name === currentCustomerName);
          currentCustomer = matchedCustomer || null;
          // 把手机号暂存到 customer 对象（用于后续自动创建客户时填入）
          if (!currentCustomer) {
            currentCustomer = { _phone: phoneMatch.phone, _isNew: true };
          }
          continue;
        }

        // ---- 商品行：名称 + 数量 [+ 单位] ----
        const parsed = parseProductLine(trimmed, unitPattern);

        if (parsed) {
          // 排除离谱的大数字（> 100000 很可能是误识别）
          if (parsed.quantity > 100000) {
            // 数字太大 → 可能是误识别的客户行，当客户名处理
            currentCustomerName = trimmed;
            const matchedCustomer = customers.find(c => c.name === trimmed);
            currentCustomer = matchedCustomer || null;
            continue;
          }
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
        // ---- 无数字 → 客户名行 ----
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

/**
 * 检测是否是"客户名 + 手机号"格式
 * 手机号特征：≥ 7 位连续数字，无小数点
 * 示例：
 *   "张三13654798567"   → { name: "张三", phone: "13654798567" }
 *   "张三 13654798567"  → { name: "张三", phone: "13654798567" }
 *   "张三 136 5479"     → { name: "张三", phone: "1365479" }
 *   "后腿卷 10件"       → null（数字太短）
 *
 * @param {string} line
 * @returns {{ name: string, phone: string } | null}
 */
function checkCustomerWithPhone(line) {
  // 提取所有连续数字段
  const digitGroups = line.match(/\d+/g);
  if (!digitGroups || digitGroups.length === 0) return null;

  // 把所有数字段拼接起来看总长度
  const allDigits = digitGroups.join('');
  // 总位数 ≥ 7 且没有小数点 → 判定为手机号
  if (allDigits.length < 7 || line.includes('.')) return null;

  // 提取名字：数字之前的所有文本（去除末尾空格）
  const firstDigitIdx = line.search(/\d/);
  const namePart = line.substring(0, firstDigitIdx).trim();

  if (!namePart) return null; // 必须有名字

  return { name: namePart, phone: allDigits };
}

/**
 * 从产品行解析：名称、数量、单位
 * 支持格式：
 *   "后腿卷 10件"   → { name: "后腿卷", quantity: 10, unit: "件" }
 *   "三号  8"       → { name: "三号", quantity: 8, unit: null }
 *   "五花肉5斤"    → { name: "五花肉", quantity: 5, unit: "斤" }
 *   "后腿卷10"      → { name: "后腿卷", quantity: 10, unit: null }
 *
 * @param {string} line - 单行文本
 * @param {string} unitPattern - 单位正则片段
 * @returns {{ name: string, quantity: number, unit: string|null } | null}
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
