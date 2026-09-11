import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const requests: { event: string; data: Record<string, unknown> }[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    requests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
let url: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function command(args: string[]) {
  return exec("pnpm", args, {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, IRONFLOW_URL: url },
    timeout: 10_000,
  });
}

it.each([{ separator: [] }, { separator: ["--"] }])("preserves an explicit rejection with separator %j", async ({ separator }) => {
  await command(["approve", ...separator, "run-123", "false", "declined"]);
  expect(requests.at(-1)).toEqual({
    event: "agent.approve.contact",
    data: { runId: "run-123", approved: false, approver: "operator", reason: "declined" },
  });
});
it.each([{ separator: [] }, { separator: ["--"] }])("routes the reply and its body with separator %j", async ({ separator }) => {
  await command(["reply", ...separator, "case-123", "posted to our sibling account"]);
  expect(requests.at(-1)).toEqual({
    event: "case.resolution.signal",
    data: { caseId: "case-123", kind: "reply", replyClassification: "posted-elsewhere", confirmedActionId: "reassign-to-sibling" },
  });
});
it("rejects an invalid approval value without emitting", async () => {
  const before = requests.length;
  await expect(command(["approve", "--", "run-123", "flase"])).rejects.toThrow();
  expect(requests).toHaveLength(before);
});
