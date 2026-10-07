'use strict';

/*
  把网页文件复制到 www/，供 Capacitor 打包成安卓 App 使用。
  运行： npm run prepare-www   （或 node tools/prepare-www.js）
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

// 只复制应用真正需要的文件
const FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'exercises.js',
  'sw.js',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'screenshot-1.png'
];

if (fs.existsSync(out)) {
  const safe = path.basename(out) === 'www' && path.dirname(out) === root;
  if (!safe) throw new Error('拒绝清理项目以外的目录: ' + out);
  fs.rmSync(out, { recursive: true, force: true });
}
fs.mkdirSync(out, { recursive: true });

let copied = 0;
const missing = [];
for (const file of FILES) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) { missing.push(file); continue; }
  fs.copyFileSync(src, path.join(out, file));
  copied++;
}
console.log('已准备 www/：复制 ' + copied + ' 个文件');
if (missing.length) console.log('（跳过不存在的文件：' + missing.join(', ') + '）');