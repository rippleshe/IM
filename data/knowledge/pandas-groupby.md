---
id: pandas-groupby
title: pandas 分组统计：groupby 与 value_counts
source: pandas 官方文档要点（group by）
locator: pandas.pydata.org/docs/user_guide/groupby
---
`df["Machine failure"].value_counts()` 统计每个取值出现的次数，适合看故障与正常样本的比例。`df.groupby("Type")["Machine failure"].mean()` 按产品质量等级分组，计算故障率，一行代码回答“哪类产品更容易故障”。常用聚合有 `mean()`、`sum()`、`count()`、`max()`。分组统计的结果可以直接画柱状图，是报告里最有说服力的证据之一。
