import { openDb } from "./src/db.js";

const db = openDb();
db.close();
console.log("rag.db ready (chunks + vec_chunks). Next: pnpm start, then pnpm ingest");
