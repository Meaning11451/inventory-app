---
name: 三胜达进销存
description: 保留既有库存操作界面，以白色框架、宋体品牌字和统一线性图标作轻量品牌识别。
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
  bg: "#f7f8f5"
  outbound-text: "#a43d29"
  outbound-light: "#fff5f1"
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
    fontSize: "1.8rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  brand:
    fontFamily: '"Songti SC", "STSong", "SimSun", serif'
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.08em"
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
  brand: "9px"
  stats: "14px"
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
  button-outbound:
    backgroundColor: "{colors.outbound-light}"
    textColor: "{colors.outbound-text}"
    rounded: "{rounded.sm}"
  stats-ledger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.stats}"
  header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    height: "64px"
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

这是现有进销存操作界面的轻量品牌延续。名称使用“三胜达进销存”，安装后的短名称使用“三胜达库存”。以宋体“三胜达”和用户提供的“火锅牛羊肉”描述建立识别，椭圆徽记作为辅助。页头和桌面侧栏保持白色；绿色用于品牌文字、选中态、主要操作与正向数量。

本规范从完成后的 `css/style.css`、`index.html`、`js/app.js` 和 `manifest.json` 提取。首页统计合并为一个台账表面；导航、统计、快捷动作、库存分类与操作使用统一的内联 SVG 线性图标。其他未改动表单与空态仍可能保留存量 emoji。未建立缺失的 PRODUCT.md，也不从招牌推断额外业务承诺。

**Key Characteristics:**

- 白色页头与侧栏，暖近白画布，绿色只作局部强调。
- 宋体品牌字与线性图标建立特色，统计使用一个分隔台账。
- 手机底部导航，桌面左侧导航。
- 椭圆徽记小范围出现，不带门店电话、地址或整张招牌。

## Colors

主色取自门店绿色识别，浅绿承接选中态与焦点；语义状态仍独立表达。

### Primary

- **门店深绿**（primary）：品牌文字、主要按钮、选中导航、输入焦点和文本光标。
- **深绿按压色**（primary-dark）：主要按钮悬停和局部强调。
- **浅绿底色**（primary-light）：桌面选中导航和次要操作悬停；库存图标使用更淡的中性底。

### Secondary

- **入库绿**（success / success-light）：正库存、入库标记和成功状态；成功按钮使用 success-action。
- **出库红**（danger / danger-light）：负库存和错误；表单保存出库按钮保留 danger-action。首页出库快捷按钮及库存出库、删除按钮用 outbound-text 红字，配白底或 outbound-light 浅底。
- **提醒黄**（warning / warning-light）：低库存、离线和待核对状态。

### Neutral

- **暖近白画布**（bg）：页面背景。
- **白色工作表面**（surface）：卡片、输入和导航。
- **正文灰**（text）：业务名称和主要数字。
- **辅助灰**（text-secondary / text-muted）：规格、单位、提示和次级文字。
- **灰绿边线**（border）：卡片、字段与列表分隔。

### Named Rules

**The Light Branding Rule.** 页头与侧栏使用白色和细分隔线，品牌依靠宋体字、事实描述和小徽记；不使用整条绿色页头。

**The Semantic Color Rule.** 出库和危险操作继续使用红色；不能为了统一品牌而将所有状态改成绿色。

## Typography

正文和控件沿用系统无衬线字体栈，中文回退至苹方或微软雅黑。品牌字使用 Songti SC、STSong、SimSun 与 serif 回退；快捷粘贴文本使用等宽字体。

### Hierarchy

- **统计数字**（metric）：首页合计为 28.8px、650 字重，使用等宽数字；12.8px、500 字重的标签位于数字上方。库存数量另用（1.35rem，700）。
- **卡片标题**（card-title）：商品名称，规格在下方作为次级文字。
- **正文**（body）：全局阅读基准；表单字段为（0.95rem）。
- **标签与按钮**（label / button）：标签保留较紧凑层级，按钮用中粗字重。
- **快捷文本**（quick-text）：较宽行距便于逐行核对。
- **品牌与页标题**：品牌名为（1.25rem，700，0.08em 字距），359px 及以下缩为 1.1rem；页标题为（1.25rem，手机 600 / 桌面 650）。品牌描述为 0.7rem。

## Layout

手机内容单列居中，主容器最大宽度（640px），基础内边距（16px）；底部为固定导航，内容留出导航高度与设备安全区。页头基础高度（64px），iPhone 顶部安全区另外计入。

