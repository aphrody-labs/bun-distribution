// SPDX-License-Identifier: Apache-2.0
// One subscription per active chat; the server currently supports one notification consumer.
export function browserSessionStream(
  threadId: string,
  onMessage: (message: unknown) => void,
  source: Pick<EventSource, "onmessage" | "close"> = new EventSource("/events"),
): () => void {
  let active = true;
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the source contract is the onmessage property (fake EventSource in browser-session-stream.test.ts delivers through it)
  source.onmessage = (event) => {
    if (!active) return;
    let message: { params?: { threadId?: string; thread?: { id?: string } } };
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const owner = message.params?.threadId ?? message.params?.thread?.id;
    if (owner && owner !== threadId) return;
    onMessage(message);
  };
  return () => {
    active = false;
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- same onmessage contract as the subscription above; detach must null the property the fake exposes
    source.onmessage = null;
    source.close();
  };
}
