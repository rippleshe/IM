---
id: python-basics
title: Python 基础：变量、类型与函数
source: Python 官方教程要点
locator: docs.python.org/zh-cn/3/tutorial
---
Python 用变量保存数据，常见类型有整数、浮点数、字符串和布尔值。`pressure = 7.9` 创建一个浮点数变量；`f"当前压力 {pressure} bar"` 用 f-string 把数值拼进文本。函数用 `def` 定义，把一段可复用的计算封装起来，例如 `def to_celsius(k): return k - 273.15`。处理设备数据时，建议把“读取—计算—输出”写成小函数，方便检查和复用。缩进是 Python 语法的一部分，同一代码块必须保持相同缩进。
