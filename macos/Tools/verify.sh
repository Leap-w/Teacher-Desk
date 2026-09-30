#!/bin/sh
#
#  verify.sh —— macOS Widget 工程的自检（v3.7.0）
#
#  分两档跑，**两档都用同一批源码**：
#
#    【有 Xcode】六档全跑 —— 工程文件一致性、plist / entitlements 关键键、类型检查、
#               快照冒烟、**xcodebuild 真编译**、产物结构断言（appex 是否嵌进 .app、
#               扩展点、URL scheme、沙盒 entitlement）。最后一条是最强的：它证明
#               「小组件真的会被系统当成小组件」这件事的**静态前提**全都成立。
#
#    【只有 Command Line Tools】跳过 xcodebuild 那一档（没有 macOS SDK 之外的打包工具链），
#               其余照跑 —— 数据层与视图层的类型检查在 CLT 下同样成立
#               （本工程刻意不用 `@State` 这类宏，见 TeacherDeskApp.swift 顶部说明）。
#
#  **两档都证明不了**下面这些，它们只能在图形界面里看：
#    · 小组件在组件库里的样子与三种尺寸排版（今日 small/medium、一周 large）
#    · 时间线刷新、点「同步并刷新」后小组件是否立刻重画
#    · 点击小组件是否打开 TeacherDesk
#    · 深色模式下的观感
#  这四项在 docs/release-checklist.md 里有对应的勾选项。
#
#  已知环境问题（脚本自动处理）：本机工作区里的文件带 Finder 信息时，
#  `codesign` 会报 `resource fork, Finder information, or similar detritus not allowed`。
#  脚本在编译前后各清一次 `xattr -cr`。
#

set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
REPO=$(cd "$ROOT/.." && pwd)
cd "$ROOT"

FAIL=0
BUILD_DIR="$ROOT/.build"
DERIVED="$BUILD_DIR/DerivedData"
CONFIG="${CONFIG:-Debug}"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
skip() { printf '  \033[33m—\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------- 0. 工具链

step "工具链"

XCODE_DEV="/Applications/Xcode.app/Contents/Developer"
HAVE_XCODE=0
if [ -d "$XCODE_DEV" ]; then
  DEVELOPER_DIR="$XCODE_DEV"
  export DEVELOPER_DIR
  HAVE_XCODE=1
fi
SWIFTC=$(xcrun --find swiftc 2>/dev/null || command -v swiftc)
SDK=$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)
"$SWIFTC" --version 2>&1 | head -1 | sed 's/^/  /'
if [ "$HAVE_XCODE" -eq 1 ]; then
  ok "使用 Xcode 工具链 · $(xcodebuild -version 2>/dev/null | head -1)"
else
  skip "只有 Command Line Tools：跳过 xcodebuild 与产物断言"
fi

# 沙盒 / 受限环境里的编译缓存必须落在工作区内，否则 swiftc 连标准库都加载不了
CACHE="$BUILD_DIR/ModuleCache"
mkdir -p "$CACHE"

# ---------------------------------------------------------------- 1. 工程文件一致性

step "工程文件一致性（project.yml ↔ project.pbxproj）"

PBX="$ROOT/TeacherDesk.xcodeproj/project.pbxproj"
YML="$ROOT/project.yml"
[ -f "$PBX" ] && ok "TeacherDesk.xcodeproj/project.pbxproj 在" || bad "缺 project.pbxproj"
[ -f "$YML" ] && ok "project.yml（XcodeGen 退路）在" || bad "缺 project.yml"

check_both() {
  # $1 = 正则/字面量，$2 = 说明
  if grep -q "$1" "$PBX" && grep -q "$1" "$YML"; then
    ok "$2"
  else
    bad "$2（两边不一致：pbxproj=$(grep -c "$1" "$PBX") yml=$(grep -c "$1" "$YML")）"
  fi
}

check_both "com.teacherdesk.mac.widget" "Widget 扩展 bundle id 两边一致"
check_both "com.teacherdesk.mac" "宿主 App bundle id 两边一致"
check_both "TeacherDeskWidget.entitlements" "Widget entitlements 路径两边一致"
check_both "MACOSX_DEPLOYMENT_TARGET = 14.0\|macOS: '14.0'" "部署目标两边一致（14.0）"

WEB_VERSION=$(node -e "process.stdout.write(require('$REPO/package.json').version)" 2>/dev/null || echo "?")
MAC_VERSION=$(grep -m1 "MARKETING_VERSION = " "$PBX" | sed 's/.*= //; s/;.*//')
if [ "$WEB_VERSION" = "$MAC_VERSION" ]; then
  ok "版本号与 Web 侧一致 · $WEB_VERSION"
else
  bad "版本号不一致 · Web=$WEB_VERSION macOS=$MAC_VERSION"
