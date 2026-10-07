'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function lanIP(){
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)){
    for (const ni of ifs[name]){
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root)){ res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err){ res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8000, () => {
  console.log('');
  console.log('  健身记录本地服务器已启动');
  console.log('  请在手机浏览器打开:  http://' + lanIP() + ':8000');
  console.log('  （按 Ctrl+C 停止服务）');
  console.log('');
});
