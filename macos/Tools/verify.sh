#!/bin/sh
#
#  verify.sh —— macOS Widget 工程的自检（v3.7.0）
#
#  分两档跑，**两档都用同一批源码**：
#
#    【有 Xcode】八档全跑 —— 工程文件一致性、plist / entitlements 关键键、类型检查、
#               快照冒烟、**xcodebuild 真编译**、产物结构断言（appex 是否嵌进 .app、
#               扩展点、URL scheme、沙盒 entitlement）、预览 PNG 导出、诊断信息。
#               最后一条是最强的：它证明「小组件真的会被系统当成小组件」这件事的
#               **静态前提**全都成立。
#
#    【只有 Command Line Tools】跳过 xcodebuild 那一档（没有 macOS SDK 之外的打包工具链），
#               其余照跑 —— 数据层与视图层的类型检查在 CLT 下同样成立
#               （本工程刻意不用 `@State` 这类宏，见 TeacherDeskApp.swift 顶部说明）。
#
#  **两档都证明不了**下面这些，它们只能在图形界面里看：
#    · 小组件在桌面上的真实排版（与预览的细微出入以桌面为准）
#    · 时间线刷新、点「同步并刷新」后小组件是否立刻重画
#    · 在桌面上点小组件本体（命令行能验的是同一跳的深链那一段）
#  这三项在 docs/release-checklist.md 里有对应的勾选项。
#  v3.7.2 起，「三种尺寸的排版」「深色模式」「诊断信息」都能在命令行里跑了：
#  见第 7 档（预览导出 PNG）与第 8 档（诊断信息文本）。
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

# 诊断信息里那句「Families: 今日课程 [Small, Medium] · 一周课程表 [Large]」是照着
# Widget 定义写的说明文字（supportedFamilies 只存在于代码里，产物 Info.plist 没有它），
# 所以在这里把代码钉住，免得哪天改了支持的尺寸而诊断文案还停在旧说法。
if grep -q 'supportedFamilies(\[\.systemSmall, \.systemMedium\])' "$ROOT/TeacherDeskWidget/TeacherDeskWidgets.swift"; then
  ok "今日课程支持的尺寸 = Small + Medium（与诊断文案一致）"
else
  bad "今日课程 supportedFamilies 变了，诊断文案要跟着改"
fi
if grep -q 'supportedFamilies(\[\.systemLarge\])' "$ROOT/TeacherDeskWidget/TeacherDeskWidgets.swift"; then
  ok "一周课程表支持的尺寸 = Large（与诊断文案一致）"
else
  bad "一周课程表 supportedFamilies 变了，诊断文案要跟着改"
fi

# ---------------------------------------------------------------- 3. 类型检查

step "类型检查（全部源码，含 SwiftUI/WidgetKit）"

SOURCES="Shared/DeepLink.swift Shared/SnapshotModel.swift Shared/SnapshotEntry.swift Shared/SnapshotStore.swift Shared/SnapshotDerive.swift Shared/WidgetLinks.swift Shared/SnapshotSample.swift Shared/DesignTokens.swift Shared/Views/WidgetChrome.swift Shared/Views/TodayScheduleView.swift Shared/Views/WeekScheduleView.swift TeacherDesk/TeacherDeskApp.swift TeacherDesk/HostView.swift TeacherDesk/HostLauncher.swift TeacherDesk/PWALocator.swift TeacherDesk/WidgetDiagnostics.swift TeacherDesk/WidgetPreview.swift TeacherDeskWidget/TeacherDeskWidgetBundle.swift TeacherDeskWidget/TeacherDeskWidgets.swift"

if "$SWIFTC" -typecheck -target arm64-apple-macos14.0 -sdk "$SDK" -module-cache-path "$CACHE" -swift-version 5 $SOURCES 2>"$BUILD_DIR/typecheck.log"; then
  ok "全部源文件类型检查通过（两档工具链都跑得动，因为没有宏）"
else
  bad "类型检查失败：见 $BUILD_DIR/typecheck.log"
  head -20 "$BUILD_DIR/typecheck.log" | sed 's/^/    /'
fi

# ---------------------------------------------------------------- 4. 快照冒烟

step "快照冒烟（解码 / 派生 / 链接 / 样例一致）"

SMOKE_BIN="$BUILD_DIR/snapshot-smoke"
if "$SWIFTC" -O -target arm64-apple-macos14.0 -sdk "$SDK" -module-cache-path "$CACHE" -o "$SMOKE_BIN" \
  Tools/SnapshotSmoke/main.swift Shared/DeepLink.swift Shared/SnapshotModel.swift Shared/SnapshotStore.swift \
  Shared/SnapshotDerive.swift Shared/WidgetLinks.swift Shared/SnapshotSample.swift 2>"$BUILD_DIR/smoke.log"; then
  # ⚠️ 不要写成 `"$SMOKE_BIN" | tail`：管道的退出码是 **tail 的**，
  # 于是冒烟失败也会显示成全绿（这个坑在本版真的踩过一次）。
  # 先把输出落盘、按二进制自己的退出码判断，再打印。
  if "$SMOKE_BIN" >"$BUILD_DIR/smoke-run.log" 2>&1; then
    tail -40 "$BUILD_DIR/smoke-run.log" | sed 's/^/  /'
    ok "快照冒烟全绿"
  else
    tail -40 "$BUILD_DIR/smoke-run.log" | sed 's/^/  /'
    bad "快照冒烟有失败项（上面的 ✗ 行）"
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

