---
name: mitm-capture
description: A mitmproxy-based tool for capturing mobile-app network traffic, detecting encrypted parameters, and analyzing APIs.
---

# MITM Capture — Mobile App Traffic Capture and Analysis

An automated, mitmproxy-based capture tool for intercepting and analyzing a mobile app's network requests, detecting encrypted parameters, and generating a structured analysis report. Suited to API reverse-engineering of Android/iOS apps.

## Tool Location

```
<mitm-capture-dir>/
```

## Prerequisites

```bash
pip install mitmproxy rich pyyaml
# or
cd <mitm-capture-dir> && pip install -r requirements.txt
```

The device must be configured with a Wi-Fi proxy pointing to the IP:8080 of the machine running mitmproxy, and the mitmproxy CA certificate must be installed. Run `bash setup.sh` for the full configuration guide.

## Command Reference

### Start Capture

```bash
cd <mitm-capture-dir>

# Basic start (listens on 0.0.0.0:8080)
python cli.py start

# Specify the port and target domain
python cli.py start --port 9090 --domain api.example.com

# Transparent proxy mode
python cli.py start --transparent
```

Once started, the terminal displays a live, color-coded request log:
- HTTP methods are color-coded (GET=green, POST=cyan, DELETE=red)
- Status codes are colored (2xx=green, 3xx=yellow, 4xx/5xx=red)
- Auth headers are highlighted in yellow
- Encrypted parameters are flagged with a red warning

Data is saved automatically as JSONL files to `output/{domain}/{timestamp}.jsonl`.

### Analysis Report

```bash
# Analyze and print to the terminal
python cli.py analyze output/

# Output to a Markdown file
python cli.py analyze output/ -o report.md

# Analyze data for a specific domain
python cli.py analyze output/api.example.com/ -o report.md
```

The report includes:
- Per-domain request statistics
- Authentication-method analysis
- API endpoint documentation (templated paths, e.g. `/restaurants/{id}`)
- Encrypted-parameter detection results
- Frida hook suggestions

### Export

```bash
# Export as cURL commands
python cli.py export output/ -f curl -o requests.sh

# Export as a HAR file
python cli.py export output/ -f har -o capture.har

# Export only a specific domain and method
python cli.py export output/ -f curl --domain api.example.com --method POST
```

### Filter

```bash
# Filter by domain
python cli.py filter output/ --domain api.example.com

# Filter by method + path
python cli.py filter output/ --method POST --path "/api/v2"

# Show only requests with an auth header
python cli.py filter output/ --has-auth -o auth_requests.jsonl

# Filter by status code
python cli.py filter output/ --status 200
```

## Configuration

Edit `config.yaml` to customize:

- **Excluded domains**: by default, noise domains such as googleapis, facebook, and analytics are excluded
- **Whitelisted domains**: set `include_domains` to capture only the listed domains
- **Encryption-detection rules**: suspicious parameter names (sign, token, encrypt, etc.) and value patterns (Base64, MD5, SHA256, JWT)
- **Output settings**: organize directories by domain, maximum body size

## Agent Workflow

### Standard Capture-and-Analyze Flow

1. **Start capture**: `python cli.py start --domain <target>`
2. **Operate the app**: exercise the target app's key features on the phone
3. **Stop capture**: stop with Ctrl+C; a session summary is generated automatically
4. **Generate report**: `python cli.py analyze output/ -o report.md`
5. **Review the report**: read `report.md`, focusing on encrypted parameters and authentication methods
6. **Export to reproduce**: `python cli.py export output/ -f curl` to generate reproducible cURL

### Integration with Other Skills

#### MITM → Frida (tracing encrypted parameters)

When the report detects encrypted parameters:

1. Read the **Frida Hook Suggestions** section of the report
2. Use the `resources/frida_crypto_hooks.js` template
3. Combine with the **frida-hooking** skill to write a targeted hook script
4. Run the Frida hook and the MITM capture together to compare plaintext against ciphertext

#### Full JADX → MITM → Frida → IDA Chain

1. **JADX**: statically analyze to find the network-request classes and encryption methods
2. **MITM**: capture traffic to confirm the actual request format and encrypted parameters
3. **Frida**: hook the encryption methods found in JADX to capture their inputs and outputs
4. **IDA**: if the encryption is in native code, use the Frida offset to analyze the algorithm in IDA

#### MITM → web-api-analyzer Comparison

For platforms that have both an app and a web version:
1. Capture the app's traffic with **mitm-capture**
2. Capture the web version's traffic with **web-api-analyzer**
3. Compare the API differences and encryption-strategy differences between the two

## JSONL Data Format

One JSON object per line:

```json
{
  "timestamp": "2026-02-13T14:00:00.123456",
  "method": "POST",
  "url": "https://api.example.com/v2/search",
  "host": "api.example.com",
  "path": "/v2/search?sign=abc123",
  "request": {
    "headers": {"content-type": "application/json", "authorization": "Bearer xxx"},
    "body": "{\"keyword\": \"test\"}"
  },
  "response": {
    "status_code": 200,
    "headers": {"content-type": "application/json"},
    "body": "{\"results\": [...]}"
  }
}
```

## Troubleshooting

| Issue | Solution |
|------|----------|
| The phone can't connect to the proxy | Confirm the phone and computer are on the same network; check the firewall |
| HTTPS requests show errors | Install the mitmproxy CA certificate on the device; Android 7+ requires a system-level certificate or a Frida-based SSL pinning bypass |
| Some requests aren't captured | Check the exclusion rules in `config.yaml`, or use the `--domain` parameter to specify the target |
| The output directory is empty | Confirm the proxy is configured correctly and the app is making network requests |
