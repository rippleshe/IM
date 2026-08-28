---
id: pandas-reading
title: pandas 入门：读取与观察数据
source: pandas 官方文档要点（10 minutes to pandas）
locator: pandas.pydata.org/docs/user_guide/10min
---
`import pandas as pd` 后，用 `pd.read_csv("ai4i_2020.csv")` 把 CSV 读成 DataFrame。第一步永远先观察：`df.shape` 看行数列数；`df.head()` 看前几行；`df.info()` 看每列类型和缺失情况；`df.describe()` 看数值列的均值、分位数等统计。拿到任何新数据集，先做这四步，再谈分析结论，这是可复现分析的基本功。
