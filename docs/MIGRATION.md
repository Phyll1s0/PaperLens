# 迁移、备份和存储

## 不要提交本地数据

开源仓库只放代码。不要提交：

- `.env`
- `data/`
- `uploads/`
- `paper-assets/`
- `.cache/`
- API Key
- 论文 PDF

这些路径已经在 `.gitignore` 中排除。

## 导出数据

换电脑或升级前备份：

```bash
npm run data:export
```

默认输出：

```text
dist/paperlens-data-时间戳/
dist/paperlens-data-时间戳.tar.gz
```

默认包含论文数据、上传 PDF、页面图片和裁剪资产；不包含 `.env` 和 `data/secrets.json`。

## 导入数据

目标电脑先安装 PaperLens：

```bash
git clone https://github.com/Phyll1s0/PaperLens.git
cd PaperLens
npm install
npm run setup
```

导入：

```bash
npm run data:import -- /path/to/paperlens-data-时间戳.tar.gz --yes
```

不加 `--yes` 时只显示导入计划：

```bash
npm run data:import -- /path/to/paperlens-data-时间戳.tar.gz
```

导入前脚本会把目标电脑当前的 `data/`、`uploads/`、`paper-assets/` 备份到 `.cache/paperlens-import-backup-*`。

## 迁移 secrets

确实要在自己的两台机器之间带 API Key：

```bash
npm run data:export -- --include-secrets
npm run data:import -- /path/to/paperlens-data-时间戳.tar.gz --yes --include-secrets
```

如果 `data/secrets.json` 是加密的，目标机器需要兼容的 `PAPERLENS_SECRET_KEY` 或 `PAPERLENS_ACCESS_TOKEN`。

公开 Release 不要使用 `--include-secrets`。

## SQLite

默认存储是 JSON。需要更稳的长任务恢复和后续检索时，可以迁移到 SQLite：

```bash
npm run storage:migrate:sqlite
```

`.env`：

```text
PAPERLENS_STORAGE=sqlite
PAPERLENS_SQLITE_PATH=./data/paperlens.sqlite
```

回滚到 JSON：

```bash
npm run storage:export:json
```

然后把 `.env` 改回：

```text
PAPERLENS_STORAGE=json
PAPERLENS_DATA_DIR=导出的回滚目录
```