fi

# ---------------------------------------------------------------- 2. plist / entitlements

step "plist 与 entitlements 的关键键"

grep -q "com.apple.widgetkit-extension" "$ROOT/TeacherDeskWidget/Info.plist" \
  && ok "Widget 扩展点 = com.apple.widgetkit-extension（少了它小组件库里看不到）" \
  || bad "Widget Info.plist 缺 NSExtensionPointIdentifier"
grep -q "<string>XPC!</string>" "$ROOT/TeacherDeskWidget/Info.plist" \
  && ok "Widget 包类型 = XPC!（写成 APPL 会装不上）" \
  || bad "Widget Info.plist 的 CFBundlePackageType 不是 XPC!"
grep -q "com.apple.security.app-sandbox" "$ROOT/TeacherDeskWidget/TeacherDeskWidget.entitlements" \
  && ok "Widget 扩展开沙盒（**不开沙盒小组件不会出现在库里**）" \
  || bad "Widget entitlements 缺 app-sandbox"
# 只看真正的 <key> 行：entitlements 的**注释里**会提到 network.client（说明以后换 App Group 要怎么加），
# 那是文档不是配置——按字符串粗匹配会把说明文字判成「违规」
if grep -q "<key>com.apple.security.network" "$ROOT/TeacherDeskWidget/TeacherDeskWidget.entitlements"; then
  bad "Widget 不该有联网 entitlement（规格：Widget 不联网）"
else
  ok "Widget 无联网 entitlement（「不联网」是系统强制的）"
fi
grep -q "teacherdesk" "$ROOT/TeacherDesk/Info.plist" \
  && ok "宿主 App 认领 teacherdesk:// 深链" \
  || bad "宿主 Info.plist 缺 CFBundleURLTypes"
if grep -q "app-sandbox" "$ROOT/TeacherDesk/TeacherDesk.entitlements"; then
  bad "宿主 App **不能**开沙盒（它就写不进 Widget 的容器了，见 README）"
else
  ok "宿主 App 不开沙盒（这是它能写进扩展容器的前提）"
fi

# ---------------------------------------------------------------- 3. 类型检查

step "类型检查（全部源码，含 SwiftUI/WidgetKit）"

SOURCES="Shared/SnapshotModel.swift Shared/SnapshotStore.swift Shared/SnapshotDerive.swift Shared/WidgetLinks.swift Shared/SnapshotSample.swift Shared/DesignTokens.swift TeacherDesk/TeacherDeskApp.swift TeacherDesk/HostView.swift TeacherDeskWidget/TeacherDeskWidgetBundle.swift TeacherDeskWidget/TeacherDeskWidgets.swift TeacherDeskWidget/Views/WidgetChrome.swift TeacherDeskWidget/Views/TodayScheduleView.swift TeacherDeskWidget/Views/WeekScheduleView.swift"

if "$SWIFTC" -typecheck -target arm64-apple-macos14.0 -sdk "$SDK" -module-cache-path "$CACHE" -swift-version 5 $SOURCES 2>"$BUILD_DIR/typecheck.log"; then
  ok "13 个源文件类型检查通过（两档工具链都跑得动，因为没有宏）"
else
  bad "类型检查失败：见 $BUILD_DIR/typecheck.log"
  head -20 "$BUILD_DIR/typecheck.log" | sed 's/^/    /'
fi

# ---------------------------------------------------------------- 4. 快照冒烟

step "快照冒烟（解码 / 派生 / 链接 / 样例一致）"

SMOKE_BIN="$BUILD_DIR/snapshot-smoke"
if "$SWIFTC" -O -target arm64-apple-macos14.0 -sdk "$SDK" -module-cache-path "$CACHE" -o "$SMOKE_BIN" \
  Tools/SnapshotSmoke/main.swift Shared/SnapshotModel.swift Shared/SnapshotStore.swift \
  Shared/SnapshotDerive.swift Shared/WidgetLinks.swift Shared/SnapshotSample.swift 2>"$BUILD_DIR/smoke.log"; then
  if "$SMOKE_BIN" | tail -40 | sed 's/^/  /'; then
    ok "快照冒烟全绿"
  else
    bad "快照冒烟有失败项"
  fi
else
  bad "快照冒烟编译失败：见 $BUILD_DIR/smoke.log"
  head -20 "$BUILD_DIR/smoke.log" | sed 's/^/    /'
fi

# ---------------------------------------------------------------- 5. 真编译

step "xcodebuild 真编译（宿主 App + Widget 扩展）"

