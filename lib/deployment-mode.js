const DEPLOYMENT_LABELS = {
  local: "本机",
  lan: "内网共享",
  public: "公网",
  docker: "Docker",
};

export function normalizeDeploymentMode(value) {
  const clean = String(value || "auto").trim().toLowerCase();
  if (["local", "lan", "public", "docker", "auto"].includes(clean)) {
    return clean;
  }
  if (["intranet", "network", "share", "shared"].includes(clean)) {
    return "lan";
  }
  if (["prod", "production", "server"].includes(clean)) {
    return "public";
  }
  return "auto";
}

export function buildDeploymentStatus(options = {}) {
  const configuredMode = normalizeDeploymentMode(options.mode);
  const publicUrl = normalizePublicUrl(options.publicUrl);
  const host = String(options.host || "127.0.0.1");
  const port = Number(options.port || 0);
  const isDocker = Boolean(options.isDocker);
  const authRequired = Boolean(options.authRequired);
  const secretsEncrypted = Boolean(options.secretsEncrypted);
  const requestSecure = Boolean(options.requestSecure);
  const mode = inferDeploymentMode({
    configuredMode,
    host,
    isDocker,
    publicUrl,
  });
  const issues = [];
  const actions = [];

  if (mode === "local" && !isLocalBindHost(host)) {
    issues.push(buildIssue(
      "local-bound-to-network",
      "warn",
      "当前选择本机模式，但 HOST 不是 127.0.0.1/localhost，局域网设备可能可以访问。",
    ));
    actions.push("HOST=127.0.0.1");
  }

  if ((mode === "lan" || mode === "docker") && !authRequired) {
    issues.push(buildIssue(
      "shared-without-token",
      "warn",
      "当前模式可能被局域网或容器端口映射访问，建议启用访问令牌。",
    ));
    actions.push("PAPERLENS_ACCESS_TOKEN=change-this-long-random-token");
  }

  if (mode === "public") {
    if (!authRequired) {
      issues.push(buildIssue(
        "public-without-token",
        "error",
        "公网模式必须启用访问令牌，否则任何人都可能访问论文、导出和本地图片。",
      ));
      actions.push("PAPERLENS_ACCESS_TOKEN=change-this-long-random-token");
    }

    if (!secretsEncrypted) {
      issues.push(buildIssue(
        "public-without-secret-key",
        "warn",
        "公网模式建议设置独立 PAPERLENS_SECRET_KEY，避免访问令牌变化后无法解密 API Key。",
      ));
      actions.push("PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret");
    }

    if (!publicUrl) {
      issues.push(buildIssue(
        "public-url-missing",
        "warn",
        "公网模式建议设置 PAPERLENS_PUBLIC_URL，便于健康检查确认 HTTPS 和外部入口。",
      ));
      actions.push("PAPERLENS_PUBLIC_URL=https://your-domain.example");
    } else if (!publicUrl.startsWith("https://")) {
      issues.push(buildIssue(
        "public-url-not-https",
        "warn",
        "公网入口建议使用 HTTPS，避免访问令牌和 API 请求在明文链路中传输。",
      ));
    }

    if (!requestSecure && publicUrl && publicUrl.startsWith("https://")) {
      issues.push(buildIssue(
        "https-proxy-not-detected",
        "info",
        "当前健康检查请求没有显示 HTTPS。如果你在反向代理后运行，请确认 X-Forwarded-Proto=https 已传给 PaperLens。",
      ));
    }
  }

  if (mode !== "local" && !secretsEncrypted) {
    issues.push(buildIssue(
      "shared-secrets-not-encrypted",
      "info",
      "共享或部署模式建议设置 PAPERLENS_SECRET_KEY，让本机保存的 API Key 加密落盘。",
    ));
  }

  const level = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.some((issue) => issue.severity === "warn")
      ? "warn"
      : "ok";

  return {
    mode,
    configuredMode,
    inferred: configuredMode === "auto",
    label: DEPLOYMENT_LABELS[mode] || mode,
    level,
    host,
    port,
    publicUrl,
    isDocker,
    shared: mode !== "local",
    authRequired,
    secretsEncrypted,
    requestSecure,
    issues: dedupeIssues(issues),
    actions: [...new Set(actions)].slice(0, 4),
    summary: buildDeploymentSummary(mode, level, authRequired),
  };
}

function inferDeploymentMode({ configuredMode, host, isDocker, publicUrl }) {
  if (configuredMode !== "auto") {
    return configuredMode;
  }

  if (publicUrl) {
    return "public";
  }

  if (isDocker) {
    return "docker";
  }

  if (isLocalBindHost(host)) {
    return "local";
  }

  return "lan";
}

function normalizePublicUrl(value) {
  const clean = String(value || "").trim();
  if (!clean) {
    return "";
  }

  try {
    const url = new URL(clean);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href.replace(/\/$/, "");
    }
  } catch {
    return "";
  }

  return "";
}

function isLocalBindHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host || "").toLowerCase());
}

function buildIssue(code, severity, message) {
  return { code, severity, message };
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    if (seen.has(issue.code)) {
      return false;
    }
    seen.add(issue.code);
    return true;
  });
}

function buildDeploymentSummary(mode, level, authRequired) {
  if (level === "error") {
    return "部署配置存在高风险，请先修正访问保护。";
  }
  if (level === "warn") {
    return "部署配置可运行，但建议补齐安全设置。";
  }
  if (mode === "local") {
    return "本机开发模式，仅绑定本机地址。";
  }
  return authRequired
    ? "共享/部署模式已启用访问保护。"
    : "共享/部署模式未启用访问保护。";
}
