// Agent memory reads its URL from the environment when a case starts.
// Normalize it before constructing any worker or client so all three agree.
export const serverUrl =
  process.env.IRONFLOW_URL ?? process.env.IRONFLOW_SERVER_URL ?? "http://localhost:9123";
process.env.IRONFLOW_URL = serverUrl;
