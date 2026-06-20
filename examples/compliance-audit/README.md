# Compliance Audit Trail Demo

Demonstrates Ironflow's compliance audit trail capabilities using an order lifecycle scenario. Every state mutation is an entity stream event, every workflow step is durable and replayable.

## What This Shows

An order goes through a full lifecycle: Created → Confirmed → Packed → Shipped → Delivered. Each transition:

- Appends an event to the entity stream (the audit trail)
- Key transitions (Created, Shipped) trigger durable workflow functions (execution proof)
- Is visible in the Compliance Audit Trail dashboard at `/compliance-audit`

## Running the Demo

1. Build and start the Ironflow server (from the repository root):

   ```bash
   make all                       # Build binary and dashboard
   ./build/ironflow serve --dev   # Start server at localhost:9123
   ```

2. Install dependencies and run the demo setup (in another terminal):

   ```bash
   cd examples/compliance-audit
   pnpm -C ../../sdk/js build   # Build the JS SDK (examples link to local packages)
   pnpm install
   pnpm tsx setup.ts
   ```

3. Start the worker (processes events and creates execution proof):

   ```bash
   pnpm tsx worker.ts
   ```

4. Open the dashboard at `http://localhost:9123/compliance-audit`

5. Select the `order-demo-001` entity from the left panel to see:
   - Full entity timeline with every state change
   - Workflow execution proof (runs + steps) for each event
   - Export to JSON or CSV for compliance review

## Compliance Features Demonstrated

- **Entity-level audit trail**: Every state change is an immutable event
- **Execution proof**: Each event shows which workflow ran and its step-by-step execution
- **Timestamp filtering**: Filter the timeline by date range
- **Export**: Download the full audit trail as JSON or CSV
- **Print-ready**: Use browser print (Ctrl+P) for audit committee review
