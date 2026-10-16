// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { AgentClient, AgentError } from "../src/agent";

const server = String.raw`
const send = value => console.log(JSON.stringify(value));
let pending;
let approval;
for await (const line of console) {
  const msg = JSON.parse(line);
  if (msg.id === undefined) continue;
  if (msg.id === 'permission') { send({id: approval, result: {denied: msg.error.code === -32601}}); continue; }
  const p = msg.params || {};
  let result = {};
  const event = (method, extra={}) => send({method, params: {threadId:p.threadId, turnId:'turn-a', ...extra}});
  switch (msg.method) {
    case 'initialize': result = {userAgent:'fixture/1.0'}; break;
    case 'thread/start': result = {thread:{id:'thread-a'}}; break;
    case 'turn/start':
      event('item/agentMessage/delta', {delta:'été 日本語'});
      if (p.input[0].text !== 'wait') event('turn/completed', {turn:{id:'turn-a',status:'completed'}});
      result = {turn:{id:'turn-a'}};
      break;
    case 'turn/interrupt': event('turn/completed', {turn:{id:'turn-a',status:'interrupted'}}); break;
    case 'pair':
      if (!pending) {pending=msg; continue;}
      send({id:msg.id,result:p}); send({id:pending.id,result:pending.params}); pending=null; continue;
    case 'fail': send({id:msg.id,error:{code:-32601,message:'unsupported',data:{unsupported:true}}}); continue;
    case 'crash': process.exit(3);
    case 'malformed': console.log('[]'); continue;
    case 'hang': continue;
    case 'serverRequest': approval=msg.id; send({id:'permission',method:'item/commandExecution/requestApproval',params:{}}); continue;
    case 'stderr': await Bun.stderr.write('x'.repeat(200000)); break;
  }
  send({id:msg.id,result});
}
`;
const clients: AgentClient[] = [];
function makeClient(requestTimeoutMs = 3000) {
  const client = new AgentClient({
    executable: process.execPath,
    args: ["--eval", server],
    requestTimeoutMs,
  });
  clients.push(client);
  return client;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

test("preserves early Unicode events and completion", async () => {
  const client = makeClient();
  await client.initialize();
  const thread = (await client.startThread()).thread.id;
  const turn = await client.startTurn(thread, "hello");
  const events = await Array.fromAsync(turn.events());
  expect(events[0]?.params?.delta).toBe("été 日本語");
  expect(events.at(-1)?.method).toBe("turn/completed");
  expect(
    (await Array.fromAsync((await client.startTurn(thread, "again")).events()))
      .length,
  ).toBe(2);
});

test("interrupt does not compete with streaming notifications", async () => {
  const client = makeClient();
  const turn = await client.startTurn("thread-a", "wait");
  await turn.interrupt();
  expect(
    (await Array.fromAsync(turn.events())).at(-1)?.params?.turn.status,
  ).toBe("interrupted");
});

test("routes concurrent replies arriving in reverse order", async () => {
  const client = makeClient();
  expect(
    await Promise.all([
      client.request("pair", { value: 1 }),
      client.request("pair", { value: 2 }),
    ]),
  ).toEqual([{ value: 1 }, { value: 2 }]);
});

test("structured errors and server approvals preserve connection", async () => {
  const client = makeClient();
  try {
    await client.request("fail");
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).data).toEqual({ unsupported: true });
  }
  expect(await client.request("serverRequest")).toEqual({ denied: true });
});

for (const method of ["crash", "malformed"]) {
  test(`${method} wakes request and active turn`, async () => {
    const client = makeClient();
    const turn = await client.startTurn("thread-a", "wait");
    let requestError: unknown;
    try {
      await client.request(method);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toBeInstanceOf(Error);
    let streamError: unknown;
    try {
      await Array.fromAsync(turn.events());
    } catch (error) {
      streamError = error;
    }
    expect(streamError).toBeInstanceOf(Error);
  });
}

test("timeout removes waiter; stderr draining and repeated close", async () => {
  const client = makeClient(500);
  await expect(client.request("hang")).rejects.toThrow("timed out");
  expect(await client.request("stderr")).toEqual({});
  await client.close();
  await client.close();
  await expect(client.request("thread/start")).rejects.toThrow("closed");
});
