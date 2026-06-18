# lishu(理书)· 架构

## 数据流

```
用户在 popup 点「开始整理」
        │  chrome.runtime.sendMessage({type:'START'})
        ▼
[background service worker · 编排]
   1. core/bookmarks.ts   getTree → 扁平化 {id,title,url}[]
        │
   2. core/classify.ts(Pass A · 定类目)
        采样书签 title+url → LLM → 8~15 个稳定类目
        │
   3. core/pipeline.ts    分批(30~50/批),逐批:
        ├─ providers/enrich.ts   低置信书签 → 探查(world-knowledge / meta-scrape)
        └─ core/classify.ts(Pass B)→ LLM 把书签归入已定类目 → {url,category,confidence}
        │  每批后 core/storage.ts 写进度(service worker 被杀可续跑)
        │  chrome.runtime.sendMessage 把进度推回 popup
        ▼
   popup 显示分类预览(每个分类的书签数量)
        │  用户确认后 chrome.runtime.sendMessage({type:'CONFIRM_WRITE'})
        ▼
   4. core/bookmarks.ts(非破坏写入)
        create「📚 理书整理 YYYY-MM-DD」顶层文件夹 → 按类建子夹 → create 书签副本
        (只 create,绝不 remove/update 原书签)
        ▼
   popup 显示完成摘要(N 个书签 / M 个分类)
```

## 模块职责

| 模块 | 职责 |
|---|---|
| `background.ts` | service worker 入口;接 popup 消息;编排预览与确认写入;管进度/生命周期 |
| `popup/popup.ts` | UI:配置 LLM、选探查档位、触发、显示预览/进度/摘要(vanilla TS) |
| `core/bookmarks.ts` | 读 getTree + 扁平化;非破坏式 create 文件夹与副本 |
| `core/classify.ts` | Pass A 定类目 / Pass B 归类;组装 prompt + 解析 JSON |
| `core/health.ts` | 本地书签体检;归一化 URL 并生成重复书签报告 |
| `core/pipeline.ts` | 批处理(30~50/批)+ 进度持久化 + 分类预览停点 + 可中断续跑 |
| `core/storage.ts` | chrome.storage.local 读写配置与进度 |
| `providers/types.ts` | `LlmProvider` / `EnrichProvider` 接口 |
| `providers/llm.ts` | OpenAI 兼容 `/v1/chat/completions` 调用 |
| `providers/enrich.ts` | 域名探查:world-knowledge(默认)/ meta-scrape(抓首页 meta);search-api 留 TODO |
| `types.ts` | 共享类型 Bookmark / Category / Config / Progress |

## 关键设计

**两段式分类(防类目发散)**:让 LLM 自由分类会发散出"前端开发/Web开发/JavaScript"这种重叠碎夹。先定一组固定类目(Pass A),再把书签往里归(Pass B),类目稳定、结果可预测、第二遍可批量。

**provider 抽象(成本/隐私/准确率换档)**:`enrich.ts` 三档可插拔,默认只用 world-knowledge(零网络、零隐私暴露);需要时开 meta-scrape;未来加 search-api 不动分类管线。`llm.ts` 支持 OpenAI 兼容 Chat Completions 和 Anthropic Messages API。

**MV3 service worker 生命周期**:worker 空闲约 30s 被回收。对策:`pipeline.ts` 分批,每批后把"已完成 + 待办批次"写 storage.local;worker 重启从进度续跑。v1 用户触发后保持 popup 打开即可覆盖多数场景,续跑为健壮性兜底。

**非破坏式(铁律)**:整理流程只 `chrome.bookmarks.create`,绝不 `remove`/`update` 原书签。popup 的“删除上次结果”只允许删除标题前缀为「📚 理书整理」的生成文件夹,用于清理本工具创建的输出。

**写入前预览(信任闸门)**:分类完成后 progress 进入 `preview`,popup 只展示每个分类的数量,不创建任何书签。用户点“确认写入副本”后才进入 `writing` 并调用 `chrome.bookmarks.create`。这把高成本的 LLM 分类和高敏感的书签写入拆成两步,降低误操作风险。

**本地重复报告(只读体检)**:`core/health.ts` 只读取扁平化书签,按归一化 URL 聚合重复项,不发网络请求,也不删除 / 移动 / 更新任何书签。popup 只展示重复组摘要,清理动作由用户自行决定。

## 权限与隐私

- `permissions: ["bookmarks","storage"]`
- `optional_host_permissions: ["<all_urls>"]` —— 默认运行只动态申请用户配置的大模型 endpoint origin;用户选择 meta-scrape 时才申请更宽的网页访问权限。
- API key 存 `chrome.storage.local`(不用 `storage.sync`,避免 key 同步上云)。
- 默认 world-knowledge 只发 `URL+标题`;meta-scrape 默认关。

## 构建与加载

- `pnpm install` → `pnpm build` → `dist/`
- Chrome `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `dist/`
- 开发:`pnpm dev`(@crxjs HMR)
