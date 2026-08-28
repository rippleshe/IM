---
id: dataset-ai4i2020
title: UCI 公开数据集 · AI4I 2020 Predictive Maintenance（压缩机/刀具预测性维护）
source: UCI Machine Learning Repository (https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset)，DOI 10.24432/C5HS5C
locator: UCI Machine Learning Repository (https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset)，DOI 10.24432/C5HS5C
trust: high
---
## 数据集简介
The AI4I 2020 Predictive Maintenance Dataset is a synthetic dataset that reflects real predictive maintenance data encountered in industry.

## 数据集基本特征
- 领域：Computer Science
- 任务类型：Classification、Regression、Causal-Discovery
- 数据形态：Multivariate、Time-Series
- 实例数：10,000
- 特征数：6
- 特征类型：Real
- 缺失值：无
- 创建年份：2020
- 最近更新：Wed Feb 14 2024

## 字段说明
| 字段 | 角色 | 类型 | 说明 |
| --- | --- | --- | --- |
| UID | ID | Integer |  |
| Product ID | ID | Categorical |  |
| Type | Feature | Categorical |  |
| Air temperature | Feature | Continuous | （单位 K） |
| Process temperature | Feature | Continuous | （单位 K） |
| Rotational speed | Feature | Integer | （单位 rpm） |
| Torque | Feature | Continuous | （单位 Nm） |
| Tool wear | Feature | Integer | （单位 min） |
| Machine failure | Target | Integer |  |
| TWF | Target | Integer |  |
| HDF | Target | Integer |  |
| PWF | Target | Integer |  |
| OSF | Target | Integer |  |
| RNF | Target | Integer |  |

## 引用论文
S. Matzka. Explainable Artificial Intelligence for Predictive Maintenance Applications. International Conference on Artificial Intelligence for Industries, 2020.
论文链接：https://www.semanticscholar.org/paper/b609c8e9ec6a2b8c642810953ef6dffe5766f7c1

## 使用边界
- 本卡片是数据集官方描述的摘录，用于让学习代理理解数据来源与字段含义。
- 引用本数据集时须标注 UCI Machine Learning Repository 与官方 DOI。
- 官方 DOI：10.24432/C5HS5C
