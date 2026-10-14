import { getServerUrl } from "@ironflow/node";

// Agent memory needs the selected URL in the environment even when it defaults to localhost.
export const serverUrl = getServerUrl();
process.env.IRONFLOW_SERVER_URL = serverUrl;
