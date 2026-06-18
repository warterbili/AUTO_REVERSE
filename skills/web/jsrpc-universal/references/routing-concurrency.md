# Routing / concurrency / queuing / keep-alive / troubleshooting

Almost all of JsRpc/Sekiro's reliability lives at this layer. RPC itself is "one request, one response"; the hard parts are **how to distribute across multiple clients, how to keep concurrency from stepping on itself, how to keep connections alive, and how to locate the cause of a timeout**.

## 1. group / clientId routing model

- **group**: a logical namespace, required at injection time (`?group=xxx`). The same group = a set of equivalent clients.
- **clientId**: distinguishes a specific client within a group. When omitted, the server generates one automatically (JsRpc uses the server-issued `registerId`, which the js side records in the global `rpc_client_id` and automatically carries on reconnect).
- **Call distribution (JsRpc)**: if the invocation provides only `group` → the server picks one client **at random** from that group. If `clientId` is given → it hits that client exactly. Adding `fuzzy=true|1` → **fuzzy matching**: any online client whose clientId **contains** the passed substring matches; when several match, one is picked at random, **preferring healthy clients**.
- **Sekiro**: also `group`+`clientId`; the commercial version supports explicit load-balancing strategies, while the open-source version distributes by group.

### When to isolate with clientId
- When reusing "logged-in sessions", use **one clientId per account** (or even one group), otherwise requests will randomly land on another account's session.
- Canary/debugging: use an exact clientId to hit a specific device; use fuzzy to hit a batch for bulk load testing.

## 2. Concurrency and queuing (the most critical insight)

**A single browser/frida client is single-threaded** — although the server can receive multiple HTTP requests at once, requests sent to the **same client** are **executed serially** on the client side (one message_id, one round trip). Therefore:

- A single client's effective throughput ≈ `1 / single algorithm execution time`. Algorithm 5ms → theoretically ~200 QPS; but with the ws round trip and browser scheduling added, the actual figure is far lower.
- **Scale concurrency horizontally**: register **N clientIds** under the same group (N tabs / N browser instances / N real devices), and the server's random distribution gives ≈ N times the throughput. This is the only correct way to raise concurrency in JsRpc.
- **Do not** expect "multithreading" inside a single client — browser JS is single-threaded, and frida also processes messages in a queue.
- For concurrency on the Python side, use a thread pool / async to fire multiple HTTP requests at once; the server will spread them across different clients in the group (provided multiple clients are registered).

### Message matching (how it works)
On each invocation the server generates a `message_id` and sends it down with the request; after the client finishes execution it returns the same `message_id` + `response_data`; the server uses the message_id to match the result back to the suspended HTTP request and returns it. So **the client must call resolve** (otherwise that message_id never returns and the HTTP side hangs until timeout).

## 3. Keep-alive / reconnect

- **JsRpc HlClient**: automatically `connect()` reconnects **10 seconds** after `onclose` and `error`; on `open` it automatically `_reportActions()` to re-report all registered actions. `regAction` also triggers `_reportActions`.
- **A page refresh/navigation breaks the ws** → you must re-inject and re-`new HlClient + regAction`. Injecting via Tampermonkey at `document-start` mitigates this (see injection-patterns.md).
- **Timeout config**: `config.yaml`'s `DefaultTimeOut` (default 30s) = how long the HTTP side waits at most when the client returns nothing. Increase it for slow algorithms; decrease it to fail fast.
- **Sekiro**: persistent connections with heartbeat keep-alive; after a client drops, the central service removes it from the group, and calls to that group go to other online clients.

## 4. Troubleshooting quick reference (when /go returns something abnormal)

| Symptom | Most likely cause | Action |
|---|---|---|
| Returns "timeout" / hangs the full DefaultTimeOut | wrong action name / client can't find the action | `GET /list` to check whether the client is online and the action is reported; verify the `action=` spelling |
| Returns "action not found" | the page refreshed before registration, or the ws dropped without reconnecting | re-inject + `regAction` |
| Always times out but the function runs fine manually | the fn went async and forgot to `resolve` | always `resolve(...)` in the async branch, or `return` the Promise |
| Occasional timeouts / mixed-up results | a single client is overwhelmed and queued by high concurrency | add more clientIds in the same group to distribute; throttle concurrency on the Python side |
| Result is a garbled stringified object | double JSON handling of param | for multiple parameters `json.dumps` on the Python side; the js-side framework will automatically `JSON.parse` |
| Can't connect | server not started / port or wss protocol mismatch | check the console for `rpc connection error` logs; http→ws, https→wss |
| Others can call your endpoint | `0.0.0.0` exposure | change `config.yaml` to `127.0.0.1` or add auth/firewall |

## 5. How to use the /list output
`GET /list` returns all current group → clientId → registered actions. Whenever you suspect "it won't go through", look here first: whether the client is present, whether the action was reported, and whether you connected to the wrong group.
