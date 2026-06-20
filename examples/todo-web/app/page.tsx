"use client";

import { useEffect, useState, useRef } from "react";
import "@/lib/ironflow";
import { ironflow } from "@ironflow/browser";
import type { Subscription } from "@ironflow/browser";
import { EVENTS } from "@/events";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

interface TodoList {
  todos: Todo[];
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [loadTimeMs, setLoadTimeMs] = useState<number | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);
  const startTimeRef = useRef(performance.now());

  useEffect(() => {
    let cancelled = false;

    // 1. Load initial state from the projection (server-side read model)
    ironflow
      .getProjection<TodoList>("todo-list")
      .then((result) => {
        if (!cancelled && result.state?.todos) setTodos(result.state.todos);
        if (!cancelled) {
          setLoadTimeMs(Math.round(performance.now() - startTimeRef.current));
          setInitializing(false);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch projection:", err);
        if (!cancelled) setInitializing(false);
      });

    // 2. Subscribe to projection updates — the server pushes the new state
    //    whenever the projection runner saves. No polling, no re-fetching.
    ironflow
      .subscribeToProjection<TodoList>("todo-list", {
        onUpdate: (state) => {
          if (!cancelled && state?.todos) setTodos(state.todos);
        },
      })
      .then((sub) => {
        if (cancelled) {
          sub.unsubscribe();
        } else {
          subscriptionRef.current = sub;
        }
      })
      .catch((err) => console.error("Projection subscribe failed:", err));

    return () => {
      cancelled = true;
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, []);

  const addTodo = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      await ironflow.emit(EVENTS.TodoAdded, {
        id: crypto.randomUUID(),
        title: title.trim(),
      });
      setTitle("");
    } finally {
      setLoading(false);
    }
  };

  const toggleTodo = async (id: string) => {
    await ironflow.emit(EVENTS.TodoToggled, { id });
  };

  const deleteTodo = async (id: string) => {
    await ironflow.emit(EVENTS.TodoDeleted, { id });
  };

  if (initializing) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading todos...</p>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={addTodo} className="flex gap-2 mb-6">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {todos.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No todos yet</p>
      ) : (
        <ul className="space-y-2">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3"
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span
                className={`flex-1 text-sm ${todo.completed ? "line-through text-gray-400" : "text-gray-900"}`}
              >
                {todo.title}
              </span>
              <button
                onClick={() => deleteTodo(todo.id)}
                className="text-gray-400 hover:text-red-500 text-sm"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-400 mt-8 text-center">
        {todos.length} todo{todos.length !== 1 ? "s" : ""} &middot;{" "}
        {todos.filter((t) => t.completed).length} completed
        {loadTimeMs !== null && (
          <span> &middot; loaded in {loadTimeMs}ms</span>
        )}
      </p>
    </div>
  );
}
