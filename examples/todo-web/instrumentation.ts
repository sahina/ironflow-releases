import type { IronflowProjection } from "@ironflow/node";
import { EVENTS } from "./events";

export async function register() {
  // Only run in Node.js runtime — skip Edge to avoid process.version warnings
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // HMR-safe worker: Next.js re-runs register() on every hot reload, and each
    // createWorker().start() opens a new gRPC pull stream. Without cleanup the
    // old streams leak and re-apply events → duplicate projection rows. Keep the
    // worker on globalThis (which survives module replacement) and stop the
    // previous one before starting a new one — this prevents leaks *and* lets
    // code changes to functions/projections hot-reload during dev.
    const g = globalThis as unknown as { __ironflowWorker?: { stop: () => void } };
    g.__ironflowWorker?.stop();

    const { createFunction, createProjection, createWorker } = await import(
      "@ironflow/node"
    );

    // ── Types ────────────────────────────────────────────────────

    interface Todo {
      id: string;
      title: string;
      completed: boolean;
    }

    interface TodoList {
      todos: Todo[];
    }

    // ── Function: process todo commands ──────────────────────────

    const processTodo = createFunction(
      {
        id: "process-todo",
        description: "Handles todo.added, todo.toggled, and todo.deleted events in a single durable function. Each event type runs its own named step — all runs are recorded for time-travel debugging.",
        triggers: [
          { event: EVENTS.TodoAdded },
          { event: EVENTS.TodoToggled },
          { event: EVENTS.TodoDeleted },
        ],
        recording: true,
      },
      async ({ event, step }) => {
        const eventName = event.name;

        if (eventName === EVENTS.TodoAdded) {
          const data = event.data as { id: string; title: string };
          const todo = await step.run("create-todo", async () => {
            return {
              id: data.id,
              title: data.title,
              completed: false,
            };
          });
          return todo;
        }

        if (eventName === EVENTS.TodoToggled) {
          const data = event.data as { id: string };
          await step.run("toggle-todo", async () => {
            return { toggled: data.id };
          });
          return { toggled: data.id };
        }

        if (eventName === EVENTS.TodoDeleted) {
          const data = event.data as { id: string };
          await step.run("delete-todo", async () => {
            return { deleted: data.id };
          });
          return { deleted: data.id };
        }

        return { error: "unknown event" };
      },
    );

    // ── Projection: todo list read model ─────────────────────────

    const todoList = createProjection({
      name: "todo-list",
      events: [EVENTS.TodoAdded, EVENTS.TodoToggled, EVENTS.TodoDeleted],
      initialState: (): TodoList => ({ todos: [] }),
      handler: (state: TodoList, event: { name: string; data: unknown }) => {
        if (event.name === EVENTS.TodoAdded) {
          const data = event.data as { id: string; title: string };
          // Idempotent: ignore a re-delivered TodoAdded for an id we already have.
          if (state.todos.some((t) => t.id === data.id)) return state;
          const newTodo: Todo = {
            id: data.id,
            title: data.title,
            completed: false,
          };
          return { todos: [...state.todos, newTodo] };
        }

        if (event.name === EVENTS.TodoToggled) {
          // Idempotent: SET completed to the value carried by the event, never
          // flip. Flipping (`!t.completed`) is non-idempotent — a re-delivered
          // event would flip back. The client sends the target state.
          const data = event.data as { id: string; completed: boolean };
          // No-op when the todo is gone or already in the target state — return
          // the same state reference instead of allocating a new array, so
          // subscribers don't see a spurious update.
          const todo = state.todos.find((t) => t.id === data.id);
          if (!todo || todo.completed === data.completed) return state;
          return {
            todos: state.todos.map((t) =>
              t.id === data.id ? { ...t, completed: data.completed } : t,
            ),
          };
        }

        if (event.name === EVENTS.TodoDeleted) {
          const data = event.data as { id: string };
          return {
            todos: state.todos.filter((t) => t.id !== data.id),
          };
        }

        return state;
      },
    });

    // ── Start worker ─────────────────────────────────────────────

    const worker = createWorker({
      functions: [processTodo],
      projections: [todoList as IronflowProjection],
    });
    g.__ironflowWorker = worker;

    worker.start()
      .then(() => {
        console.log("Ironflow worker started (embedded in Next.js)");
        console.log("  Events:      todo.added, todo.toggled, todo.deleted");
        console.log("  Function:    process-todo");
        console.log("  Projection:  todo-list");
      })
      .catch((err: unknown) => {
        console.error("Ironflow worker failed to start:", err);
      });
  }
}
