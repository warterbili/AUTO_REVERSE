# Website reverse-engineering techniques

## 1. Capture API endpoints

```python
# Listen for all XHR/Fetch requests
await cdp.send("Network.enable")
await cdp.navigate("https://target.com")
await asyncio.sleep(10)  # wait for the page to finish loading

reqs = list(cdp._network_requests.values())
api_calls = [r for r in reqs if r.get("type") in ("XHR", "Fetch")]
for r in api_calls:
    print(r["method"], r["url"])
    if r.get("postData"):
        print("  Body:", r["postData"])
```

## 2. Get the response body

```python
# After Network.enable, save the requestId when the request is sent
# Find the matching requestId via _events
for evt in cdp._events:
    if evt.get("method") == "Network.responseReceived":
        req_id = evt["params"]["requestId"]
        url = evt["params"]["response"]["url"]
        if "api" in url:
            body = await cdp.get_response_body(req_id)
            print(f"API: {url}")
            print(f"Response: {body[:500]}")
```

## 3. Hook XHR/Fetch (JS injection)

```python
# Inject the hook before the page loads to capture all requests
hook_js = """
window._captured_requests = [];
const origFetch = window.fetch;
window.fetch = function(...args) {
    window._captured_requests.push({type:'fetch', url: args[0], options: args[1]});
    return origFetch.apply(this, args);
};
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
    window._captured_requests.push({type:'xhr', method, url});
    return origOpen.apply(this, arguments);
};
"""
await cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": hook_js})
await cdp.navigate("https://target.com")
await asyncio.sleep(5)
requests = await cdp.eval("JSON.stringify(window._captured_requests)")
print(requests)
```

## 4. Inspect global JS variables

```python
# List all (non-standard) global variables on the page
globals_js = """
Object.keys(window).filter(k => {
    try {
        return !['undefined','object','function'].includes(typeof window[k]) ||
               (typeof window[k] === 'object' && window[k] !== null && 
                !['document','history','location','navigator','screen','window'].includes(k));
    } catch(e) { return false; }
}).slice(0, 50)
"""
result = await cdp.eval(globals_js)
print(result)

# Read a specific variable
data = await cdp.eval("JSON.stringify(window.__INITIAL_STATE__ || window.__NEXT_DATA__ || {})")
```

## 5. Bypass simple anti-bot defenses

```python
# Spoof the navigator object
await cdp.eval("""
Object.defineProperty(navigator, 'webdriver', {get: () => false});
Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR','en']});
""")

# Set a custom UA
await cdp.set_user_agent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/145.0.0.0 Safari/537.36"
)
```

## 6. WebSocket traffic analysis

```python
# Listen for WebSocket frames
ws_frames = []
async def handle_event(msg):
    if msg.get("method") in ("Network.webSocketFrameReceived", "Network.webSocketFrameSent"):
        ws_frames.append(msg["params"])

cdp._handle_event = handle_event  # override event handling
await cdp.send("Network.enable")
await cdp.navigate("https://target.com")
await asyncio.sleep(15)
for frame in ws_frames:
    print(frame.get("response", {}).get("payloadData", "")[:200])
```

## 7. Capture a full long-page screenshot

```python
await cdp.screenshot("/tmp/full_page.png", full_page=True)
```

## 8. Handling SPAs (single-page applications)

```python
# Wait for data to finish loading (wait for the loading indicator to disappear)
await cdp.navigate("https://target.com")
await cdp.wait_for_selector(".content-loaded", timeout=20)

# Or wait for a specific JS variable
for _ in range(20):
    data = await cdp.eval("window.__DATA_LOADED__")
    if data:
        break
    await asyncio.sleep(0.5)
```

## 9. Multi-tab operations

```python
import urllib.request, json, urllib.parse

# Open a new tab
res = urllib.request.urlopen("http://localhost:9222/json/new?about:blank").read()
new_tab = json.loads(res)

# Connect to the new tab
async with CDPClient(new_tab["webSocketDebuggerUrl"]) as cdp2:
    await cdp2.navigate("https://other-site.com")
```

## 10. Save/restore session

```python
# Save cookies to a file
cookies = await cdp.get_cookies()
with open("session.json", "w") as f:
    json.dump(cookies, f)

# Restore cookies
with open("session.json") as f:
    cookies = json.load(f)
for c in cookies:
    await cdp.set_cookie(c["name"], c["value"], c["domain"], c.get("path", "/"))
```
