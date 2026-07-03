# Hot Monitoring

热点监控工具，用于按关键词自动采集、校验和通知热点事件。项目由 Vue 前端和 Node.js 后端组成，支持多来源搜索、AI 可信度分析、深度证据校验、实时通知和邮件提醒。

## 功能概览

- 关键词管理：添加、启用、停用和删除监控关键词。
- 热点流：聚合 Bing、Google News、Hacker News、Twitter/X、B 站、微博、搜狗等来源。
- 深度校验：对候选内容做相关性、证据、可信度、来源质量和热度评分。
- 实时搜索：手动触发采集，查看最新扫描 inbox 和来源健康状态。
- 通知能力：WebSocket 实时推送，可选 SMTP 邮件通知。
- AI Provider：支持腾讯 TokenHub 和 OpenRouter，可在系统设置页切换。

## 技术栈

- `web/`：Vue 3、Vite、Pinia、Vue Router、Element Plus、Tailwind CSS
- `server/`：Node.js、Express、Prisma、SQLite、WebSocket、Vitest
- `server/prisma/`：数据库 schema 与 migration

## 快速开始

建议使用 Node.js 20。

```bash
cp .env.example .env
npm install
npm --prefix server install
npm --prefix web install
npm run db:generate
npm run db:init
npm run dev
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`
- 健康检查：`http://localhost:3000/api/health`

`npm run db:init` 会通过 Prisma migration 初始化数据库；`server/prisma/init.sql` 仅保留为排障时的后备脚本。

## 环境变量

复制 `.env.example` 后，按需补齐 `.env`。本地开发至少保留：

```env
PORT=3000
DATABASE_URL="file:./dev.db"
VITE_API_BASE="http://localhost:3000"
```

AI 分析至少配置一个 provider：

```env
TENCENT_TOKENHUB_API_KEY="your-tokenhub-key"
TENCENT_TOKENHUB_BASE_URL="https://tokenhub.tencentmaas.com/v1"
TENCENT_TOKENHUB_MODEL="deepseek-v4-pro-202606"

OPENROUTER_API_KEY="your-openrouter-key"
OPENROUTER_MODEL="openai/gpt-4o-mini"
```

常用采集配置：

```env
TWITTERAPI_IO_KEY=""
TWITTER_SOURCE_ENABLED="true"
BILIBILI_COOKIE=""
WEIBO_COOKIE=""
```

如果想临时停用 Twitter 采集以避免额度消耗：

```env
TWITTER_SOURCE_ENABLED="false"
```

未提供 `WEIBO_COOKIE` 时，微博搜索结果可能更少或直接抓取失败；如果依赖微博来源，建议补齐 `SUB`、`SUBP`、`WBPSESS`、`XSRF-TOKEN` 等 Cookie。

如果服务器无法直接访问 Google News RSS，可为后端出站请求配置代理：

```env
OUTBOUND_PROXY_URL="http://127.0.0.1:7890"
# 或分别配置：
OUTBOUND_HTTPS_PROXY="http://127.0.0.1:7890"
OUTBOUND_HTTP_PROXY="http://127.0.0.1:7890"
OUTBOUND_NO_PROXY="localhost,127.0.0.1,::1"
```

这类代理影响的是后端 Node.js 主动访问外部来源，和 Nginx 把浏览器请求转发到后端的反向代理不是一回事。

邮件通知需要配置 SMTP：

```env
SMTP_HOST=""
SMTP_PORT=587
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
```

embedding 是可选增强，用于事件相似度和聚类辅助。默认关闭，避免服务器部署时因 `onnxruntime-node` 二进制包下载失败而中断安装；需要启用时先在服务器确认 `npm --prefix server install @huggingface/transformers` 可以成功，再设置：

```env
EMBEDDING_ENABLED="false"
EMBEDDING_MODEL="Xenova/multilingual-e5-small"
EMBEDDING_DTYPE="q8"
EMBEDDING_OFFLINE="false"
EMBEDDING_SIMILARITY_FLOOR="0.78"
EMBEDDING_SIMILARITY_CEIL="0.9"
```

更多 AI 扫描、证据抓取和时间窗口参数见 `.env.example`。

## 常用命令

```bash
npm run dev          # 同时启动 server 和 web
npm run dev:server   # 只启动后端
npm run dev:web      # 只启动前端
npm run build        # 检查后端并构建前端
npm run db:generate  # 生成 Prisma Client
npm run db:init      # 执行 Prisma migration
npm run db:push      # 开发期同步 Prisma schema
npm --prefix server test
npm --prefix server run eval:golden
```

## 页面入口

- `/hotspots`：热点流、深度校验结果、证据详情和反馈。
- `/keywords`：关键词管理。
- `/search`：手动搜索与跨来源探索。
- `/settings`：监控范围、扫描间隔、AI provider、来源和通知设置。

## API 入口

- `GET /api/health`：服务健康和关键配置状态。
- `GET /api/hotspots`：热点事件列表。
- `POST /api/hotspots/search`：手动触发采集。
- `GET /api/hotspots/search/status`：采集状态。
- `POST /api/hotspots/explore`：跨来源搜索。
- `GET /api/sources/health`：来源健康状态。
- `GET /api/notifications/latest-scan`：最新扫描 inbox。
- `GET /api/settings` / `PUT /api/settings`：系统设置。

## 部署

Netlify 前端构建配置见 `netlify.toml`。服务器部署和更新流程见 `DEPLOY_UPDATE_GUIDE.md`。
