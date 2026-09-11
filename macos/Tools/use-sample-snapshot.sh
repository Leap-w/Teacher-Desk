#!/bin/sh
#
#  use-sample-snapshot.sh —— 把样例快照塞进共享目录
#
#  用途：**在还没登录之前**，先把三个 Widget 摆到桌面上看看长什么样。
#  它绕过了宿主 App 与 CloudBase，直接往快照目录里写一份
#  `Samples/snapshot.sample.json`，Widget 读到就正常渲染。
#
#  这不是旁路业务数据——Widget 本来就是只读的，写进去的也只是一份样例。
#  真正的数据仍然由宿主 App 登录后同步覆盖。想清掉样例，跑：
#      rm -f "$HOME/Library/Application Support/TeacherDesk/widget-snapshot.json"
#
#  用法：
#      sh Tools/use-sample-snapshot.sh                  # 用样例里的空 Web 地址
#      sh Tools/use-sample-snapshot.sh https://xxx/     # 顺便把点击跳转的地址设上
#
set -e

DIR="$HOME/Library/Application Support/TeacherDesk"
DEST="$DIR/widget-snapshot.json"

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/../Samples/snapshot.sample.json"

if [ ! -f "$SRC" ]; then
  echo "找不到样例文件：$SRC" >&2
  exit 1
fi

mkdir -p "$DIR"

if [ -n "$1" ]; then
  # 只改 pwaBaseURL 这一个字段，其余原样搬过去
  python3 -c '
import json,sys
p,url = sys.argv[1], sys.argv[2]
d = json.load(open(p, encoding="utf-8"))
d["pwaBaseURL"] = url
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
' "$SRC" "$1"
  echo "已把 Web 地址写进样例：$1"
fi

cp "$SRC" "$DEST"
echo "样例快照已写入："
echo "  $DEST"
echo
echo "接下来：把 Widget 添加到桌面（右键桌面 → 编辑小组件 → 搜 TeacherDesk），"
echo "三个都加上去看一眼。样例课程是周一到周五，周末打开会看到空态，那是正常的。"
