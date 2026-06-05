# 部署

PaperLens 支持本机、局域网、Docker 和公网四类运行方式。默认最安全的是本机模式。

## 本机

```text
PAPERLENS_DEPLOYMENT_MODE=local
HOST=127.0.0.1
PORT=3000
```

适合自己电脑使用。

## 局域网

```text
PAPERLENS_DEPLOYMENT_MODE=lan
HOST=0.0.0.0
PORT=3000
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

适合同一局域网内共享。建议必须设置访问令牌和 secret key。

## Docker / NAS

```text
PAPERLENS_DEPLOYMENT_MODE=docker
HOST=0.0.0.0
PORT=3000
PAPERLENS_PDF_ENGINE=poppler
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

启动：

```bash
npm run docker:up
npm run docker:logs
```

## 公网

```text
PAPERLENS_DEPLOYMENT_MODE=public
PAPERLENS_PUBLIC_URL=https://paperlens.example.com
HOST=0.0.0.0
PORT=3000
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

公网模式建议放在 HTTPS 反向代理后面，并传递 `X-Forwarded-Proto=https`。不要把 API Key 写进镜像、仓库或公开配置。

健康检查：

```text
GET /api/health
```