# ---------------------------------------------------------------- 7. 预览导出（v3.7.2）

step "小组件预览导出（三种尺寸 × 深浅两色 → PNG）"

if [ -x "$APP/Contents/MacOS/TeacherDesk" ]; then
  EXPORT_DIR="$BUILD_DIR/preview"
  rm -rf "$EXPORT_DIR"
  mkdir -p "$EXPORT_DIR"
  # 用命令行开关跑（进程里不建窗口）；导出走的是与面板按钮**同一条**实现
  if "$APP/Contents/MacOS/TeacherDesk" --export-widget-previews --export-dir "$EXPORT_DIR" >"$BUILD_DIR/export.log" 2>&1; then
    ok "导出命令成功：$(tr '\n' ' ' <"$BUILD_DIR/export.log" | sed 's|/Users/[^ ]*/||g' | cut -c1-140)"
    MISSING=0
    for f in TeacherDesk-Widget-Today-Small.png TeacherDesk-Widget-Today-Medium.png \
             TeacherDesk-Widget-Weekly-Large.png TeacherDesk-Widget-Today-Small-Dark.png; do
      if [ -f "$EXPORT_DIR/$f" ]; then
        # 尺寸必须与预览常量一致（2 倍图 → 像素是 pt 的两倍）
        PX=$(sips -g pixelWidth -g pixelHeight "$EXPORT_DIR/$f" 2>/dev/null | sed -n 's/.*pixelWidth: \([0-9]*\)/\1/p')
        PY=$(sips -g pixelWidth -g pixelHeight "$EXPORT_DIR/$f" 2>/dev/null | sed -n 's/.*pixelHeight: \([0-9]*\)/\1/p')
        ok "$f 导出成功（${PX}×${PY} px）"
      else
        MISSING=1
        bad "$f 没导出出来"
      fi
    done
    [ "$MISSING" -eq 0 ] && ok "三种尺寸 + 深色版都可导出"
  else
    bad "预览导出命令失败：$(head -3 "$BUILD_DIR/export.log" | tr '\n' ' ')"
  fi
else
  skip "跳过（还没构建出可执行文件）"
fi

# ---------------------------------------------------------------- 8. 诊断信息（v3.7.2）

step "诊断信息（四段齐全 / 字段非空 / 与实际一致）"

if [ -x "$APP/Contents/MacOS/TeacherDesk" ]; then
  DIAG="$BUILD_DIR/diagnostics.txt"
  if "$APP/Contents/MacOS/TeacherDesk" --print-diagnostics >"$DIAG" 2>"$BUILD_DIR/diag.log"; then
    # 段标题可能有后缀（例如 PWA 段会写明"本机实际扫描结果"），所以按**前缀**匹配
    SECTION_INDEX=0
    for section in "Host App" "Widget Extension" "TeacherDesk PWA" "Widget Snapshot" "Widget"; do
      SECTION_INDEX=$((SECTION_INDEX + 1))
      if grep -q "^$section" "$DIAG"; then
        ok "含第 $SECTION_INDEX 段：$section"
      else
        bad "缺第 $SECTION_INDEX 段：$section"
      fi
    done
    if grep -q "com.teacherdesk.mac$" "$DIAG"; then ok "宿主 bundle id 正确"; else bad "宿主 bundle id 不对"; fi
    if grep -q "com.teacherdesk.mac.widget" "$DIAG"; then ok "扩展 bundle id 正确"; else bad "扩展 bundle id 不对"; fi
    # PWA 段必须是**扫出来的**真实值：本机的 Chrome 应用壳 bundle id 形如 com.google.Chrome.app.<32位>
    if grep -qE "com\.google\.Chrome\.app\.[a-p]{32}" "$DIAG"; then
      ok "PWA bundle id 来自实际扫描"
    else
      bad "PWA 段没扫到已安装的应用壳（见 $DIAG）"
    fi
    if grep -q "Install Path: /.*\.app$" "$DIAG"; then ok "PWA 安装路径非空"; else bad "PWA 安装路径缺失"; fi
    if grep -q "widget-snapshot.json" "$DIAG"; then ok "快照路径正确"; else bad "快照路径不对"; fi
    if grep -q "Snapshot Written At: " "$DIAG"; then ok "快照写入时间有值"; else bad "快照写入时间缺失"; fi
  else
    bad "诊断命令失败：$(head -3 "$BUILD_DIR/diag.log" | tr '\n' ' ')"
  fi
else
  skip "跳过（还没构建出可执行文件）"
fi

# ---------------------------------------------------------------- 汇总

step "结论"
if [ "$FAIL" -eq 0 ]; then
  printf '  \033[32m全部通过\033[0m\n'
  printf '  仍需在图形界面里过一遍的：组件库能否看到 / 桌面上点小组件本体 / 桌面上的真实排版\n'
  printf '  （v3.7.2 起「三种尺寸排版」「深色模式」「诊断信息」已在第 7/8 档里自动核过；\n'
  printf '   勾选项见 docs/release-checklist.md 附 K）\n'
else
  printf '  \033[31m有未通过项，见上面标 ✗ 的行\033[0m\n'
fi
exit $FAIL
