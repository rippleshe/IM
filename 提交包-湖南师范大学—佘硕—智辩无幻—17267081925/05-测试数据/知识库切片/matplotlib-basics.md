---
id: matplotlib-basics
title: 可视化基础：折线图与直方图
source: matplotlib 官方教程要点
locator: matplotlib.org/stable/tutorials
---
`import matplotlib.pyplot as plt` 后，折线图 `plt.plot(df["TP2"])` 适合看变量随时间的变化；直方图 `plt.hist(df["Torque [Nm]"], bins=30)` 适合看分布形状。画图三要素别省略：标题 `plt.title()`、轴标签 `plt.xlabel()/plt.ylabel()`、多曲线时加 `plt.legend()`。设备诊断里最常用的组合是：时序折线图看异常窗口，直方图看正常与故障样本的分布差异。
