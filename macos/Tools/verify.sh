#!/bin/sh
#
#  verify.sh —— macOS Widget 工程的自检
#
#  分两档跑：
#
#    【有 Xcode】全部跑 —— 配置语法、JSON、类型检查、冒烟测试，外加
#               **xcodebuild 真编译一次**（这是最强的一条：它证明工程文件、
#               两个 target、entitlements、资源目录、扩展嵌入全都成立）。
#
#    【只有 Command Line Tools】跑前四档，跳过 xcodebuild。
#               注意：此时含 SwiftUI **宏**（@State 等）的文件会编不过——
#               宏的实现插件随 Xcode 安装。脚本会把这件事说清楚，别去改代码。
#
#  两档都**证明不了**下面这些，它们要在图形界面里看：
#    · Widget 的渲染与三种尺寸排版
#    · 时间线刷新、点「立即同步」后 Widget 是否立刻重画
#    · 点击 Widget 跳转
#    · Widget 能否被系统的组件库加载
#

set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
cd "$ROOT"

TARGET="arm64-apple-macos14.0"
FAIL=0

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
skip() { printf '  \033[33m—\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------- 0. 工具链

step "工具链"

# 优先用 Xcode 带的工具链：`xcode-select` 可能仍指向 Command Line Tools，
# 那样 swiftc 编不了含 SwiftUI 宏的代码。这里不要求用户去改全局设置，
# 用 DEVELOPER_DIR 局部指定即可（不需要 sudo）。
XCODE_DEV="/Applications/Xcode.app/Contents/Developer"
HAVE_XCODE=0
if [ -d "$XCODE_DEV" ]; then
  DEVELOPER_DIR="$XCODE_DEV"
  export DEVELOPER_DIR
  HAVE_XCODE=1
fi

SWIFTC=$(xcrun --find swiftc 2>/dev/null || command -v swiftc)
# 指定了 -target 就必须同时给 -sdk，否则找不到那个 target 的标准库
# （只有 Command Line Tools 时它会自己找，切到 Xcode 工具链后不会）
SDK=$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)
"$SWIFTC" --version 2>&1 | head -1 | sed 's/^/  /'
if [ "$HAVE_XCODE" -eq 1 ]; then
  ok "使用 Xcode 工具链（$(xcodebuild -version 2>/dev/null | head -1)）"
else
  skip "只有 Command Line Tools：跳过 xcodebuild，且含 SwiftUI 宏的代码编不过"
fi

# ---------------------------------------------------------------- 1. 配置文件

step "配置文件语法"
for f in TeacherDesk.xcodeproj/project.pbxproj \
         TeacherDesk/Info.plist TeacherDesk/TeacherDesk.entitlements \
         TeacherDeskWidget/Info.plist TeacherDeskWidget/TeacherDeskWidget.entitlements; do
  if plutil -lint "$f" >/dev/null 2>&1; then
    ok "$f"
  else
    bad "$f 语法错误"
    plutil -lint "$f" || true
  fi
done

step "JSON 资源"
for f in TeacherDesk/Assets.xcassets/Contents.json \
         TeacherDesk/Assets.xcassets/AppIcon.appiconset/Contents.json \
         TeacherDesk/Assets.xcassets/AccentColor.colorset/Contents.json \
         Samples/snapshot.sample.json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" "$f" 2>/dev/null; then
    ok "$f"
  else
    bad "$f 不是合法 JSON"
  fi
done

# ---------------------------------------------------------------- 2. 类型检查

