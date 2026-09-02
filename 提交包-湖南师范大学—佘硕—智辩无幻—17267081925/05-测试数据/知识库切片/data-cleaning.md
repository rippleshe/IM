---
id: data-cleaning
title: 数据清洗：缺失、重复与类型
source: pandas 官方文档要点（missing data）
locator: pandas.pydata.org/docs/user_guide/missing_data
---
拿到数据先检查质量：`df.isna().sum()` 统计每列缺失值；`df.duplicated().sum()` 检查重复行。处理缺失的两种基本策略是删除 `df.dropna()` 和填充 `df.fillna()`；填充必须说明依据（如用中位数），不能悄悄改数据。字段类型不对时转换：`df["timestamp"] = pd.to_datetime(df["timestamp"])`。清洗的每一步都要记录下来，保证别人能复现你的数据集版本。
