import { createApp } from "./app";
import { loadConfig } from "../config/env";

async function start() {
  const app = await createApp();
  const config = loadConfig();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
