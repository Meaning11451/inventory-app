-- ============================================
-- 个人进销存系统 - 数据库初始化脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================

-- 1. 商品表
CREATE TABLE IF NOT EXISTS products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  spec       TEXT DEFAULT '',
  unit       TEXT NOT NULL DEFAULT '件',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products USING btree (name);

-- 2. 客户表
CREATE TABLE IF NOT EXISTS customers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers USING btree (name);

-- 3. 入库记录表
CREATE TABLE IF NOT EXISTS inbound_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT '',  -- 冗余字段，方便直接显示（客户被删除时仍然保留名称）
  quantity      NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(12,2),
  note          TEXT DEFAULT '',
  recorded_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_product  ON inbound_records (product_id);
CREATE INDEX IF NOT EXISTS idx_inbound_customer ON inbound_records (customer_id);
CREATE INDEX IF NOT EXISTS idx_inbound_date     ON inbound_records (recorded_at DESC);

-- 4. 出库记录表
CREATE TABLE IF NOT EXISTS outbound_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT '',  -- 冗余字段，方便直接显示（客户被删除时仍然保留名称）
  quantity      NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(12,2),
  note          TEXT DEFAULT '',
  recorded_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_product  ON outbound_records (product_id);
CREATE INDEX IF NOT EXISTS idx_outbound_customer ON outbound_records (customer_id);
CREATE INDEX IF NOT EXISTS idx_outbound_date     ON outbound_records (recorded_at DESC);

-- 5. 实时库存视图
CREATE OR REPLACE VIEW current_stock AS
SELECT
  p.id,
  p.name,
  p.spec,
  p.unit,
  COALESCE(i.total_in, 0)                 AS total_inbound,
  COALESCE(o.total_out, 0)                AS total_outbound,
  COALESCE(i.total_in, 0) - COALESCE(o.total_out, 0) AS stock_qty
FROM products p
LEFT JOIN (
  SELECT product_id, SUM(quantity) AS total_in
  FROM inbound_records
  GROUP BY product_id
) i ON p.id = i.product_id
LEFT JOIN (
  SELECT product_id, SUM(quantity) AS total_out
  FROM outbound_records
  GROUP BY product_id
) o ON p.id = o.product_id
ORDER BY p.name;

-- 6. RLS 策略 - 单用户场景全放开
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_records ENABLE ROW LEVEL SECURITY;

-- 先删除旧策略（如果存在），再创建新策略
DROP POLICY IF EXISTS "allow_all" ON products;
CREATE POLICY "allow_all" ON products FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all" ON customers;
CREATE POLICY "allow_all" ON customers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all" ON inbound_records;
CREATE POLICY "allow_all" ON inbound_records FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all" ON outbound_records;
CREATE POLICY "allow_all" ON outbound_records FOR ALL USING (true) WITH CHECK (true);

-- 7. 启用实时订阅
ALTER PUBLICATION supabase_realtime ADD TABLE inbound_records;
ALTER PUBLICATION supabase_realtime ADD TABLE outbound_records;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
