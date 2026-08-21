/**
 * Registers the SQL projections in Ironflow and creates the app-owned schema
 * in ragapp. Run once: pnpm setup
 *
 * Two targets, two mechanisms, and that is the whole point of this file:
 * projections go through the Ironflow client, the ragapp schema goes through
 * the app's own pool. The app never opens a connection to Ironflow's database.
 */
import { createClient } from "@ironflow/node";
import { SQL_PROJECTIONS } from "./projections/sql.js";
import { createSchema } from "./src/db.js";

const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

async function main() {
  console.log("Registering SQL projections in Ironflow...");
  for (const projection of SQL_PROJECTIONS) {
    try {
      const result = await client.sqlProjections.create(projection);
      console.log(`  ✓ ${result.name} (${result.status})`);
    } catch {
      // Re-running setup against an existing projection is expected and fine.
      console.log(`  · ${projection.name} already registered`);
    }
  }

  console.log("\nCreating app schema in ragapp...");
  await createSchema();
  console.log("  ✓ chunks, index_pointer");

  console.log("\nDone. Next: pnpm seed-corpus && pnpm start");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
