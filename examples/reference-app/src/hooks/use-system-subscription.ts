"use client";

import { useEffect, useRef, useState } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { useIronflow } from "@/components/ironflow-provider";

/**
 * Subscribes to one pub/sub pattern for the lifetime of the component.
 *
 * Extracted because three pages had grown byte-identical copies of the same
 * block — the connection gate, the "Already subscribed" retry, the cancelled
 * flag that unsubscribes a subscription which resolved after unmount, and the
 * cleanup. Each copy was a place to get one of those four wrong.
 *
 * The retry is not decoration. React 18 Strict Mode double-invokes effects in
 * development, and a fast remount can land the second subscribe before the
 * first has torn down, which the client rejects with "Already subscribed".
 * Retrying a few times at 100ms rides that out; anything else is logged and
 * gives up.
 *
 * `onEvent` is held in a ref and deliberately kept out of the effect deps, so
 * an inline arrow — which every caller passes — does not tear down and rebuild
 * the subscription on every render.
 *
 * NOT used by events/patterns/page.tsx, which subscribes to a list of patterns
 * in one effect and *skips* a conflicting pattern rather than retrying it.
 * Bending that onto this hook would change its behaviour, not deduplicate it.
 *
 * @returns whether the subscription is currently live, for a status badge.
 */
export function useSystemSubscription(
  pattern: string,
  onEvent: (event: SubscriptionEvent) => void
): boolean {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const subRef = useRef<Subscription | null>(null);
  const onEventRef = useRef(onEvent);
  const { isConnected } = useIronflow();

  // Kept current every render so the effect below can stay on a stable dep list.
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!isConnected) return;

    let cancelled = false;

    const trySubscribe = async (retries = 3): Promise<void> => {
      try {
        const sub = await ironflow.subscribe(pattern, {
          onEvent: (event: SubscriptionEvent) => onEventRef.current(event),
        });

        // The await above can resolve after unmount; without this the
        // subscription leaks and keeps calling into a dead component.
        if (cancelled) {
          sub.unsubscribe();
          return;
        }
        subRef.current = sub;
        setIsSubscribed(true);
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("Already subscribed") &&
          retries > 0 &&
          !cancelled
        ) {
          await new Promise((r) => setTimeout(r, 100));
          return trySubscribe(retries - 1);
        }
        if (!cancelled) console.error(`Subscription to ${pattern} failed:`, err);
      }
    };

    void trySubscribe();

    return () => {
      cancelled = true;
      subRef.current?.unsubscribe();
      subRef.current = null;
      setIsSubscribed(false);
    };
  }, [isConnected, pattern]);

  return isSubscribed;
}
