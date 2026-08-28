---
id: docs-pandas-window
title: pandas 官方文档 · Windowing operations（滑动窗口）
source: pandas 官方文档，BSD 许可 (https://pandas.pydata.org/docs/user_guide/window.html)
locator: https://pandas.pydata.org/docs/user_guide/window.html
trust: high
---
*
* User Guide
* Windowing operations

# Windowing operations

pandas contains a compact set of APIs for performing windowing operations - an operation that performs an aggregation over a sliding partition of values. The API functions similarly to the `groupby` API in that Series and DataFrame call the windowing method with necessary parameters and then subsequently call the aggregation function.

In [1]: s = pd.Series(range(5))

In [2]: s.rolling(window=2).sum()
Out[2]:
0    NaN
1    1.0
2    3.0
3    5.0
4    7.0
dtype: float64

The windows are comprised by looking back the length of the window from the current observation. The result above can be derived by taking the sum of the following windowed partitions of data:

In [3]: for window in s.rolling(window=2):
   ...:     print(window)
   ...:
0    0
dtype: int64
0    0
1    1
dtype: int64
1    1
2    2
dtype: int64
2    2
3    3
dtype: int64
3    3
4    4
dtype: int64

## Overview

pandas supports 4 types of windowing operations:

1. Rolling window: Generic fixed or variable sliding window over the values.
2. Weighted window: Weighted, non-rectangular window supplied by the `scipy.signal` library.
3. Expanding window: Accumulating window over the values.
4. Exponentially Weighted window: Accumulating and exponentially weighted window over the values.

| Concept                       | Method    | Returned Object                           | Supports time-based windows | Supports chained groupby | Supports table method   | Supports online operations |
| ----------------------------- | --------- | ----------------------------------------- | --------------------------- | ------------------------ | ----------------------- | -------------------------- |
| Rolling window                | rolling   | pandas.typing.api.Rolling                 | Yes                         | Yes                      | Yes (as of version 1.3) | No                         |
| Weighted window               | rolling   | pandas.typing.api.Window                  | No                          | No                       | No                      | No                         |
| Expanding window              | expanding | pandas.typing.api.Expanding               | No                          | Yes                      | Yes (as of version 1.3) | No                         |
| Exponentially Weighted window | ewm       | pandas.typing.api.ExponentialMovingWindow | No                          | Yes (as of version 1.2)  | No                      | Yes (as of version 1.3)    |

As noted above, some operations support specifying a window based on a time offset:

In [4]: s = pd.Series(range(5), index=pd.date_range('2020-01-01', periods=5, freq='1D'))

In [5]: s.rolling(window='2D').sum()
Out[5]:
2020-01-01    0.0
2020-01-02    1.0
2020-01-03    3.0
2020-01-04    5.0
2020-01-05    7.0
Freq: D, dtype: float64

Additionally, some methods support chaining a `groupby` operation with a windowing operation which will first group the data by the specified keys and then perform a windowing operation per group.

In [6]: df = pd.DataFrame({'A': ['a', 'b', 'a', 'b', 'a'], 'B': range(5)})

In [7]: df.groupby('A').expanding().sum()
Out[7]:
       B
A
a 0  0.0
  2  2.0
  4  6.0
b 1  1.0
  3  4.0

Note

Windowing operations currently only support numeric data (integer and float) and will always return `float64` values.

Warning

Some windowing aggregation, `mean`, `sum`, `var` and `std` methods may suffer from numerical imprecision due to the underlying windowing algorithms accumulating sums. When values differ with magnitude `1/np.finfo(np.double).eps` (approximately \\(4.5 \\times 10^{15}\\)), this results in truncation. It must be noted, that large values may have an impact on windows, which do not include these values. Kahan summation is used to compute the rolling sums to preserve accuracy as much as possible.

Some windowing operations also support the `method='table'` option in the constructor which performs the windowing operation over an entire DataFrame instead of a single column at a time. This can provide a useful performance benefit for a DataFrame with many columns or the ability to utilize other columns during the windowing operation. The `method='table'` option can only be used if `engine='numba'` is specified in the corresponding method call.

For example, a weighted mean calculation can be calculated with `apply()` by specifying a separate column of weights.

In [8]: def weighted_mean(x):
   ...:     arr = np.ones((1, x.shape[1]))
   ...:     arr[:, :2] = (x[:, :2] * x[:, 2]).sum(axis=0) / x[:, 2].sum()
   ...:     return arr
   ...:

In [9]: df = pd.DataFrame([[1, 2, 0.6], [2, 3, 0.4], [3, 4, 0.2], [4, 5, 0.7]])

In [10]: df.rolling(2, method="table", min_periods=0).apply(weighted_mean, raw=True, engine="numba")  # noqa: E501
Out[10]:
          0         1    2
0  1.000000  2.000000  1.0
1  1.800000  2.000000  1.0
2  3.333333  2.333333  1.0
3  1.555556  7.000000  1.0

Some windowing operations also support an `online` method after constructing a windowing object which returns a new object that supports passing in new DataFrame or Series objects to continue the windowing calculation with the new values (i.e. online calculations).

The methods on this new windowing objects must call the aggregation method first to “prime” the initial state of the online calculation. Then, new DataFrame or Series objects can be passed in the `update` argument to continue the windowing calculation.

In [11]: df = pd.DataFrame([[1, 2, 0.6], [2, 3, 0.4], [3, 4, 0.2], [4, 5, 0.7]])

In [12]: df.ewm(0.5).mean()
Out[12]:
          0         1         2
0  1.000000  2.000000  0.600000
1  1.750000  2.750000  0.450000
2  2.615385  3.615385  0.276923
3  3.550000  4.550000  0.562500

In [13]: online_ewm = df.head(2).ewm(0.5).online()

In [14]: online_ewm.mean()
Out[14]:
      0     1     2
0  1.00  2.00  0.60
1  1.75  2.75  0.45

In [15]: online_ewm.mean(update=df.tail(1))
Out[15]:
          0         1         2
3  3.307692  4.307692  0.623077

All windowing operations support a `min_periods` argument that dictates the minimum amount of non-`np.nan` values a window must have; otherwise, the resulting value is `np.nan`. `min_periods` defaults to 1 for time-based windows and `window` for fixed windows

In [16]: s = pd.Series([np.nan, 1, 2, np.nan, np.nan, 3])

In [17]: s.rolling(window=3, min_periods=1).sum()
Out[17]:
0    NaN
1    1.0
2    3.0
3    3.0
4    2.0
5    3.0
dtype: float64

In [18]: s.rolling(window=3, min_periods=2).sum()
Out[18]:
0    NaN
1    NaN
2    3.0
3    3.0
4    NaN
5    NaN
dtype: float64

# Equivalent to min_periods=3
In [19]: s.rolling(window=3, min_periods=None).sum()
Out[19]:
0   NaN
1   NaN
2   NaN
3   NaN
4   NaN
5   NaN
dtype: float64

Additionally, all windowing operations supports the `aggregate` method for returning a result of multiple aggregations applied to a window.

In [20]: df = pd.DataFrame({"A": range(5), "B": range(10, 15)})

In [21]: df.expanding().agg(["sum", "mean", "std"])
Out[21]:
      A                    B
    sum mean       std   sum  mean       std
0   0.0  0.0       NaN  10.0  10.0       NaN
1   1.0  0.5  0.707107  21.0  10.5  0.707107
2   3.0  1.0  1.000000  33.0  11.0  1.000000
3   6.0  1.5  1.290994  46.0  11.5  1.290994
4  10.0  2.0  1.581139  60.0  12.0  1.581139

## Rolling window

Generic rolling windows support specifying windows as a fixed number of observations or variable number of observations based on an offset. If a time based offset is provided, the corresponding time based index must be monotonic.

In [22]: times = ['2020-01-01', '2020-01-03', '2020-01-04', '2020-01-05', '2020-01-29']

In [23]: s = pd.Series(range(5), index=pd.DatetimeIndex(times))

In [24]: s
Out[24]:
2020-01-01    0
2020-01-03    1
2020-01-04    2
2020-01-05    3
2020-01-29    4
dtype: int64

# Window with 2 observations
In [25]: s.rolling(window=2).sum()
Out[25]:
2020-01-01    NaN
2020-01-03    1.0
2020-01-04    3.0
2020-01-05    5.0
2020-01-29    7.0
dtype: float64

# Window with 2 days worth of observations
In [26]: s.rolling(window='2D').sum()
Out[26]:
2020-01-01    0.0
2020-01-03    1.0
2020-01-04    3.0
2020-01-05    5.0
2020-01-29    4.0
dtype: float64

For all supported aggregation functions, see Rolling window functions.

### Centering windows

By default the labels are set to the right edge of the window, but a `center` keyword is available so the labels can be set at the center.

In [27]: s = pd.Series(range(10))

In [28]: s.rolling(window=5).mean()
Out[28]:
0    NaN
1    NaN
2    NaN
3    NaN
4    2.0
5    3.0
6    4.0
7    5.0
8    6.0
9    7.0
dtype: float64

In [29]: s.rolling(window=5, center=True).mean()
Out[29]:
0    NaN
1    NaN
2    2.0
3    3.0
4    4.0
5    5.0
6    6.0
7    7.0
8    NaN
9    NaN
dtype: float64

This can also be applied to datetime-like indices.

In [30]: df = pd.DataFrame(
   ....:     {"A": [0, 1, 2, 3, 4]}, index=pd.date_range("2020", periods=5, freq="1D")
   ....: )
   ....:

In [31]: df
Out[31]:
            A
2020-01-01  0
2020-01-02  1
2020-01-03  2
2020-01-04  3
2020-01-05  4

In [32]: df.rolling("2D", center=False).mean()
Out[32]:
              A
2020-01-01  0.0
2020-01-02  0.5
2020-01-03  1.5
2020-01-04  2.5
2020-01-05  3.5

In [33]: df.rolling("2D", center=True).mean()
Out[33]:
              A
2020-01-01  0.5
2020-01-02  1.5
2020-01-03  2.5
2020-01-04  3.5
2020-01-05  4.0

### Rolling window endpoints

The inclusion of the interval endpoints in rolling window calculations can be specified with the `closed`parameter:

| Value     | Behavior             |
| --------- | -------------------- |
| 'right'   | close right endpoint |
| 'left'    | close left endpoint  |
| 'both'    | close both endpoints |
| 'neither' | open endpoints       |

For example, having the right endpoint open is useful in many problems that require that there is no contamination from present information back to past information. This allows the rolling window to compute statistics “up to that point in time”, but not including that point in time.

In [34]: df = pd.DataFrame(
   ....:     {"x": 1},
   ....:     index=[
   ....:         pd.Timestamp("20130101 09:00:01"),
   ....:         pd.Timestamp("20130101 09:00:02"),
   ....:         pd.Timestamp("20130101 09:00:03"),
   ....:         pd.Timestamp("20130101 09:00:04"),
   ....:         pd.Timestamp("20130101 09:00:06"),
   ....:     ],
   ....: )
   ....:

In [35]: df["right"] = df.rolling("2s", closed="right").x.sum()  # default

In [36]: df["both"] = df.rolling("2s", closed="both").x.sum()

In [37]: df["left"] = df.rolling("2s", closed="left").x.sum()

In [38]: df["neither"] = df.rolling("2s", closed="neither").x.sum()

In [39]: df
Out[39]:
                     x  right  both  left  neither
2013-01-01 09:00:01  1    1.0   1.0   NaN      NaN
2013-01-01 09:00:02  1    2.0   2.0   1.0      1.0
2013-01-01 09:00:03  1    2.0   3.0   2.0      1.0
2013-01-01 09:00:04  1    2.0   3.0   2.0      1.0
2013-01-01 09:00:06  1    1.0   2.0   1.0      NaN

### Custom window rolling

In addition to accepting an integer or offset as a `window` argument, `rolling` also accepts a `BaseIndexer` subclass that allows a user to define a custom method for calculating window bounds. The `BaseIndexer` subclass will need to define a `get_window_bounds` method that returns a tuple of two arrays, the first being the starting indices of the windows and second being the ending indices of the windows. Additionally, `num_values`, `min_periods`, `center`, `closed`and `step` will automatically be passed to `get_window_bounds` and the defined method must always accept these arguments.

For example, if we have the following DataFrame

In [40]: use_expanding = [True, False, True, False, True]

In [41]: use_expanding
Out[41]: [True, False, True, False, True]

In [42]: df = pd.DataFrame({"values": range(5)})

In [43]: df
Out[43]:
   values
0       0
1       1
2       2
3       3
4       4

and we want to use an expanding window where `use_expanding` is `True` otherwise a window of size 1, we can create the following `BaseIndexer` subclass:

In [44]: from pandas.api.indexers import BaseIndexer

In [45]: class CustomIndexer(BaseIndexer):
   ....:      def get_window_bounds(self, num_values, min_periods, center, closed, step):
   ....:          start = np.empty(num_values, dtype=np.int64)
   ....:          end = np.empty(num_values, dtype=np.int64)
   ....:          for i in range(num_values):
   ....:              if self.use_expanding[i]:
   ....:                  start[i] = 0
   ....:                  end[i] = i + 1
   ....:              else:
   ....:                  start[i] = i
   ....:                  end[i] = i + self.window_size
   ....:          return start, end
   ....:

In [46]: indexer = CustomIndexer(window_size=1, use_expanding=use_expanding)

In [47]: df.rolling(indexer).sum()
Out[47]:
   values
0     0.0
1     1.0
2     3.0
3     3.0
4    10.0

You can view other examples of `BaseIndexer` subclasses here

One subclass of note within those examples is the `VariableOffsetWindowIndexer` that allows rolling operations over a non-fixed offset like a `BusinessDay`.

In [48]: from pandas.api.indexers import VariableOffsetWindowIndexer

In [49]: df = pd.DataFrame(range(10), index=pd.date_range("2020", periods=10))

In [50]: offset = pd.offsets.BDay(1)

In [51]: indexer = VariableOffsetWindowIndexer(index=df.index, offset=offset)

In [52]: df
Out[52]:
            0
2020-01-01  0
2020-01-02  1
2020-01-03  2
2020-01-04  3
2020-01-05  4
2020-01-06  5
2020-01-07  6
2020-01-08  7
2020-01-09  8
2020-01-10  9

In [53]: df.rolling(indexer).sum()
Out[53]:
               0
2020-01-01   0.0
2020-01-02   1.0
2020-01-03   2.0
2020-01-04   3.0
2020-01-05   7.0
2020-01-06  12.0
2020-01-07   6.0
2020-01-08   7.0
2020-01-09   8.0
2020-01-10   9.0

For some problems knowledge of the future is available for analysis. For example, this occurs when each data point is a full time series read from an experiment, and the task is to extract underlying conditions. In these cases it can be useful to perform forward-looking rolling window computations. FixedForwardWindowIndexer class is available for this purpose. This BaseIndexer subclass implements a closed fixed-width forward-looking rolling window, and we can use it as follows:

In [54]: from pandas.api.indexers import FixedForwardWindowIndexer

In [55]: indexer = FixedForwardWindowIndexer(window_size=2)

In [56]: df.rolling(indexer, min_periods=1).sum()
Out[56]:
               0
2020-01-01   1.0
2020-01-02   3.0
2020-01-03   5.0
2020-01-04   7.0
2020-01-05   9.0
2020-01-06  11.0
2020-01-07  13.0
2020-01-08  15.0
2020-01-09  17.0
2020-01-10   9.0

We can also achieve this by using slicing, applying rolling aggregation, and then flipping the result as shown in example below:

In [57]: df = pd.DataFrame(
   ....:     data=[
   ....:         [pd.Timestamp("2018-01-01 00:00:00"), 100],
   ....:         [pd.Timestamp("2018-01-01 00:00:01"), 101],
   ....:         [pd.Timestamp("2018-01-01 00:00:03"), 103],
   ....:         [pd.Timestamp("2018-01-01 00:00:04"), 111],
   ....:     ],
   ....:     columns=["time", "value"],
   ....: ).set_index("time")
   ....:

In [58]: df
Out[58]:
                     value
time
2018-01-01 00:00:00    100
2018-01-01 00:00:01    101
2018-01-01 00:00:03    103
2018-01-01 00:00:04    111

In [59]: reversed_df = df[::-1].rolling("2s").sum()[::-1]

In [60]: reversed_df
Out[60]:
                     value
time
2018-01-01 00:00:00  201.0
2018-01-01 00:00:01  101.0
2018-01-01 00:00:03  214.0
2018-01-01 00:00:04  111.0

### Rolling apply

The `apply()` function takes an extra `func` argument and performs generic rolling computations. The `func` argument should be a single function that produces a single value from an ndarray input. `raw` specifies whether the windows are cast as Series objects (`raw=False`) or ndarray objects (`raw=True`).

In [61]: def mad(x):
   ....:     return np.fabs(x - x.mean()).mean()
   ....:

In [62]: s = pd.Series(range(10))

In [63]: s.rolling(window=4).apply(mad, raw=True)
Out[63]:
0    NaN
1    NaN
2    NaN
3    1.0
4    1.0
5    1.0
6    1.0
7    1.0
8    1.0
9    1.0
dtype: float64

### Numba engine

Additionally, `apply()` can leverage Numbaif installed as an optional dependency. The apply aggregation can be executed using Numba by specifying `engine='numba'` and `engine_kwargs` arguments (`raw` must also be set to `True`). See enhancing performance with Numba for general usage of the arguments and performance considerations.

Numba will be applied in potentially two routines:

1. If `func` is a standard Python function, the engine will JIT the passed function. `func` can also be a JITed function in which case the engine will not JIT the function again.
2. The engine will JIT the for loop where the apply function is applied to each window.

The `engine_kwargs` argument is a dictionary of keyword arguments that will be passed into the numba.jit decorator. These keyword arguments will be applied to _both_ the passed function (if a standard Python function) and the apply for loop over each window.

`mean`, `median`, `max`, `min`, and `sum` also support the `engine` and `engine_kwargs` arguments.

### Binary window functions

`cov()` and `corr()` can compute moving window statistics about two Series or any combination of DataFrame/Series or DataFrame/DataFrame. Here is the behavior in each case:

* two Series: compute the statistic for the pairing.
* DataFrame/Series: compute the statistics for each column of the DataFrame with the passed Series, thus returning a DataFrame.
* DataFrame/DataFrame: by default compute the statistic for matching column names, returning a DataFrame. If the keyword argument `pairwise=True` is passed then computes the statistic for each pair of columns, returning a DataFrame with a MultiIndex whose values are the dates in question (see the next section).

For example:

In [64]: df = pd.DataFrame(
   ....:     np.random.randn(10, 4),
   ....:     index=pd.date_range("2020-01-01", periods=10),
   ....:     columns=["A", "B", "C", "D"],
   ....: )
   ....:

In [65]: df = df.cumsum()

In [66]: df2 = df[:4]

In [67]: df2.rolling(window=2).corr(df2["B"])
Out[67]:
              A    B    C    D
2020-01-01  NaN  NaN  NaN  NaN
2020-01-02 -1.0  1.0 -1.0  1.0
2020-01-03  1.0  1.0  1.0 -1.0
2020-01-04 -1.0  1.0  1.0 -1.0

### Computing rolling pairwise covariances and correlations

In financial data analysis and other fields it’s common to compute covariance and correlation matrices for a collection of time series. Often one is also interested in moving-window covariance and correlation matrices. This can be done by passing the `pairwise` keyword argument, which in the case of DataFrame inputs will yield a MultiIndexed DataFrame whose `index` are the dates in question. In the case of a single DataFrame argument the `pairwise` argument can even be omitted:

Note

Missing values are ignored and each entry is computed using the pairwise complete observations.

Assuming the missing data are missing at random this results in an estimate for the covariance matrix which is unbiased. However, for many applications this estimate may not be acceptable because the estimated covariance matrix is not guaranteed to be positive semi-definite. This could lead to estimated correlations having absolute values which are greater than one, and/or a non-invertible covariance matrix. See Estimation of covariance matricesfor more details.

In [68]: covs = (
   ....:     df[["B", "C", "D"]]
   ....:     .rolling(window=4)
   ....:     .cov(df[["A", "B", "C"]], pairwise=True)
   ....: )
   ....:

In [69]: covs
Out[69]:
                     B         C         D
2020-01-01 A       NaN       NaN       NaN
           B       NaN       NaN       NaN
           C       NaN       NaN       NaN
2020-01-02 A       NaN       NaN       NaN
           B       NaN       NaN       NaN
...                ...       ...       ...
2020-01-09 B  0.342006  0.230190  0.052849
           C  0.230190  1.575251  0.082901
2020-01-10 A -0.333945  0.006871 -0.655514
           B  0.649711  0.430860  0.469271
           C  0.430860  0.829721  0.055300

[30 rows x 3 columns]

## Weighted window

The `win_type` argument in `.rolling` generates a weighted windows that are commonly used in filtering and spectral estimation. `win_type` must be string that corresponds to a scipy.signal window function. Scipy must be installed in order to use these windows, and supplementary arguments that the Scipy window methods take must be specified in the aggregation function.

In [70]: s = pd.Series(range(10))

In [71]: s.rolling(window=5).mean()
Out[71]:
0    NaN
1    NaN
2    NaN
3    NaN
4    2.0
5    3.0
6    4.0
7    5.0
8    6.0
9    7.0
dtype: float64

In [72]: s.rolling(window=5, win_type="triang").mean()
Out[72]:
0    NaN
1    NaN
2    NaN
3    NaN
4    2.0
5    3.0
6    4.0
7    5.0
8    6.0
9    7.0
dtype: float64

# Supplementary Scipy arguments passed in the aggregation function
In [73]: s.rolling(window=5, win_type="gaussian").mean(std=0.1)
Out[73]:
0    NaN
1    NaN
2    NaN
3    NaN
4    2.0
5    3.0
6    4.0
7    5.0
8    6.0
9    7.0
dtype: float64

For all supported aggregation functions, see Weighted window functions.

## Expanding window

An expanding window yields the value of an aggregation statistic with all the data available up to that point in time. Since these calculations are a special case of rolling statistics, they are implemented in pandas such that the following two calls are equivalent:

In [74]: df = pd.DataFrame(range(5))

In [75]: df.rolling(window=len(df), min_periods=1).mean()
Out[75]:
     0
0  0.0
1  0.5
2  1.0
3  1.5
4  2.0

In [76]: df.expanding(min_periods=1).mean()
Out[76]:
     0
0  0.0
1  0.5
2  1.0
3  1.5
4  2.0

For all supported aggregation functions, see Expanding window functions.

## Exponentially weighted window

An exponentially weighted window is similar to an expanding window but with each prior point being exponentially weighted down relative to the current point.

In general, a weighted moving average is calculated as

\\\[y\_t = \\frac{\\sum\_{i=0}^t w\_i x\_{t-i}}{\\sum\_{i=0}^t w\_i},\\\]

where \\(x\_t\\) is the input, \\(y\_t\\) is the result and the \\(w\_i\\)are the weights.

For all supported aggregation functions, see Exponentially-weighted window functions.

The EW functions support two variants of exponential weights. The default, `adjust=True`, uses the weights \\(w\_i = (1 - \\alpha)^i\\)which gives

\\\[y\_t = \\frac{x\_t + (1 - \\alpha)x\_{t-1} + (1 - \\alpha)^2 x\_{t-2} + ... + (1 - \\alpha)^t x\_{0}}{1 + (1 - \\alpha) + (1 - \\alpha)^2 + ... + (1 - \\alpha)^t}\\\]

When `adjust=False` is specified, moving averages are calculated as

\\\[\\begin{split}y\_0 &= x\_0 \\\\ y\_t &= (1 - \\alpha) y\_{t-1} + \\alpha x\_t,\\end{split}\\\]

which is equivalent to using weights

\\\[\\begin{split}w\_i = \\begin{cases} \\alpha (1 - \\alpha)^i & \\text{if } i < t \\\\ (1 - \\alpha)^i & \\text{if } i = t. \\end{cases}\\end{split}\\\]

Note

These equations are sometimes written in terms of \\(\\alpha' = 1 - \\alpha\\), e.g.

\\\[y\_t = \\alpha' y\_{t-1} + (1 - \\alpha') x\_t.\\\]

The difference between the above two variants arises because we are dealing with series which have finite history. Consider a series of infinite history, with `adjust=True`:

\\\[y\_t = \\frac{x\_t + (1 - \\alpha)x\_{t-1} + (1 - \\alpha)^2 x\_{t-2} + ...} {1 + (1 - \\alpha) + (1 - \\alpha)^2 + ...}\\\]

Noting that the denominator is a geometric series with initial term equal to 1 and a ratio of \\(1 - \\alpha\\) we have

\\\[\\begin{split}y\_t &= \\frac{x\_t + (1 - \\alpha)x\_{t-1} + (1 - \\alpha)^2 x\_{t-2} + ...} {\\frac{1}{1 - (1 - \\alpha)}}\\\\ &= \[x\_t + (1 - \\alpha)x\_{t-1} + (1 - \\alpha)^2 x\_{t-2} + ...\] \\alpha \\\\ &= \\alpha x\_t + \[(1-\\alpha)x\_{t-1} + (1 - \\alpha)^2 x\_{t-2} + ...\]\\alpha \\\\ &= \\alpha x\_t + (1 - \\alpha)\[x\_{t-1} + (1 - \\alpha) x\_{t-2} + ...\]\\alpha\\\\ &= \\alpha x\_t + (1 - \\alpha) y\_{t-1}\\end{split}\\\]

which is the same expression as `adjust=False` above and therefore shows the equivalence of the two variants for infinite series. When `adjust=False`, we have \\(y\_0 = x\_0\\) and \\(y\_t = \\alpha x\_t + (1 - \\alpha) y\_{t-1}\\). Therefore, there is an assumption that \\(x\_0\\) is not an ordinary value but rather an exponentially weighted moment of the infinite series up to that point.

One must have \\(0 < \\alpha \\leq 1\\), and while it is possible to pass \\(\\alpha\\) directly, it’s often easier to think about either the **span**, **center of mass (com)** or **half-life** of an EW moment:

\\\[\\begin{split}\\alpha = \\begin{cases} \\frac{2}{s + 1}, & \\text{for span}\\ s \\geq 1\\\\ \\frac{1}{1 + c}, & \\text{for center of mass}\\ c \\geq 0\\\\ 1 - e^{\\frac{\\log 0.5}{h}}, & \\text{for half-life}\\ h > 0 \\end{cases}\\end{split}\\\]

One must specify precisely one of **span**, **center of mass**, **half-life**and **alpha** to the EW functions:

* **Span** corresponds to what is commonly called an “N-day EW moving average”.
* **Center of mass** has a more physical interpretation and can be thought of in terms of span: \\(c = (s - 1) / 2\\).
* **Half-life** is the period of time for the exponential weight to reduce to one half.
* **Alpha** specifies the smoothing factor directly.

You can also specify `halflife` in terms of a timedelta convertible unit to specify the amount of time it takes for an observation to decay to half its value when also specifying a sequence of `times`.

In [77]: df = pd.DataFrame({"B": [0, 1, 2, np.nan, 4]})

In [78]: df
Out[78]:
     B
0  0.0
1  1.0
2  2.0
3  NaN
4  4.0

In [79]: times = ["2020-01-01", "2020-01-03", "2020-01-10", "2020-01-15", "2020-01-17"]

In [80]: df.ewm(halflife="4 days", times=pd.DatetimeIndex(times)).mean()
Out[80]:
          B
0  0.000000
1  0.585786
2  1.523889
3  1.523889
4  3.233686

The following formula is used to compute exponentially weighted mean with an input vector of times:

\\\[y\_t = \\frac{\\sum\_{i=0}^t 0.5^\\frac{t\_{t} - t\_{i}}{\\lambda} x\_{t-i}}{\\sum\_{i=0}^t 0.5^\\frac{t\_{t} - t\_{i}}{\\lambda}},\\\]

ExponentialMovingWindow also has an `ignore_na` argument, which determines how intermediate null values affect the calculation of the weights. When `ignore_na=False` (the default), weights are calculated based on absolute positions, so that intermediate null values affect the result. When `ignore_na=True`, weights are calculated by ignoring intermediate null values. For example, assuming `adjust=True`, if `ignore_na=False`, the weighted average of `3, NaN, 5` would be calculated as

\\\[\\frac{(1-\\alpha)^2 \\cdot 3 + 1 \\cdot 5}{(1-\\alpha)^2 + 1}.\\\]

Whereas if `ignore_na=True`, the weighted average would be calculated as

\\\[\\frac{(1-\\alpha) \\cdot 3 + 1 \\cdot 5}{(1-\\alpha) + 1}.\\\]

The `var()`, `std()`, and `cov()` functions have a `bias` argument, specifying whether the result should contain biased or unbiased statistics. For example, if `bias=True`, `ewmvar(x)` is calculated as `ewmvar(x) = ewma(x**2) - ewma(x)**2`; whereas if `bias=False` (the default), the biased variance statistics are scaled by debiasing factors

\\\[\\frac{\\left(\\sum\_{i=0}^t w\_i\\right)^2}{\\left(\\sum\_{i=0}^t w\_i\\right)^2 - \\sum\_{i=0}^t w\_i^2}.\\\]

(For \\(w\_i = 1\\), this reduces to the usual \\(N / (N - 1)\\) factor, with \\(N = t + 1\\).) See Weighted Sample Varianceon Wikipedia for further details.

 previous Group by: split-apply-combine   next Time series / date functionality

 On this page

* Overview
* Rolling window
  * Centering windows
  * Rolling window endpoints
  * Custom window rolling
  * Rolling apply
  * Numba engine
  * Binary window functions
  * Computing rolling pairwise covariances and correlations
* Weighted window
* Expanding window
* Exponentially weighted window
