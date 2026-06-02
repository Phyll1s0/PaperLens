import http from "node:http";

const port = Number(process.env.PORT || 3000);
const REQUIRED_SERVICE_SCHEMA_VERSION = 2;

const request = http.get({
  hostname: "127.0.0.1",
  port,
  path: "/api/health",
  timeout: 4000,
}, (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
  });
  response.on("end", () => {
    if (response.statusCode !== 200) {
      console.error(`Health check failed with HTTP ${response.statusCode}`);
      process.exit(1);
    }

    try {
      const payload = JSON.parse(body);
      if (payload.needsRestart) {
        console.warn(payload.restartReason || "PaperLens service source changed after startup. Restart the service.");
      } else if (payload.serviceSchemaVersion === undefined) {
        console.warn("PaperLens service is running an older health schema. Restart the service after updating code.");
      } else if (Number(payload.serviceSchemaVersion) < REQUIRED_SERVICE_SCHEMA_VERSION) {
        console.warn(`PaperLens service schema is ${payload.serviceSchemaVersion}; expected ${REQUIRED_SERVICE_SCHEMA_VERSION}. Restart the service.`);
      }

      if (payload.ok) {
        const queue = payload.queue || {};
        const activeJobs = Number(queue.activeJobs || 0);
        const queuedJobs = Number(queue.queuedJobs || 0);
        const runningJobs = Number(queue.runningJobs || 0) + Number(queue.cancelingJobs || 0);
        const queueLabel = Number.isFinite(Number(queue.savedJobs))
          ? `queue ${runningJobs} running / ${queuedJobs} queued / ${activeJobs} active`
          : "queue unavailable";
        console.log([
          `PaperLens OK v${payload.version || "0.0.0"}`,
          `schema ${payload.serviceSchemaVersion ?? "old"}`,
          `uptime ${formatDuration(payload.uptimeSeconds || 0)}`,
          queueLabel,
        ].join(" · "));
      }

      process.exit(payload.ok ? 0 : 1);
    } catch {
      console.error("Health check response was not JSON.");
      process.exit(1);
    }
  });
});

request.on("timeout", () => {
  request.destroy(new Error("Health check timed out."));
});

request.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  if (value < 60) {
    return `${value}s`;
  }

  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (minutes < 60) {
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}
