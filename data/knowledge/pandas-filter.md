---
id: pandas-filter
title: pandas 筛选：只看感兴趣的行和列
source: pandas 官方文档要点（indexing）
locator: pandas.pydata.org/docs/user_guide/indexing
---
布尔筛选是数据分析最常用的操作：`failed = df[df["Machine failure"] == 1]` 得到所有故障样本。多个条件用 `&`（与）、`|`（或）连接，每个条件要加括号：`df[(df["Torque [Nm]"] > 46) & (df["Tool wear [min]"] > 200)]`。选列用 `df[["Torque [Nm]", "Machine failure"]]`。筛选不改变原数据，得到的是一份“视图结果”，可以继续在其上统计。