if [ "$HAVE_XCODE" -eq 1 ]; then
  build_once() {
    xattr -cr "$ROOT" "$DERIVED" 2>/dev/null || true
    xcodebuild -project "$ROOT/TeacherDesk.xcodeproj" -scheme TeacherDesk -configuration "$CONFIG" \
      -derivedDataPath "$DERIVED" build >"$BUILD_DIR/xcodebuild.log" 2>&1
  }
  if build_once; then
    ok "BUILD SUCCEEDED · $CONFIG"
  elif grep -qE "resource fork, Finder information|Disallowed xattr" "$BUILD_DIR/xcodebuild.log"; then
    # 本机的文件系统会给新建目录挂上 Finder 信息，codesign 拒签（`resource fork … detritus`）。
    # 这不是工程的问题，也不会发生在 Xcode 图形界面里；清一次 xattr 再增量重跑即可。
    printf '  \033[33m—\033[0m 遇到 Finder 信息导致 codesign 拒签，清一次 xattr 后重试\n'
    xattr -cr "$DERIVED" 2>/dev/null || true
    if build_once; then
      ok "BUILD SUCCEEDED · $CONFIG · 清 xattr 后重试通过"
    else
      bad "xcodebuild 失败：见 $BUILD_DIR/xcodebuild.log"
      grep -E "error:" "$BUILD_DIR/xcodebuild.log" | head -10 | sed 's/^/    /'
    fi
  else
    bad "xcodebuild 失败：见 $BUILD_DIR/xcodebuild.log"
    grep -E "error:" "$BUILD_DIR/xcodebuild.log" | head -10 | sed 's/^/    /'
  fi
else
  skip "没有 Xcode：跳过真编译"
fi

# ---------------------------------------------------------------- 6. 产物结构

step "产物结构（小组件能被系统收录的静态前提）"

APP="$DERIVED/Build/Products/$CONFIG/TeacherDesk.app"
if [ "$HAVE_XCODE" -eq 1 ] && [ -d "$APP" ]; then
  xattr -cr "$APP" 2>/dev/null || true
  [ -d "$APP/Contents/PlugIns/TeacherDeskWidget.appex" ] \
    && ok "扩展已嵌进 App · Contents/PlugIns/TeacherDeskWidget.appex" \
    || bad "App 里没有嵌 Widget 扩展 —— 小组件不会出现在组件库"

  POINT=$(plutil -extract NSExtension.NSExtensionPointIdentifier raw \
    "$APP/Contents/PlugIns/TeacherDeskWidget.appex/Contents/Info.plist" 2>/dev/null || echo "")
  [ "$POINT" = "com.apple.widgetkit-extension" ] \
    && ok "产物里的扩展点正确" || bad "产物里的扩展点 = 「$POINT」"

  SCHEME=$(plutil -extract CFBundleURLTypes.0.CFBundleURLSchemes.0 raw "$APP/Contents/Info.plist" 2>/dev/null || echo "")
  [ "$SCHEME" = "teacherdesk" ] && ok "产物里的深链方案 = teacherdesk" || bad "产物里没有 teacherdesk 深链"

  if codesign -d --entitlements - "$APP/Contents/PlugIns/TeacherDeskWidget.appex" 2>/dev/null | grep -q "app-sandbox"; then
    ok "扩展签名里带 app-sandbox"
  else
    bad "扩展签名里没有 app-sandbox —— 小组件不会出现在组件库"
  fi

  if codesign -d --entitlements - "$APP/Contents/PlugIns/TeacherDeskWidget.appex" 2>/dev/null | grep -q "network"; then
    bad "扩展签名里出现了联网能力"
  else
    ok "扩展签名里没有联网能力（沙盒 + 无网络 entitlement = 系统级只读）"
  fi

  if codesign --verify --deep --strict "$APP" 2>"$BUILD_DIR/codesign.log"; then
    ok "签名校验通过 · Sign to Run Locally / ad-hoc"
  else
    bad "签名校验失败：$(head -2 "$BUILD_DIR/codesign.log" | tr '\n' ' ')"
  fi

  BUNDLE_ID=$(plutil -p "$APP/Contents/Info.plist" 2>/dev/null | sed -n 's/.*"CFBundleIdentifier" => "\(.*\)"/\1/p')
  ok "产物就绪：TeacherDesk.app（bundle id ${BUNDLE_ID:-?}）+ 内嵌 .appex"
else
  skip "跳过（没有 Xcode 或还没构建）"
fi

# ---------------------------------------------------------------- 汇总

step "结论"
if [ "$FAIL" -eq 0 ]; then
  printf '  \033[32m全部通过\033[0m\n'
  printf '  仍需在图形界面里过一遍的：组件库能否看到 / 三种尺寸排版 / 刷新与点击 / 深色模式\n'
  printf '  （勾选项见 docs/release-checklist.md 附 K）\n'
else
  printf '  \033[31m有未通过项，见上面标 ✗ 的行\033[0m\n'
fi
exit $FAIL