从（640px）起，内容水平内边距为（24px），卡片内边距为（18px 22px）。库存卡在宽度不超过（767px）时，商品与数量在第一行，四个操作在第二行等分排列，显示文字标签，按钮最小高度（44px）；长名称允许折行。

从（1024px）起，导航转为（176px）宽左侧栏，品牌在侧栏顶部；页头只保留当前页标题。内容最大宽度（1240px），内边距为（28px 32px 40px）；统计在同一白色表面内分为四列（手机为 2×2），单元格以 1px 分隔线相连；库存与客户列表为两列。期初文件字段从（768px）起分为两列，宽表格由容器滚动。

## Elevation & Depth

白底、细边线与轻阴影共同分层。卡片静止时使用最轻阴影，点击时轻微缩放；弹层使用较高阴影。桌面侧栏取消底部导航的阴影。阴影与动效的完整值保存在 sidecar，保持既有交互，不新增装饰性深度。

### Shadow Vocabulary

- **轻表面**（shadow-xs）：卡片、字段与主要按钮。
- **反馈表面**（shadow-sm）：选中分段与卡片、按钮交互。
- **浮层**（shadow-lg）：提示和底部弹层。

## Shapes

常用按钮与字段为小圆角，卡片为中圆角，搜索框为大圆角；底部弹层仅顶部使用最大圆角。品牌图标外框为 9px 圆角，内部椭圆形状来自已生成的图像资产；旁边的宋体品牌字是独立排版。统计台账整体圆角为 14px。

## Components

### Buttons

主要按钮使用深绿与白字，悬停加深；描边按钮使用白底，悬停转浅绿。入库保留成功绿主按钮；首页出库快捷按钮、库存出库和删除使用红字配白色或浅红底，表单保存出库按钮保留原实色。按钮按下缩放至（0.96），禁用态降低透明度并等待。键盘焦点为（3px）主色轮廓，页头按钮同样使用主色焦点轮廓。安装入口在手机为 44px 图标按钮，并有“添加到桌面”可访问名称；桌面同时显示图标与文字。

### Cards / Containers

业务卡片使用白底、细边线与轻阴影；保持原有商品、规格、数量、操作顺序。品牌不重复进入每张卡片。首页四项统计共用一个白色台账表面，以 1px 细线分隔；标签在数字上方，不使用独立卡片间隙或顶部色条。

### Inputs / Fields

字段采用细边线、白底和系统字体，聚焦时边线变绿并出现浅绿光圈。表格预览输入在手机上保留（16px）文字与（44px）最小高度，桌面预览输入最小高度为（36px）。无效字段保留危险色边线。

### Navigation

手机品牌位于页头，六项导航位于底部；选中项用深绿文字与短线表示。桌面品牌移至侧栏，选中项增加浅绿底。导航使用同一组内联 SVG 描边图标，20px 基础尺寸、1.7 描边宽度，导航为 22px；统计、快捷动作、库存分类与操作沿用同一图标体系。未改动业务表单和空态中的存量 emoji 不代表新图标规则。

### Badges

成功、提醒和危险徽章使用各自浅底与语义色文字，保持紧凑圆角标签。出入库记录继续通过标签与数量颜色区别。

### Brand assets

已生成的“三胜达”椭圆徽记用于（34px）页头与侧栏辅助图标，以及 favicon、Apple Touch Icon 和 PWA 图标；359px 及以下隐藏页头徽记以容纳品牌字与操作。浏览器与 PWA theme-color 为白色。仅使用品牌文字与绿色，不纳入电话号码、地址或整张招牌。生成来源见 `icons/brand-provenance.json`，完整提示词见 `icons/brand-prompt.txt`；高分辨率母图保留在本地 `.impeccable/assets/brand-master.png`，不随网站发布。

## Do's and Don'ts

### Do:

- **Do** 以宋体“三胜达”、事实描述“火锅牛羊肉”和统一线性 SVG 图标建立识别，徽记保持辅助尺寸。
- **Do** 保留白色卡片、业务信息层级、语义状态色和现有操作文案。
- **Do** 在手机库存卡中把操作放到第二行并显示文字标签。
- **Do** 尊重安全区、可见键盘焦点和减少动态效果偏好。

### Don't:

- **Don't** 在业务卡片上重复放大标识，或把整张门店招牌铺作背景。
- **Don't** 把电话号码、地址和招牌其他宣传文字加入应用标识。
- **Don't** 用品牌绿替换出库、危险或错误的红色语义。
- **Don't** 恢复整条绿色页头、四张独立统计卡或统计顶部色条。
- **Don't** 将未改动表单中的存量 emoji 推广为新增图标规则。

