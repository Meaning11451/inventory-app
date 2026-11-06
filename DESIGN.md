---
name: 三胜达进销存
description: 保留既有库存操作界面，以门店深绿和小尺寸椭圆标识作轻量品牌识别。
colors:
  primary: "#155b36"
  primary-dark: "#0e4327"
  primary-light: "#e6f1e9"
  success: "#26714b"
  success-light: "#e8f3eb"
  success-action: "#216b45"
  danger: "#e17055"
  danger-action: "#b94b32"
  danger-light: "#fef0ed"
  warning: "#fdcb6e"
  warning-light: "#fff9e6"
  bg: "#f5f7f5"
  surface: "#ffffff"
  text: "#2d3436"
  text-secondary: "#636e72"
  text-muted: "#626d73"
  border: "#e4e9e5"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "1rem"
    lineHeight: 1.6
  card-title:
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.4
  metric:
    fontSize: "1.6rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  label:
    fontSize: "0.8rem"
    fontWeight: 600
    letterSpacing: "0.01em"
  button:
    fontSize: "0.9rem"
    fontWeight: 600
    letterSpacing: "0.01em"
  quick-text:
    fontFamily: '"SF Mono", "Menlo", "Consolas", "Roboto Mono", monospace'
    fontSize: "0.9rem"
    lineHeight: 1.8
    letterSpacing: "0.02em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  brand: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  button-success:
    backgroundColor: "{colors.success-action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  button-danger:
    backgroundColor: "{colors.danger-action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  input:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "11px 14px"
  badge-success:
    backgroundColor: "{colors.success-light}"
    textColor: "{colors.success}"
    rounded: "{rounded.md}"
    padding: "3px 10px"
---

# Design System: 三胜达进销存

## Overview

**Creative North Star: "门店绿，白色工作台"**

这是现有进销存操作界面的轻量品牌延续。名称使用“三胜达进销存”，安装后的短名称使用“三胜达库存”。只取用户提供门店招牌中的深绿与“三胜达”椭圆徽记；品牌留在页头、桌面侧栏与应用图标，库存、表单和记录仍以清晰的白色卡片呈现。

本规范从完成后的 `css/style.css`、`index.html` 和 `manifest.json` 提取。没有重排既有业务信息或改写操作文案。既有 emoji 业务标记保持原样，它们是存量内容，不作为新增图标体系的规范。未建立缺失的 PRODUCT.md，也不从招牌推断额外业务承诺。

**Key Characteristics:**

- 深绿品牌框架，白色业务表面。
- 商品、数量、状态和操作保持既有卡片层级。
- 手机底部导航，桌面左侧导航。
- 椭圆徽记小范围出现，不带门店电话、地址或整张招牌。

## Colors

主色取自门店绿色识别，浅绿承接选中态与焦点；语义状态仍独立表达。

### Primary

- **门店深绿**（primary）：页头、主要按钮、选中导航、输入焦点和文本光标。
- **深绿按压色**（primary-dark）：主要按钮悬停和局部强调。
- **浅绿底色**（primary-light）：桌面选中导航、库存图标底和次要操作悬停。

### Secondary

- **入库绿**（success / success-light）：正库存、入库标记和成功状态；成功按钮使用 success-action。
- **出库红**（danger / danger-light）：出库、负库存和错误；危险操作按钮使用 danger-action。
- **提醒黄**（warning / warning-light）：低库存、离线和待核对状态。

### Neutral

- **淡灰绿画布**（bg）：页面背景。
- **白色工作表面**（surface）：卡片、输入和导航。
- **正文灰**（text）：业务名称和主要数字。
- **辅助灰**（text-secondary / text-muted）：规格、单位、提示和次级文字。
- **灰绿边线**（border）：卡片、字段与列表分隔。

### Named Rules

**The Light Branding Rule.** 品牌用于界面框架和小徽记，保留白色业务区域与原有信息密度。

**The Semantic Color Rule.** 出库和危险操作继续使用红色；不能为了统一品牌而将所有状态改成绿色。

## Typography

正文和控件沿用系统无衬线字体栈，中文回退至苹方或微软雅黑。快捷粘贴文本使用等宽字体；没有新增展示字体。

### Hierarchy

