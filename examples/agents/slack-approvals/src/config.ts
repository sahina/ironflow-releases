import { createClient, getServerUrl } from '@ironflow/node';

export const serverUrl=getServerUrl();
export const environment=process.env.IRONFLOW_ENV;
// Four sequential calls, including the stored decision read, fit Slack's three-second deadline.
export const client=createClient({serverUrl, environment, timeout:500, retry:{maxAttempts:1}});
