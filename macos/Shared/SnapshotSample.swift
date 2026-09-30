//
//  SnapshotSample.swift —— 样例快照（v3.7.0）
//
//  用途只有一个：**让教师在还没连上 TeacherDesk 之前就能看见小组件长什么样**
//  （宿主 App 的「写入样例快照」按钮把它写进容器）。
//
//  这份字符串与 Samples/snapshot.sample.json **逐字节相同**，由 Tools/verify.sh 断言——
//  两处各写一份会漂移，而漂移的表现是「样例看着不对，以为是 Widget 坏了」。
//  它由 Web 侧真正的生成器（src/utils/widgetSnapshot.ts）产出，
//  所以形状必然与线上一致——不是手抄的。
//

import Foundation

enum SnapshotSample {
    /// 样例快照的班级名（宿主 App 用它识别「当前读到的其实是样例」，
    /// 与 `macos/Samples/snapshot.sample.json` 里那一行必须一致——由 Tools/verify.sh 的样例一致性那档盯着）
    static let classLabel = "（样例课表）"

    /// 样例快照的 JSON 文本（内容见文件末尾说明与 Samples/snapshot.sample.json）
    /// 末尾那个换行要显式补：Swift 的多行原始字符串会**吃掉收尾定界符前的那一个换行**
    /// （SE-0168），不补的话与 `Samples/snapshot.sample.json` 差 1 个字节——
    /// 差 1 个字节本身无所谓，但「两处应当逐字节相同」这条断言就没法钉住了。
    static let json = #"""
{
  "schemaVersion": 2,
  "generator": "teacherdesk-web",
  "updatedAt": "2026-09-30T23:30:00.000Z",
  "updatedAtLabel": "10月1日 07:30",
  "pwaBaseUrl": "https://teacher-desk-d6gdsgqb8f9dc13d2-1454430270.tcloudbaseapp.com",
  "className": "（样例课表）",
  "periods": [
    {
      "id": "morning",
      "label": "早自习及第一节",
      "shortLabel": "早自习",
      "startTime": "07:40",
      "endTime": "09:05",
      "order": 1,
      "group": "morning"
    },
    {
      "id": "p2",
      "label": "第2节",
      "shortLabel": "第2节",
      "startTime": "09:20",
      "endTime": "10:00",
      "order": 2,
      "group": "day"
    },
    {
      "id": "p3",
      "label": "第3节",
      "shortLabel": "第3节",
      "startTime": "10:30",
      "endTime": "11:10",
      "order": 3,
      "group": "day"
    },
    {
      "id": "p4",
      "label": "第4节",
      "shortLabel": "第4节",
      "startTime": "11:25",
      "endTime": "12:05",
      "order": 4,
      "group": "day"
    },
    {
      "id": "p5",
      "label": "第5节",
      "shortLabel": "第5节",
      "startTime": "15:00",
      "endTime": "15:40",
      "order": 5,
      "group": "day"
    },
    {
      "id": "p6",
      "label": "第6节",
      "shortLabel": "第6节",
      "startTime": "16:00",
      "endTime": "16:40",
      "order": 6,
      "group": "day"
    },
    {
      "id": "p7",
      "label": "第7节",
      "shortLabel": "第7节",
      "startTime": "16:55",
      "endTime": "17:35",
      "order": 7,
      "group": "day"
    },
    {
      "id": "evening1",
      "label": "晚自习1",
      "shortLabel": "晚自习1",
      "startTime": "19:30",
      "endTime": "20:10",
      "order": 8,
      "group": "evening"
    },
    {
      "id": "evening2",
      "label": "晚自习2",
      "shortLabel": "晚自习2",
      "startTime": "20:20",
      "endTime": "21:00",
      "order": 9,
      "group": "evening"
    },
    {
      "id": "evening3",
      "label": "晚自习3",
      "shortLabel": "晚自习3",
      "startTime": "21:10",
      "endTime": "21:50",
      "order": 10,
      "group": "evening"
    }
  ],
  "week": [
    {
      "weekday": 1,
      "label": "星期一",
      "shortLabel": "周一",
      "lessons": [
        {
          "periodId": "morning",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p2",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p3",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p4",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p5",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p6",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p7",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "evening1",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening2",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening3",
          "className": "高一9班",
          "subject": "数学"
        }
      ]
    },
    {
      "weekday": 2,
      "label": "星期二",
      "shortLabel": "周二",
      "lessons": [
        {
          "periodId": "morning",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p2",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p3",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p4",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p5",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p6",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p7",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "evening1",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening2",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening3",
          "className": "高一9班",
          "subject": "数学"
        }
      ]
    },
    {
      "weekday": 3,
      "label": "星期三",
      "shortLabel": "周三",
      "lessons": [
        {
          "periodId": "morning",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p2",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p3",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p4",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p5",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p6",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p7",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening1",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening2",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening3",
          "className": "高一9班",
          "subject": "数学"
        }
      ]
    },
    {
      "weekday": 4,
      "label": "星期四",
      "shortLabel": "周四",
      "lessons": [
        {
          "periodId": "morning",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p2",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p3",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p4",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p5",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p6",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p7",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "evening1",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening2",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening3",
          "className": "高一9班",
          "subject": "数学"
        }
      ]
    },
    {
      "weekday": 5,
      "label": "星期五",
      "shortLabel": "周五",
      "lessons": [
        {
          "periodId": "morning",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p2",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p3",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p4",
          "className": "高一11班",
          "subject": "数学"
        },
        {
          "periodId": "p5",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "p6",
          "className": "高一10班",
          "subject": "数学"
        },
        {
          "periodId": "p7",
          "className": "高一11班",
          "subject": "班会"
        },
        {
          "periodId": "evening1",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening2",
          "className": "高一9班",
          "subject": "数学"
        },
        {
          "periodId": "evening3",
          "className": "高一9班",
          "subject": "数学"
        }
      ]
    },
    {
      "weekday": 6,
      "label": "星期六",
      "shortLabel": "周六",
      "lessons": []
    },
    {
      "weekday": 7,
      "label": "星期日",
      "shortLabel": "周日",
      "lessons": []
    }
  ]
}
"""# + "\n"

    /// 样例快照（解不开就返回 nil；调用方按「写样例失败」提示）
    static var snapshot: WidgetSnapshot? {
        if case let .ok(snapshot) = SnapshotStore.decode(data: Data(json.utf8)) { return snapshot }
        return nil
    }
}
