# Hot Monitoring

热点监控工具 MVP，包含：

- `web/`: Vue 3 + Vite + TailwindCSS 前端
- `server/`: Node.js + Express + Prisma + SQLite 后端

## 快速开始

1. 复制环境变量模板
2. 安装依赖
3. 初始化数据库
4. 启动前后端

```bash
cp .env.example .env
npm install
npm --prefix server install
npm --prefix web install
npm run db:generate
npm run db:init
npm run dev
```

前端默认运行在 `5173`，后端默认运行在 `3000`。

`npm run db:init` 现在会通过 Prisma migration 初始化数据库；`server/prisma/init.sql` 仅保留为排障时的后备脚本。

如果想临时停用 Twitter 采集以避免额度消耗，可以在 [`.env`](/Users/hon/Desktop/custom/hot-monitoring/.env) 中设置：

```env
TWITTER_SOURCE_ENABLED="false"
```

AI 提供方仅保留 `腾讯 TokenHub` 与 `OpenRouter`。可以在系统设置页手动切换当前 provider。

如果你要启用腾讯 TokenHub，请在 [`.env`](/Users/hon/Desktop/custom/hot-monitoring/.env) 中补齐：

```env
TENCENT_TOKENHUB_API_KEY="your-tokenhub-key"
TENCENT_TOKENHUB_BASE_URL="https://tokenhub.tencentmaas.com/v1"
TENCENT_TOKENHUB_MODEL="deepseek-v4-flash"
```

如果要启用更完整的微博实时搜索结果抓取，可以额外在 [`.env`](/Users/hon/Desktop/custom/hot-monitoring/.env) 中提供微博 Cookie：

```env
WEIBO_COOKIE="SUB=...; SUBP=...; WBPSESS=...; XSRF-TOKEN=..."
```

未提供 `WEIBO_COOKIE` 时，微博搜索结果可能更少或直接抓取失败；如果你依赖微博来源，建议补齐该 Cookie。
