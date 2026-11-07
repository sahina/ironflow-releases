# Entity Audit Trail Demo

Demonstrates an entity audit trail in Ironflow with an order lifecycle scenario. Each order transition in this demo appends an entity stream event, and each workflow step is durable and replayable.

## What This Shows

An order goes through a full lifecycle: Created → Confirmed → Packed → Shipped → Delivered. Each transition:

- Appends an event to the entity stream (the audit trail)
- Key transitions (Created, Shipped) trigger durable workflow functions (execution proof)
- Is visible on the Entity Audit Trail dashboard page at `/compliance-audit`

## Running the Demo

1. Build and start the Ironflow server (from the repository root):

   ```bash
   make all                       # Build binary and dashboard
   ./build/ironflow serve --dev   # Start server at localhost:9123
   ```

2. Install dependencies and start the worker (in another terminal). The worker must be
   running **before** any events are appended — the engine only creates runs for
   functions that are registered at dispatch time, so seeding first yields zero
   execution proof in step 5:

   ```bash
   cd examples/compliance-audit
   pnpm -C ../../sdk/js build   # Build the JS SDK (examples link to local packages)
   pnpm install
   pnpm tsx worker.ts
   ```

3. Seed the entity stream (in a third terminal):

   ```bash
   cd examples/compliance-audit
   pnpm tsx setup.ts
   ```

   The seeder is not re-runnable: `order-demo-001` already exists, so every append
   fails with a version conflict and the script exits non-zero. Start a fresh server
   (or change `ENTITY_ID`) to seed again. To point the seeder at another server, set
   `IRONFLOW_SERVER_URL`.

4. Open the dashboard at `http://localhost:9123/compliance-audit`

5. Select the `order-demo-001` entity from the left panel to see:
   - Full entity timeline with every event on the stream
   - Workflow execution proof (runs + steps) on the two events that trigger a function:
     `OrderCreated` (`process-order-created`: `validate-order`, `reserve-inventory`) and
     `OrderShipped` (`process-order-shipped`: `notify-customer`, `update-tracking`).
     The other three events are recorded in the stream with no run attached.
   - Export to JSON or CSV

## Features Demonstrated

- **Entity-level audit trail**: Each order transition is an event on the entity stream
- **Execution proof**: An event that triggers a function shows which workflow ran and its step-by-step execution
- **Timestamp filtering**: Filter the timeline by date range
- **Export**: Download the full audit trail as JSON or CSV
- **Print-ready**: Use browser print (Ctrl+P) for a paper copy of the timeline
