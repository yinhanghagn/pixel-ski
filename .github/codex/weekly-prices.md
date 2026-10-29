# 任务：每周核对雪票价格，更新 prices.json

你在维护“像素雪票本”的价格数据 `prices.json`（奥地利 / 瑞士 / 法国雪场的成人门市价）。
用联网搜索核对最新价格，只修改 `prices.json`，不要改其它任何文件。
命令行没有网络，查资料只能用你的联网搜索。

## 要做的事

1. 运行 `date -u +%F` 得到今天的日期。
2. 按下面的优先级逐个核对雪场，时间不够就做到哪算哪（下周会接着查）：
   1. `price` 是 `null`、没有 `open` / `close`、或者 `"estimated": true` 的雪场；
   2. 有 `dynamic: true` 的雪场：更新 `fromPrice`（官网能买到的最低一日票价）；
   3. 其它雪场：核对一日票 `price`、多天票 `multi`、分时段 `periods`、开季 `open` / 闭季 `close`。
3. 来源优先级：雪场官网（`shop` 字段就是官网）> bergfex.at / schneehoehen.de / skiresort.info / alti-mag.com 等价格汇总站。
   查不到可靠来源就**不要改**，绝不猜价格。
4. 顺便确认 `shop` 还指向雪场官网（官网搬家了就换成新网址，必须是 `https://`）。
5. 用欧洲央行（ECB）最新参考汇率更新 `fx.CHF`（1 CHF = 多少欧元）和 `fx.date`。
6. 只要改了任何内容，就把顶层 `updated` 改成今天的日期；某个雪场的价格来源变了，就更新它的 `source`。
7. 运行 `python3 tools/validate_prices.py`，有错误（✗）必须修好。

## 数据规则

- `id` 永远不要改，也不要删雪场（用户的滑雪记录靠 id 关联）。
- 价格是**成人、在售票处买**的价格，单位是该雪场的 `currency`（瑞士是 CHF，其它 EUR）。
- `price`：主季一日票。未公布写 `null`。动态定价的雪场不写 `price`，只写 `dynamic: true` 和 `fromPrice`。
- `multi`：`{"天数": 整张票价格}`，只写查到的天数（2–21）。
- `periods`：不同日期段价格不同时用，`[{"from", "to", "price", "label", "multi"}]`，日期 `YYYY-MM-DD`，按开始日期取第一个匹配的段；不在任何段里的日期用 `price` / `multi`。
- `open` / `close`：本雪季开季和闭季日期，`YYYY-MM-DD`。
- `note` 用中文写，简短说明特殊情况（比如“6 天票送 1 天”）。
- **保持文件原来的排版**：在原处修改数值，不要重新格式化整个文件（`multi`、`aliases` 这类对象/数组保持一行）。

## 最后的回复

用中文 Markdown 写一份改动清单，会原样放进 Pull Request 描述里：

- 每处改动一行：`雪场名（id）：字段 旧值 → 新值 · [来源](网址)`
- 单独列出：变化超过 15% 的价格、你拿不准的地方、这次没来得及查的雪场数量。
- 什么都没改就只回复“本周没有发现价格变化”。
