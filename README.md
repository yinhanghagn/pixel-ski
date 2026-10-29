# 像素雪票本

奥地利雪场每日雪票价格，加上「我的雪季」记录。这是一个 PWA：用手机浏览器打开后可以添加到桌面，没网也能用。

- **雪票价格**：选一天，看各雪场当天的成人一日票门市价，以及每个雪场整个雪季的价格日历。
- **我的雪季**，二选一，随时可以切换：
  - **我买了季票**：每滑一天按当天票价抵扣，小企鹅爬山显示回本进度。
  - **没季票，只想记录**：滑雪集章卡和徽章，统计花费、最常去的雪场。可以填一个季票价格，算算买季票划不划算。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` / `style.css` / `app.js` | App 本体 |
| `prices.json` | **雪票价格数据，每个雪季改这个文件就行** |
| `manifest.webmanifest` | App 名称、图标、颜色（安装到桌面时用） |
| `sw.js` | 离线缓存 |
| `icons/` | 图标，由 `tools/make_icons.py` 生成 |

## 本地预览

```bash
cd pixel-ski
python3 -m http.server 8000
```

在电脑上打开 http://localhost:8000 。注意：直接双击打开 `index.html` 不行，浏览器不允许那样读取 `prices.json`。

## 发布到 GitHub Pages（免费）

1. 在 GitHub 新建一个仓库，比如 `pixel-ski`。
2. 把这个文件夹里的所有文件推上去：
   ```bash
   cd pixel-ski
   git init && git add . && git commit -m "像素雪票本"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/pixel-ski.git
   git push -u origin main
   ```
3. 在仓库的 Settings → Pages 里，Source 选 `Deploy from a branch`，Branch 选 `main`，目录选 `/ (root)`，然后保存。
4. 一两分钟后就能通过 `https://<你的用户名>.github.io/pixel-ski/` 访问。

## 装到手机

- **iPhone**：用 Safari 打开网址 → 点底部的「分享」→「添加到主屏幕」。
- **Android**：用 Chrome 打开，页面顶部会出现「安装」按钮，或者在菜单里选「安装应用」。

## 更新雪票价格（不用改代码）

直接编辑 `prices.json`，然后推到 GitHub 就行：

```bash
git add prices.json && git commit -m "更新价格" && git push
```

App 每次联网打开时都会先拉取最新的 `prices.json`，所以手机上不用重新安装，**下次打开就是新价格**。没网的时候，会用上次存下的价格。

### prices.json 字段说明

文件开头是整体信息：

| 字段 | 说明 |
|---|---|
| `season` | 雪季名称，比如 `"2027/28"` |
| `updated` | 价格更新日期，显示在页面底部 |
| `range.from` / `range.to` | 日期选择器能选的范围 |
| `tiers.cheap` / `tiers.pricey` | 颜色分档：低于等于 cheap 是绿色，高于等于 pricey 是粉色 |
| `notice` | 页面底部的说明文字 |
| `sources` | 价格来源链接列表 |

`resorts` 里每个雪场：

```json
{
  "id": "skiwelt",                       // 唯一编号，不要改（滑雪记录靠它对应雪场）
  "name": "SkiWelt Wilder Kaiser-Brixental",
  "sub": "副标题，可省略",
  "state": "Tirol",                      // 州，用来做筛选
  "price": 79.5,                         // 默认一日票价；还没公布就写 null
  "open": "2026-12-05",                  // 开季日，可省略
  "close": "2027-04-04",                 // 闭季日，可省略
  "periods": [                           // 按日期分不同价格，可省略
    { "from": "2026-12-05", "to": "2026-12-18", "price": 71.5, "label": "Nebensaison" }
  ],
  "dynamic": true,                       // 动态定价的雪场写这个，并且不写 price
  "estimated": true,                     // 时段日期是推算的，页面上会标“推算”
  "note": "备注，显示在雪场详情里"
}
```

注意：

- 上面的 `//` 只是说明用的，真正的 JSON 文件**不能写注释**。
- 日期必须是 `YYYY-MM-DD` 格式，价格是数字，不要加引号或 €。
- 某一天如果不在任何一个 `periods` 时段里，就用 `price` 的价格。
- 某一条格式写错了，App 会跳过那一条，并在页面底部提示“有 N 条格式不对”，不会整个崩掉。可以先用 `python3 -m json.tool prices.json` 检查一下格式。
- 新雪季想清空旧价格，把 `season`、`updated`、`range` 和各雪场的价格、日期改掉就行。**`id` 不要改**。

## 改了 App 代码之后

改了 `app.js`、`style.css` 或 `index.html` 并推送以后，手机上打开一次会在后台下载新版本，**再打开一次**才会显示出来。如果想让所有人立刻丢掉旧缓存，就把 `sw.js` 第一行的 `VERSION` 改一下，比如 `'v1'` 改成 `'v2'`。

## 数据和备份

滑雪记录只存在手机这个浏览器里，不会上传到任何地方。换手机或清理浏览器数据之前，到「我的雪季 → 备份与恢复」里点「导出备份」，把文件存到「文件」App 或网盘；到新手机上再点「从备份恢复」。

## 改图标

编辑 `tools/make_icons.py` 里的像素图，然后运行（需要 Pillow）：

```bash
python3 tools/make_icons.py
```
