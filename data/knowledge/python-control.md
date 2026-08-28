---
id: python-control
title: Python 流程控制：条件与循环
source: Python 官方教程要点
locator: docs.python.org/zh-cn/3/tutorial/controlflow
---
`if / elif / else` 根据条件分支，例如判断传感器读数是否越限：`if value > limit: print("超限")`。`for` 循环遍历列表或表格列，对每条记录执行相同处理；`range(n)` 生成整数序列。处理异常用 `try / except`：读取文件或解析字段失败时给出提示而不是让程序崩溃。数据分析脚本里最常见的组合是“循环 + 条件”，用来逐行筛查异常记录。
