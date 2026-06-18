# lishu(理书)· ROADMAP

## v1(当前 · 本地优先)

目标:**能本地跑通、整理自己的书签**。

- [x] 脚手架:TS + Vite + @crxjs + pnpm,`pnpm build` 出 `dist/`
- [x] 读全部书签 + 扁平化
- [x] LLM provider(OpenAI 兼容 + Anthropic Messages API)+ 配置存 storage.local
- [x] enrich provider:world-knowledge(默认)+ meta-scrape(可选)
- [x] 两段式分类(Pass A 定类目 / Pass B 归类)
- [x] 批处理 + 进度持久化(MV3 service worker 续跑兜底)
- [x] 非破坏式建夹 + 写副本
- [x] 分类预览 → 用户确认后再写入
- [x] 本地重复书签报告(只读,不自动删除)
- [x] opt-in 失效链接检测(只读,联网前申请权限,不自动删除)
- [x] popup:配置 / 触发 / 进度 / 摘要 / 清进度 / 删除上次结果
- [x] 交付产物:`dist/` 可用于 Chrome load unpacked
- [x] 真实本机验收:加载扩展 + 填 DeepSeek 配置 + 整理 738 个书签
- [x] 开源前信任底座:MIT license / CI / optional host permissions / SECURITY / CONTRIBUTING

## v2+(有需要再做)

- 接 search-api provider(Bing API / 带 web search 的模型)
- 增量整理(只处理新增书签)、可选去重工作流
- 上架 Chrome Web Store(unlisted/private)+ CI 自动构建
- 多语言 / 自定义类目模板

## 非目标(长期不做)

- 不做云端后端 / SaaS(纯本地扩展)
- 不内置固定 LLM(永远用户自配,避免替用户的 token 买单 + 隐私)
