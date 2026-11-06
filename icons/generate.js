// Preview and download the existing brand artwork without replacing its lettering.
const icons = [
  ['180×180 · iPhone', 'icon-180x180.png'],
  ['192×192', 'icon-192x192.png'],
  ['512×512', 'icon-512x512.png'],
  ['512×512 · 自适应裁切', 'icon-maskable-512x512.png']
];
document.getElementById('preview').innerHTML = icons.map(([label,file]) => `<a href="./${file}?v=14" download="${file}"><img src="./${file}?v=14" width="96" height="96" alt="三胜达品牌图标"><span>${label}</span></a>`).join('');
