# lishu(理书)· PRD

## 定位

个人书签智能整理 Chrome 扩展(MV3)。扫描全部书签,用**可配置的大模型**判断每个网站是做什么的,自动分类,把整理结果**非破坏式**放进一个新建文件夹。

## 目标用户

书签栏积累多年、杂乱无章、想一键自动分类的浏览器用户。v1 服务维护者本人(管理自己的书签),本地 load unpacked 使用。

## 核心功能(v1)

1. **扫描全部书签** —— `chrome.bookmarks.getTree` 扁平化为 `{id,title,url}[]`
2. **用户配置 LLM** —— 自选协议,自填 endpoint + key + model;支持 OpenAI 兼容 Chat Completions 与 Anthropic Messages API
3. **两段式分类** —— Pass A 让 LLM 定 8~15 个稳定类目 → Pass B 分批把书签归入类目
4. **探查网站用途**(三档 provider):
   - world-knowledge(默认 · 零网络):URL+标题交 LLM 用自身知识判断
   - meta-scrape(可选):抓网站**首页** meta 增强,不进具体深层页面
   - search-api:留接口,v1 不实现
5. **非破坏式写入** —— 新建「📚 理书整理 YYYY-MM-DD」顶层文件夹,放分类副本,**原书签栏不动**
6. **写入前预览** —— 分类完成后先显示分类数量、质量分、低置信度/可疑分类提示,允许用户调整分类名,确认后才创建整理副本
7. **示例预览** —— 用户不填 API key、不读真实书签时也能打开 synthetic preview 体验质量分和分类预览;示例不允许写入
8. **书签体检** —— 本地只读重复 URL 报告;用户显式触发并授权后做失效链接检测,只出报告
9. **popup** —— 配置 LLM、选探查档位、触发、显示进度、预览、示例预览、完成摘要、清除进度、删除上次整理结果

## 不做什么(v1 边界)

- 不动原书签(不删、不改、不移动)—— 铁律
- 不抓书签的**深层页面**内容(只抓首页 meta,且默认关)
- 不接搜索引擎 API(留 provider 接口,v2+)
- 不自动删除、移动或合并重复书签 / 失效书签;体检能力只提供只读报告
- 不做定时增量整理
- 不上架 Chrome Web Store(v1 本地 load unpacked;有需要再上架)
- popup 不上 React / 重 UI 框架

## 隐私

- 默认 world-knowledge:只把 `URL+标题` 发给用户自己配的 LLM
- meta-scrape 默认关,用户开启才抓首页 meta
- API key 存 `chrome.storage.local`(本地、不云同步)
- 默认只申请用户配置的大模型 endpoint 访问权限;只有开启 meta-scrape 或失效链接检测时才申请网页访问权限
