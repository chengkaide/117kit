@echo off
rem 117kit 启动脚本：cd 到本脚本所在目录的 server 下，用 PATH 里的 node 启动
cd /d %~dp0server
where node >nul 2>nul
if %errorlevel%==0 (
  node src/index.js
) else (
  echo 未在 PATH 中找到 node，请先安装 Node.js 22 或以上版本，或修改本脚本指定 node.exe 完整路径。
)
pause
