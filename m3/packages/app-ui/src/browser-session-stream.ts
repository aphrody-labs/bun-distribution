// SPDX-License-Identifier: Apache-2.0
// One subscription per active chat; the server currently supports one notification consumer.
export function browserSessionStream(
  threadId: string,
  onMessage: (message: unknown) => void,
  source: Pick<EventSource, "onmessage" | "close"> = new EventSource("/events"),
): () => void {
  let active = true;
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
    source.onmessage = null;
    source.close();
  };
}
