---
id: statistics-basics
title: 统计基础：均值、分位数与相关性
source: 描述统计通用方法要点
locator: pandas.pydata.org/docs/user_guide/basics
---
均值受极端值影响，中位数和分位数（`df["x"].quantile([0.25, 0.5, 0.97])`）更稳健；判断异常常用分位数法，例如超过 97% 分位视为显著偏高。标准差（`std()`）衡量波动幅度。`df[["Torque [Nm]", "Rotational speed [rpm]"]].corr()` 计算列间相关系数：扭矩与转速通常呈强负相关，若某段时间关系突然改变，本身就是值得记录的异常线索。
