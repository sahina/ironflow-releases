import { serverUrl } from "../src/config.js";
import { readFileSync } from "node:fs";
import { createClient } from "@ironflow/node";
import { EVENTS } from "../src/events.js";

const client = createClient({ serverUrl });
const statement = JSON.parse(readFileSync(new URL("../fixtures/statement.json", import.meta.url), "utf8"));

const result = await client.emit(EVENTS.StatementReceived, statement);
console.log(`emitted statement.received (${statement.transactions.length} transactions)`, result);
