# 📦 个人进销存管理系统

PWA 应用，手机电脑都能用，数据双端实时同步，全部免费。

## ✨ 功能

- 📦 **库存查询** - 实时库存，搜索过滤
- 📥 **入库管理** - 表单录入 / 快捷粘贴批量录入
- 📤 **出库管理** - 表单录入 / 快捷粘贴批量录入
- 👤 **客户管理** - 自动补全，按客户查账
- 📋 **记录查询** - 入库/出库历史，按日期和客户筛选
- ⚙️ **商品管理** - 增删改查
- 📱 **PWA** - 可安装到手机桌面，离线也能用
- 🔄 **双端同步** - 手机电脑数据实时同步

## 🚀 快速开始

### 1. 注册 Supabase（免费数据库）

1. 打开 [supabase.com](https://supabase.com)，用 GitHub 账号登录
2. 点击 **New Project**
3. 输入项目名称（如 `inventory`），设置数据库密码（记下来）
4. 选择离你最近的区域（如 `ap-southeast-1` 新加坡）
5. 点击 **Create Project**，等 1-2 分钟初始化完成

### 2. 创建数据库表

1. 在 Supabase 项目左侧菜单，点击 **SQL Editor**
2. 点击 **New Query**
3. 复制粘贴 `supabase/migrations/001_schema.sql` 的全部内容
4. 点击 **Run** 执行

### 3. 配置 API 密钥

1. 在 Supabase 项目左侧菜单，点击 **Settings** → **API**
2. 复制 **Project URL** 和 **anon public key**
3. 打开 `js/supabase.js`，替换以下两行：

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';       // 替换为 Project URL
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // 替换为 anon key
```

### 4. 部署到 Vercel（免费）

1. 把代码推送到 GitHub 仓库：

```bash
cd inventory-app
git init
git add .
git commit -m "初始化进销存系统"
# 在 GitHub 创建仓库后：
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

2. 打开 [vercel.com](https://vercel.com)，用 GitHub 登录
3. 点击 **New Project** → 选择你的仓库 → **Deploy**
4. 完成！你会得到一个 `https://xxx.vercel.app` 的网址
5. 手机上用浏览器打开这个网址，添加到桌面即可

### 5. 生成 PWA 图标（可选）

在浏览器中打开 `icons/generate.html`，点击生成并下载图标，放入 `icons/` 目录。

## 📱 快捷录入格式

支持直接在文本框粘贴以下格式：

```
客户名 商品名 数量 单位
```

**示例：**
```
张三 后腿卷 10件
李四 三号 8
乌鸡卷 3件
精品五花 5kg
```

- 每行一条记录
- 客户名可选（如果不写，可以使用顶部的"整批客户名"）
- 单位可选（默认使用商品的单位）
- 自动匹配已有商品，未匹配的会提示新建

## 🛠 技术栈

- 纯 HTML/CSS/JS（Vanilla JS，零框架）
- Supabase（PostgreSQL 数据库 + 自动 API）
- PWA（Service Worker + Manifest）
- Vercel 部署

## 💰 费用

**全部免费。**

- Supabase 免费版：500MB 数据库，5 万次 API/月（个人使用完全够）
- Vercel 免费版：无限静态网站托管
- GitHub 免费版：无限私有仓库