SHARED=$(ls Shared/*.swift)
WIDGET="$SHARED $(ls TeacherDeskWidget/*.swift) $(ls TeacherDeskWidget/Views/*.swift)"
HOST="$SHARED $(ls TeacherDesk/*.swift)"

step "类型检查 · 共享层 + Widget 扩展"
if "$SWIFTC" -typecheck -target "$TARGET" -sdk "$SDK" $WIDGET 2>/tmp/td-widget-typecheck.log; then
  ok "$(echo $WIDGET | wc -w | tr -d ' ') 个文件通过"
else
  bad "类型检查失败："
  sed 's/^/    /' /tmp/td-widget-typecheck.log | head -30
fi

step "类型检查 · 共享层 + 宿主 App"
if "$SWIFTC" -typecheck -target "$TARGET" -sdk "$SDK" $HOST 2>/tmp/td-host-typecheck.log; then
  ok "$(echo $HOST | wc -w | tr -d ' ') 个文件通过"
else
  bad "类型检查失败："
  sed 's/^/    /' /tmp/td-host-typecheck.log | head -30
  if grep -q "plugin for module 'SwiftUIMacros' not found" /tmp/td-host-typecheck.log; then
    cat <<'HINT'
    ── 这是环境问题，不是代码问题 ──
    上面那些 "SwiftUIMacros ... plugin not found" 是**没有 Xcode** 造成的：
    @State / #Preview 这类 SwiftUI **宏**的实现插件随 Xcode 安装。
    装 Xcode，或让本脚本找得到它（默认找 /Applications/Xcode.app），即可。
HINT
  fi
fi

# ---------------------------------------------------------------- 3. 冒烟测试

step "冒烟测试 · 快照组装（真编译真运行）"
if "$SWIFTC" -O -target "$TARGET" -sdk "$SDK" -o /tmp/td-snapshot-smoke $SHARED Tools/SnapshotSmoke/main.swift 2>/tmp/td-smoke-build.log; then
  if /tmp/td-snapshot-smoke; then
    ok "冒烟测试通过"
  else
    bad "冒烟测试有断言失败"
  fi
else
  bad "冒烟测试编译失败："
  sed 's/^/    /' /tmp/td-smoke-build.log | head -30
fi

# ---------------------------------------------------------------- 4. Xcode 真编译

if [ "$HAVE_XCODE" -eq 1 ]; then
  step "Xcode 工程 · 解析"
  if xcodebuild -list -project TeacherDesk.xcodeproj >/tmp/td-xclist.log 2>&1; then
    ok "两个 target 都在：$(grep -A2 'Targets:' /tmp/td-xclist.log | tail -2 | tr -d ' ' | tr '\n' ' ')"
  else
    bad "工程解析失败："
    sed 's/^/    /' /tmp/td-xclist.log | head -20
  fi

  step "Xcode 工程 · 真编译（不签名）"
  # CODE_SIGNING_ALLOWED=NO：这个工程不需要签名身份（两个 target 都不开沙箱、
  # entitlements 为空），所以这一步验证的就是「最终那份代码能不能编译出来」。
  if xcodebuild -project TeacherDesk.xcodeproj -scheme TeacherDesk \
       -configuration Debug -destination 'platform=macOS' \
       -derivedDataPath /tmp/td-verify-dd \
       CODE_SIGNING_ALLOWED=NO build >/tmp/td-xcbuild.log 2>&1; then
    ok "BUILD SUCCEEDED（宿主 App + Widget 扩展 + 嵌入 + 资源目录）"
  else
    bad "编译失败："
    grep -E "error:|warning:" /tmp/td-xcbuild.log | head -20 | sed 's/^/    /'
  fi
fi

# ---------------------------------------------------------------- 结论

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m全部通过。\033[0m\n'
else
  printf '\033[31m有项目未通过，见上面的 ✗。\033[0m\n'
fi
cat <<'EOF'

仍然**证明不了**的（要在图形界面里看）：
  · Widget 能不能渲染出来、三种尺寸的排版是否真的好看
  · 时间线按 30 分钟刷新、点「立即同步」后 Widget 是否立刻重画
  · 点击 Widget 能否跳到 Web 页面（.widgetURL / Link 的实际行为）
  · Widget 能否被系统的组件库加载（不开沙箱的扩展，chronod 认不认）
在 Xcode 里 Run 一次宿主 App、再把 Widget 加到桌面，才算这个工程真的成立。
想先看 Widget 长什么样、又不想登录：sh Tools/use-sample-snapshot.sh
EOF

exit "$FAIL"
