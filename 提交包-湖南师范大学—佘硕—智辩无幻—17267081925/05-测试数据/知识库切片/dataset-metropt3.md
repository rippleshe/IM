---
id: dataset-metropt3
title: UCI 公开数据集 · MetroPT-3（地铁压缩机 APU 运行与故障数据）
source: UCI Machine Learning Repository (https://archive.ics.uci.edu/dataset/791/metropt+3+dataset)，DOI 10.24432/C5VW3R
locator: UCI Machine Learning Repository (https://archive.ics.uci.edu/dataset/791/metropt+3+dataset)，DOI 10.24432/C5VW3R
trust: high
---
## 数据集简介
From a metro train in an operational context, readings from pressure, temperature, motor current, and air intake valves were collected from a compressor's Air Production Unit (APU). This dataset reveals real predictive maintenance challenges encountered in the industry. It can be used for failure predictions, anomaly explanations, and other tasks.

## 数据集基本特征
- 领域：Computer Science
- 任务类型：Classification
- 数据形态：Tabular、Multivariate、Time-Series
- 实例数：1,516,948
- 特征数：15
- 特征类型：Real
- 缺失值：无
- 创建年份：2021
- 最近更新：Thu Sep 19 2024

## 字段说明
| 字段 | 角色 | 类型 | 说明 |
| --- | --- | --- | --- |
| index | ID | Integer | index of data |
| timestamp | Other | Categorical | date time |
| TP2 | Feature | Continuous | （单位 bar） |
| TP3 | Feature | Continuous | （单位 bar） |
| H1 | Feature | Continuous | （单位 bar） |
| DV_pressure | Feature | Continuous | （单位 bar） |
| Reservoirs | Feature | Continuous | （单位 bar） |
| Oil_temperature | Feature | Continuous | （单位 0C） |
| Motor_current | Feature | Continuous | （单位 A） |
| COMP | Feature | Continuous |  |
| DV_eletric | Feature | Continuous |  |
| Towers | Feature | Continuous |  |
| MPG | Feature | Continuous |  |
| LPS | Feature | Continuous |  |
| Pressure_switch | Feature | Continuous |  |
| Oil_level | Feature | Continuous |  |
| Caudal_impulses | Feature | Continuous |  |

## 引用论文
Davari, N., Veloso, B., Ribeiro, R.P., Pereira, P.M., Gama. Predictive maintenance based on anomaly detection using deep learning for air production unit in the railway industry. 2021 IEEE 8th International Conference on Data Science and Advanced Analytics (DSAA), 2021.
论文链接：https://ieeexplore.ieee.org/abstract/document/9564181

## 使用边界
- 本卡片是数据集官方描述的摘录，用于让学习代理理解数据来源与字段含义。
- 引用本数据集时须标注 UCI Machine Learning Repository 与官方 DOI。
- 官方 DOI：10.24432/C5VW3R
