import { writeFileSync, mkdirSync } from "node:fs";
import { buildStatement } from "./build-statement.js";

const statement = buildStatement();

mkdirSync(new URL("../fixtures/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../fixtures/statement.json", import.meta.url),
  JSON.stringify(statement, null, 2) + "\n",
);
console.log(
  `wrote ${statement.transactions.length} transactions, ${
    statement.transactions.length - statement.applicationLines.length
  } residual`,
);
