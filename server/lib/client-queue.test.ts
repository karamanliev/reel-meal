import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useQueue } from "../../client/src/hooks/useQueue.js";

class FakeEventSource {
  static current: FakeEventSource | null = null;
  private listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(_url: string | URL) { FakeEventSource.current = this; }
  addEventListener(name: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
    const listeners = this.listeners.get(name) ?? new Set(); listeners.add(callback); this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === "function") this.listeners.get(name)?.delete(listener);
  }
  close(): void {}
  emit(name: string, data: string): void { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data })); }
}

test("queue events received during initial hydration are replayed after the snapshot", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div>", { url: "https://reelmeal.test/" });
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location, history: globalThis.history, EventSource: globalThis.EventSource, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, history: dom.window.history, EventSource: FakeEventSource, IS_REACT_ACT_ENVIRONMENT: true });

  let resolveSnapshot: ((response: Response) => void) | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === "/api/queue") return new Promise<Response>((resolve) => { resolveSnapshot = resolve; });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  let latest: ReturnType<typeof useQueue> | null = null;
  function Harness() { latest = useQueue(); return null; }
  const root = createRoot(dom.window.document.getElementById("app")!);

  try {
    await act(async () => { root.render(React.createElement(Harness)); });
    const eventJob = { id: "event-job", sourceKind: "text", displayLabel: "Soup", status: "queued", addedAt: 1, steps: {}, warnings: [], hasRetainedContext: false };
    await act(async () => { FakeEventSource.current!.emit("job-added", JSON.stringify(eventJob)); });
    await act(async () => { resolveSnapshot!(new Response("[]", { status: 200, headers: { "content-type": "application/json" } })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(latest!.jobs.some((job) => job.id === "event-job"), true);
    await act(async () => { FakeEventSource.current!.emit("job-added", JSON.stringify({ ...eventJob, thumbnailUrl: "/api/assets/event-job/custom-cover" })); });
    assert.equal(latest!.jobs.find((job) => job.id === "event-job")?.thumbnailUrl, "/api/assets/event-job/custom-cover");
  } finally {
    await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  }
});
