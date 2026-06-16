# Hot Monitoring 部署更新指南

这份文档用于后续更新服务器上的 `hot-monitoring` 项目。

适用场景：

- 本机已经改好了代码
- 需要重新打包并上传到阿里云服务器
- 服务器已经安装过 `nodejs`、`nginx`、`pm2`

服务器信息：

- 项目目录：`/home/admin/hot-monitoring`
- 前端静态目录：`/usr/share/nginx/html/hot-monitoring`
- 上传包目录：`/home/admin`
- 服务名：`hot-monitoring-api`
- 访问地址：`http://your-server-host`

## 1. 本机重新打干净包

进入本机项目目录：

```bash
cd /Users/hon/Desktop/custom/hot-monitoring
```

打包时必须关闭 macOS 资源分叉文件，否则服务器解压后会出现 `_.env.example`、`_.server` 这类脏文件。

```bash
COPYFILE_DISABLE=1 tar \
  --exclude='node_modules' \
  --exclude='server/node_modules' \
  --exclude='web/node_modules' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='__MACOSX' \
  -czf /private/tmp/hot-monitoring-deploy-clean.tgz .
```

确认包生成成功：

```bash
ls -lh /private/tmp/hot-monitoring-deploy-clean.tgz
```

## 2. 上传到服务器

把本机生成的包上传到服务器：

- 本机文件：`/private/tmp/hot-monitoring-deploy-clean.tgz`
- 服务器目标：`/home/admin/hot-monitoring-deploy-clean.tgz`

如果你用阿里云 Workbench 文件管理器上传，直接传到 `/home/admin/` 即可。

## 3. 服务器清理旧目录

登录服务器后执行：

```bash
rm -rf /home/admin/hot-monitoring
mkdir -p /home/admin/hot-monitoring
```

## 4. 解压新包

```bash
tar -xzf /home/admin/hot-monitoring-deploy-clean.tgz -C /home/admin/hot-monitoring
```

检查目录是否干净：

```bash
ls -lah /home/admin/hot-monitoring
```

正常应该看到这些内容：

- `package.json`
- `package-lock.json`
- `server/`
- `web/`
- `.env.example`
- `README.md`

如果看到了 `_.env.example`、`_.server`、`_.web` 这类文件，说明包还是脏的，需要回到本机重新打包。

## 5. 恢复 `.env`

注意：

- 打包时故意排除了 `.env`
- 所以每次删除项目目录后，都要重新放回 `/home/admin/hot-monitoring/.env`

如果你手头已经保存了旧 `.env`，直接放回项目根目录即可。

如果要手动创建：

```bash
cd /home/admin/hot-monitoring
vi .env
```

至少要保证这两行存在：

```env
PORT=3000
DATABASE_URL="file:./dev.db"
```

建议完整配置：

```env
PORT=3000
DATABASE_URL="file:./dev.db"
OPENROUTER_API_KEY=""
OPENROUTER_MODEL="openai/gpt-4o-mini"
TENCENT_TOKENHUB_API_KEY=""
TENCENT_TOKENHUB_BASE_URL="https://tokenhub.tencentmaas.com/v1"
TENCENT_TOKENHUB_MODEL="deepseek-v4-flash"
AI_ANALYSIS_TIMEOUT_MS=30000
AI_ANALYSIS_MAX_ITEMS_PER_RUN=40
TWITTERAPI_IO_KEY=""
TWITTER_SOURCE_ENABLED="true"
BILIBILI_COOKIE=""
SMTP_HOST=""
SMTP_PORT=465
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
VITE_API_BASE="http://your-server-host"
```

## 6. 安装依赖

进入项目目录：

```bash
cd /home/admin/hot-monitoring
```

安装依赖：

```bash
npm install
npm --prefix server install
npm --prefix web install
```

## 7. 重新构建项目

这一步非常关键。

前端线上实际发布的是 `web/dist` 里的静态文件；如果你只上传源码、安装依赖，但没有重新执行构建，那么后面复制到 nginx 目录的仍然可能是旧版本的 `dist`，页面刷新后看起来就像“没有更新成功”。

执行：

```bash
npm run build
```

如果你只想单独构建前端，也可以执行：

```bash
npm run build:web
```

建议构建后确认一下 `web/dist` 的更新时间已经变成刚刚：

```bash
ls -lah /home/admin/hot-monitoring/web/dist
```

## 8. 重新生成 Prisma 并初始化数据库

```bash
npm run db:generate
npm run db:init
```

如果这里报 `DATABASE_URL not found`，说明 `.env` 不在 `/home/admin/hot-monitoring/.env`。

## 9. 重启后端服务

如果服务已经存在：

```bash
pm2 restart hot-monitoring-api
```

