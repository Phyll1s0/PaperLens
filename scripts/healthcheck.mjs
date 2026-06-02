import http from "node:http";

const port = Number(process.env.PORT || 3000);

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
