#!/usr/bin/env bash
# sync-spa-routes.sh — CloudBase 静态托管的 SPA 深层路由兜底（v1.1.6 hotfix，2026-09-12）
#
# 背景：tcloudbaseapp.com 静态托管（DomainType=gateway）不支持 Vercel 式 rewrite，
# CLI / API（tcb api tcb ModifyStaticStore → InvalidAction）也没有重写入口。
# 请求 /class/duty 会找 COS 对象 class/duty → NoSuchKey → 404。
#
# 解法：把 dist/index.html 按路由路径上传为同名对象（实测网关按 text/html 服务），
# 深层路由直接 GET 返回 200 + 应用 HTML，浏览器加载后由 vue-router 接管。
#
# 使用：先 npm run build，再运行本脚本。**新增路由后必须把路径加进 ROUTES**。
# 依赖：tcb CLI（npx 缓存）与登录态（~/.config/.cloudbase）。
set -euo pipefail

ENV_ID="teacher-desk-d6gdsgqb8f9dc13d2"
TCB="${TCB:-$HOME/.npm/_npx/9a8789722ddc2fbe/node_modules/.bin/tcb}"
DIST="${DIST:-dist}"

ROUTES=(
  class class/seats class/leave class/duty class/weekend
  work work/schedule work/works
  students
  my my/settings my/tools my/profile
  seats leave duty weekend toolbox
)

for route in "${ROUTES[@]}"; do
  "$TCB" hosting deploy "$DIST/index.html" "$route" -e "$ENV_ID" >/dev/null
  echo "✔ /$route"
done
echo "SPA 路由兜底同步完成（共 ${#ROUTES[@]} 条）。"