如果重启有问题，直接删掉后重建：

```bash
pm2 delete hot-monitoring-api
pm2 start "npm --prefix /home/admin/hot-monitoring/server run start" --name hot-monitoring-api
```

保存 pm2 配置：

```bash
pm2 save
```

## 10. 检查后端是否正常

```bash
curl http://127.0.0.1:3000/api/health
```

如果返回 `ok: true` 之类的 JSON，说明后端已启动成功。

如果返回 `Connection refused`，继续看日志：

```bash
pm2 status
pm2 logs hot-monitoring-api --lines 50
```

## 11. 同步前端静态文件到 nginx 目录

`nginx` 不直接读取 `/home/admin/hot-monitoring/web/dist`，因为那里容易遇到权限问题。

正确做法是把前端构建产物复制到：

`/usr/share/nginx/html/hot-monitoring`

执行：

```bash
sudo mkdir -p /usr/share/nginx/html/hot-monitoring
sudo rm -rf /usr/share/nginx/html/hot-monitoring/*
sudo cp -R /home/admin/hot-monitoring/web/dist/* /usr/share/nginx/html/hot-monitoring/
```

## 12. 检查 nginx 配置

配置文件建议是：

`/etc/nginx/conf.d/hot-monitoring.conf`

内容如下：

```nginx
server {
    listen 80;
    server_name your-server-host;

    root /usr/share/nginx/html/hot-monitoring;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

检查并重启 nginx：

```bash
sudo nginx -t
sudo systemctl restart nginx
```

## 13. 验证线上访问

浏览器打开：

`http://your-server-host`

如果页面能打开但数据异常，优先排查后端日志：

```bash
pm2 logs hot-monitoring-api --lines 50
```

## 14. 常见问题

### 1. 页面显示 `500 Internal Server Error`

通常是 nginx 无法读取前端目录。

检查：

```bash
sudo tail -n 50 /var/log/nginx/error.log
```

如果有 `Permission denied`，把前端文件重新复制到：

`/usr/share/nginx/html/hot-monitoring`

不要让 nginx 直接读取 `/home/admin/...`

### 2. `@prisma/client did not initialize yet`

说明覆盖代码后没有重新生成 Prisma Client。

执行：

```bash
npm --prefix server install
npm run db:generate
pm2 restart hot-monitoring-api
```

### 3. `Environment variable not found: DATABASE_URL`

说明项目根目录 `.env` 缺失。

检查：

```bash
ls -lah /home/admin/hot-monitoring/.env
```

### 4. 页面能打开，但接口 `127.0.0.1:3000` 不通

说明后端没启动成功。

检查：

```bash
pm2 status
pm2 logs hot-monitoring-api --lines 50
```

### 5. 解压后出现 `_.server`、`_.web`、`_.env.example`

说明本机打包时带进了 macOS 资源分叉文件。

必须重新用下面命令打包：

```bash
COPYFILE_DISABLE=1 tar \
  --exclude='node_modules' \
  --exclude='server/node_modules' \
  --exclude='web/node_modules' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='__MACOSX' \
  -czf /private/tmp/hot-monitoring-deploy-clean.tgz .
```

### 6. `bilibili` 采集 412

当前代码已经做了两层处理：

- 先请求 API
- 412 时自动降级到 HTML 搜索页解析

如果还不稳定，可以在 `.env` 中补：

```env
BILIBILI_COOKIE="你的_bilibili_cookie"
```

## 15. 最短更新流程

如果你下次只想快速更新，按这个顺序做：

```bash
# 本机打包
cd /Users/hon/Desktop/custom/hot-monitoring
COPYFILE_DISABLE=1 tar \
  --exclude='node_modules' \
  --exclude='server/node_modules' \
  --exclude='web/node_modules' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='__MACOSX' \
  -czf /private/tmp/hot-monitoring-deploy-clean.tgz .
```

上传后在服务器执行：

```bash
rm -rf /home/admin/hot-monitoring
mkdir -p /home/admin/hot-monitoring
tar -xzf /home/admin/hot-monitoring-deploy-clean.tgz -C /home/admin/hot-monitoring

cd /home/admin/hot-monitoring
npm install
npm --prefix server install
npm --prefix web install
npm run build
npm run db:generate
npm run db:init

pm2 delete hot-monitoring-api
pm2 start "npm --prefix /home/admin/hot-monitoring/server run start" --name hot-monitoring-api
pm2 save

sudo rm -rf /usr/share/nginx/html/hot-monitoring/*
sudo cp -R /home/admin/hot-monitoring/web/dist/* /usr/share/nginx/html/hot-monitoring/
sudo nginx -t
sudo systemctl restart nginx
```
