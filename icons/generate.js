// ============================================
// 图标生成器 - 在浏览器中运行此脚本
// 打开浏览器控制台，粘贴此脚本并回车
// 或直接打开 generate.html
// ============================================

// 如果不在浏览器中运行，提示
if (typeof document === 'undefined') {
  console.log('请在浏览器中打开 generate.html');
  process.exit(0);
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

function generateIcon(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 背景渐变
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#6366f1');
  gradient.addColorStop(1, '#4f46e5');
  ctx.fillStyle = gradient;

  // 圆角矩形
  const radius = size * 0.2;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();

  // 文字 进销存
  const fontSize = size * 0.35;
  ctx.fillStyle = 'white';
  ctx.font = `bold ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📦', size / 2, size / 2 - fontSize * 0.2);

  return canvas.toDataURL('image/png');
}

function downloadAll() {
  sizes.forEach(size => {
    const dataUrl = generateIcon(size);
    const link = document.createElement('a');
    link.download = `icon-${size}x${size}.png`;
    link.href = dataUrl;
    link.click();
    console.log(`✅ 已生成 icon-${size}x${size}.png`);
  });
}

console.log('🚀 开始生成图标...');
console.log('共需生成 ' + sizes.length + ' 个尺寸的图标');
downloadAll();
console.log('✅ 全部完成！请将下载的图标放到 icons/ 目录下');
