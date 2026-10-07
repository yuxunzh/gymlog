@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   健身记录 - 本地服务器
echo   请让手机和电脑连接同一个 WiFi，然后在手机
echo   浏览器输入：  http://电脑IP:8000
echo   （电脑 IP 在电脑上运行 ipconfig 查看 IPv4 地址）
echo   保持本窗口打开，关闭窗口即停止服务。
echo ================================================
echo.
where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
) else (
  echo 未检测到 Node.js，请安装后重试。
  pause
)
