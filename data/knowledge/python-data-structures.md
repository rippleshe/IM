---
id: python-data-structures
title: Python 数据结构：列表与字典
source: Python 官方教程要点
locator: docs.python.org/zh-cn/3/tutorial/datastructures
---
列表（list）按顺序保存多个值：`readings = [7.9, 8.1, 0.0]`，用 `readings[0]` 取第一个元素，`len(readings)` 取长度。字典（dict）用键值对描述一条记录，类似表格的一行：`record = {"timestamp": "2020-04-18 10:00", "TP2": 7.9}`，用 `record["TP2"]` 取值。DataFrame 可以直接由“字典的列表”构建，因此先熟练列表和字典，再学 pandas 会非常顺。
