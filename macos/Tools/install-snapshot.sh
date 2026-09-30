#!/bin/sh
#
#  install-snapshot.sh —— 把一份快照 JSON 放进小组件容器（v3.7.0）
#
#  什么时候用它：**浏览器不支持自动写入文件**时（Safari 目前就是）。
#  正常路径是 TeacherDesk 网页版课程表页 →「macOS 桌面小组件」卡片 →「连接小组件」，
#  一次授权之后课程表一变就自动同步；那条路走不通时才用这个脚本当兜底。
#
#  用法：
#      # ① 在 TeacherDesk 课程表页点「下载快照」，得到 ~/Downloads/widget-snapshot.json
#      sh macos/Tools/install-snapshot.sh ~/Downloads/widget-snapshot.json
#      # ② 或者塞样例看看效果：
#      sh macos/Tools/install-snapshot.sh macos/Samples/snapshot.sample.json
#
#  它只做三件事：建目录、写文件、让宿主 App 去通知小组件刷新。
#  **不改任何业务数据**——那份快照是只读的展示数据。
#

set -e

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

# 与 Shared/SnapshotStore.swift、src/config/index.ts 同一处（改 bundle id 时三处一起改）
WIDGET_BUNDLE_ID="com.teacherdesk.mac.widget"
TARGET_DIR="$HOME/Library/Containers/$WIDGET_BUNDLE_ID/Data/Library/Application Support/TeacherDesk"
TARGET_FILE="$TARGET_DIR/widget-snapshot.json"
APP_PATH="/Applications/TeacherDesk.app"

SOURCE="${1:-}"
if [ -z "$SOURCE" ]; then
  echo "用法：sh macos/Tools/install-snapshot.sh <快照.json>"
  echo "  例：sh macos/Tools/install-snapshot.sh ~/Downloads/widget-snapshot.json"
  echo "  例：sh macos/Tools/install-snapshot.sh macos/Samples/snapshot.sample.json"
  exit 2
fi
if [ ! -f "$SOURCE" ]; then
  echo "找不到文件：$SOURCE"
  exit 2
fi

# 先校验一下是不是一份能解析的快照：塞进去一份坏文件，Widget 会显示「数据读不出来」，
# 而那时教师多半会以为是小组件坏了
if ! plutil -convert json -o - "$SOURCE" >/dev/null 2>&1 && ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$SOURCE" 2>/dev/null; then
  echo "这不是合法的 JSON，先确认下载/拷贝没出错：$SOURCE"
  exit 2
fi

mkdir -p "$TARGET_DIR"
cp "$SOURCE" "$TARGET_FILE"
echo "已写入：$TARGET_FILE"

# 让宿主 App 去调 WidgetCenter.reloadAllTimelines()
# （脚本进程自己调不了：那个 API 只属于 App/扩展进程）
if [ -d "$APP_PATH" ]; then
  open "$APP_PATH"
  echo "已打开 TeacherDesk.app，它会通知小组件刷新（几秒内桌面上的小组件会重画）"
else
  echo "提示：还没把 TeacherDesk.app 放进「应用程序」。"
  echo "     小组件库要看到它，必须先把构建出来的 .app 拷到 /Applications 并运行一次："
  echo "       cp -R \"$ROOT/.build/DerivedData/Build/Products/Debug/TeacherDesk.app\" /Applications/"
  echo "       open /Applications/TeacherDesk.app"
fi
