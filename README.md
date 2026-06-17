# lishu(理书)

> 用大模型自动整理乱糟糟的 Chrome 书签栏 —— 扫描全部书签,判断每个网站是做什么的,分类后**非破坏式**放进一个新文件夹(原书签一根毫毛不动)。

## 技术栈

TypeScript + Vite + [@crxjs/vite-plugin](https://crxjs.dev/) + pnpm · Chrome Manifest V3

## 快速开始

```bash
pnpm install
pnpm build      # 产物在 dist/
```

然后在 Chrome 里加载:

1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」→ 选 `dist/` 文件夹
4. 点扩展图标 → 在 popup 里选择协议并填写大模型(endpoint + key + model)→ 「开始整理」

开发模式(改代码自动重载):

```bash
pnpm dev
```

## 它怎么工作

1. 读取你全部书签
2. 先让大模型定一组稳定类目(8~15 个),再分批把书签归类
3. 判断网站用途默认用模型自身知识(不访问网站);可选开启抓网站首页 meta 增强
4. 新建「📚 理书整理 日期」文件夹,把分类好的书签副本放进去 —— **原书签栏完全不动**

## 隐私

- 支持 OpenAI 兼容 Chat Completions 与 Anthropic Messages API
- 默认只把「网址 + 书签标题」发给**你自己配置的**大模型
- API key 只存在本地浏览器(`chrome.storage.local`),不上云、不同步
- 详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [docs/PRD.md](docs/PRD.md)

## 文档

- [docs/PRD.md](docs/PRD.md) —— 产品需求与边界
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 架构与数据流
- [docs/ROADMAP.md](docs/ROADMAP.md) —— 路线图
