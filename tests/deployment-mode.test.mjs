import assert from "node:assert/strict";
import {
  buildDeploymentStatus,
  normalizeDeploymentMode,
} from "../lib/deployment-mode.js";

assert.equal(normalizeDeploymentMode("production"), "public");
assert.equal(normalizeDeploymentMode("share"), "lan");
assert.equal(normalizeDeploymentMode("weird"), "auto");

const local = buildDeploymentStatus({
  mode: "auto",
  host: "127.0.0.1",
  port: 3000,
  authRequired: false,
});
assert.equal(local.mode, "local");
assert.equal(local.level, "ok");
assert.equal(local.shared, false);

const lan = buildDeploymentStatus({
  mode: "auto",
  host: "0.0.0.0",
  port: 3000,
  authRequired: false,
});
assert.equal(lan.mode, "lan");
assert.equal(lan.level, "warn");
assert.ok(lan.issues.some((issue) => issue.code === "shared-without-token"));
assert.ok(lan.actions.some((action) => action.startsWith("PAPERLENS_ACCESS_TOKEN=")));

const docker = buildDeploymentStatus({
  mode: "auto",
  host: "0.0.0.0",
  isDocker: true,
  authRequired: true,
  secretsEncrypted: true,
});
assert.equal(docker.mode, "docker");
assert.equal(docker.level, "ok");

const publicUnsafe = buildDeploymentStatus({
  mode: "public",
  host: "0.0.0.0",
  publicUrl: "http://paperlens.example.com",
  authRequired: false,
});
assert.equal(publicUnsafe.mode, "public");
assert.equal(publicUnsafe.level, "error");
assert.ok(publicUnsafe.issues.some((issue) => issue.code === "public-without-token"));
assert.ok(publicUnsafe.issues.some((issue) => issue.code === "public-url-not-https"));

const publicSafe = buildDeploymentStatus({
  mode: "auto",
  host: "0.0.0.0",
  publicUrl: "https://paperlens.example.com/",
  authRequired: true,
  secretsEncrypted: true,
  requestSecure: true,
});
assert.equal(publicSafe.mode, "public");
assert.equal(publicSafe.publicUrl, "https://paperlens.example.com");
assert.equal(publicSafe.level, "ok");
assert.equal(publicSafe.inferred, true);