- **统计数字**（metric）：首页合计；库存数量另用（1.35rem，700）。
- **卡片标题**（card-title）：商品名称，规格在下方作为次级文字。
- **正文**（body）：全局阅读基准；表单字段为（0.95rem）。
- **标签与按钮**（label / button）：标签保留较紧凑层级，按钮用中粗字重。
- **快捷文本**（quick-text）：较宽行距便于逐行核对。
- **品牌与页标题**：手机品牌名为（1rem，700），当前页名为（0.85rem，500）；桌面当前页名为（1.25rem，650）。

## Layout

手机内容单列居中，主容器最大宽度（640px），基础内边距（16px）；底部为固定导航，内容留出导航高度与设备安全区。页头基础高度（64px），iPhone 顶部安全区另外计入。

从（640px）起，内容水平内边距为（24px），卡片内边距为（18px 22px）。库存卡在宽度不超过（767px）时，商品与数量在第一行，四个操作在第二行等分排列，显示文字标签，按钮最小高度（44px）；长名称允许折行。

从（1024px）起，导航转为（176px）宽左侧栏，品牌在侧栏顶部；页头只保留当前页标题。内容最大宽度（1240px），内边距为（28px 32px 40px）；统计为四列，库存与客户列表为两列。期初文件字段从（768px）起分为两列，宽表格由容器滚动。

## Elevation & Depth

白底、细边线与轻阴影共同分层。卡片静止时使用最轻阴影，点击时轻微缩放；弹层使用较高阴影。桌面侧栏取消底部导航的阴影。阴影与动效的完整值保存在 sidecar，保持既有交互，不新增装饰性深度。

### Shadow Vocabulary

- **轻表面**（shadow-xs）：卡片、字段与主要按钮。
- **反馈表面**（shadow-sm）：选中分段与卡片、按钮交互。
- **浮层**（shadow-lg）：提示和底部弹层。

## Shapes

常用按钮与字段为小圆角，卡片为中圆角，搜索框为大圆角；底部弹层仅顶部使用最大圆角。品牌图标外框使用独立圆角，内部椭圆形状来自已生成的图像资产，不用 CSS 或文字重画标识。

## Components

### Buttons

主要按钮使用深绿与白字，悬停加深；描边按钮使用白底，悬停转浅绿。入库、出库动作分别保留成功绿和危险红。按钮按下缩放至（0.96），禁用态降低透明度并等待。键盘焦点为（3px）主色轮廓，页头按钮使用白色焦点轮廓。

### Cards / Containers

业务卡片使用白底、细边线与轻阴影；保持原有商品、规格、数量、操作顺序。品牌不重复进入每张卡片。统计卡顶部保留各自的细状态色条。

### Inputs / Fields

字段采用细边线、白底和系统字体，聚焦时边线变绿并出现浅绿光圈。表格预览输入在手机上保留（16px）文字与（44px）最小高度，桌面预览输入最小高度为（36px）。无效字段保留危险色边线。

### Navigation

手机品牌位于页头，六项导航位于底部；选中项用深绿文字与短线表示。桌面品牌移至侧栏，选中项增加浅绿底。保留导航和业务中的既有 emoji，不扩展为新的品牌素材。

### Badges

成功、提醒和危险徽章使用各自浅底与语义色文字，保持紧凑圆角标签。出入库记录继续通过标签与数量颜色区别。

### Brand assets

已生成的“三胜达”椭圆徽记用于（40px）页头与侧栏图标，以及 favicon、Apple Touch Icon 和 PWA 图标。仅使用品牌文字与绿色，不纳入电话号码、地址或整张招牌。生成来源见 `icons/brand-provenance.json`，完整提示词见 `icons/brand-prompt.txt`；高分辨率母图保留在本地 `.impeccable/assets/brand-master.png`，不随网站发布。

## Do's and Don'ts

### Do:

- **Do** 使用已生成的“三胜达”徽记和现有深绿令牌，保持小范围品牌识别。
- **Do** 保留白色卡片、业务信息层级、语义状态色和现有操作文案。
- **Do** 在手机库存卡中把操作放到第二行并显示文字标签。
- **Do** 尊重安全区、可见键盘焦点和减少动态效果偏好。

### Don't:

- **Don't** 在业务卡片上重复放大标识，或把整张门店招牌铺作背景。
- **Don't** 把电话号码、地址和招牌其他宣传文字加入应用标识。
- **Don't** 用品牌绿替换出库、危险或错误的红色语义。
- **Don't** 将本轮保留的 emoji 与存量动效推广为新增设计系统规则。

