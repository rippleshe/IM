---
id: time-series-basics
title: 时序基础：时间索引与滑动窗口
source: pandas 官方文档要点（time series）
locator: pandas.pydata.org/docs/user_guide/timeseries
---
设备传感器数据是时间序列：把时间列转成 `pd.to_datetime` 并 `set_index` 后，就能按时间切片，如 `df["2020-04-18":"2020-04-19"]`。`df.resample("1H").mean()` 把秒级数据聚合成小时均值；`df["TP2"].rolling(window=60).mean()` 计算滑动平均，抹平瞬时抖动、突出趋势。观察异常窗口时，先画原始曲线，再叠加滑动平均，对比哪里出现了持续的偏离。
