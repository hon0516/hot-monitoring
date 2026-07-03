# AGENTS.md

## Packaging Rules

- Deployment archives must be generated under the project directory at `dist-packages/hot-monitoring-deploy-clean.tgz`.
- Deployment archives must exclude local-only debugging and runtime artifacts, especially `.playwright-mcp/`. Also exclude `.env`, `.git/`, `node_modules/`, `server/node_modules/`, `web/node_modules/`, `web/dist/`, `dist-packages/`, local SQLite files such as `server/dev.db` and `server/prisma/dev.db`, `.DS_Store`, `._*`, and `__MACOSX`.

Use this command from the repository root:

```bash
mkdir -p dist-packages
COPYFILE_DISABLE=1 tar \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='server/node_modules' \
  --exclude='web/node_modules' \
  --exclude='web/dist' \
  --exclude='dist-packages' \
  --exclude='.playwright-mcp' \
  --exclude='.netlify' \
  --exclude='server/.cache' \
  --exclude='server/dev.db' \
  --exclude='server/prisma/dev.db' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='__MACOSX' \
  -czf dist-packages/hot-monitoring-deploy-clean.tgz .
```
