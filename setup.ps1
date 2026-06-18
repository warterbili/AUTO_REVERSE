# setup.ps1 — generate .mcp.json from mcp/mcp.template.json, then run doctor.
# Substitutes ${PYTHON} and ${TOOLS_ROOT} placeholders with this machine's real paths.
# Idempotent; safe to re-run. PowerShell 7+ recommended.
[CmdletBinding()]
param(
    [string]$ToolsRoot,   # override; else $env:AUTO_REVERSE_TOOLS, else <repo>/tools/bin
    [string]$Python,      # override python path; else <repo>/.venv, else python/py on PATH
    [switch]$NoDoctor     # skip the doctor.py checkup
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ── resolve python ────────────────────────────────────────────────
function Resolve-Python {
    param($override, $root)
    if ($override) { return $override }
    $venvWin = Join-Path $root '.venv/Scripts/python.exe'
    $venvNix = Join-Path $root '.venv/bin/python'
    if (Test-Path $venvWin) { return $venvWin }
    if (Test-Path $venvNix) { return $venvNix }
    foreach ($c in @('python', 'python3', 'py')) {
        $cmd = Get-Command $c -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    throw "Python not found. Install it (see tools/INSTALL.md) or pass -Python <path>."
}
$py = Resolve-Python $Python $root

# ── resolve tools root ────────────────────────────────────────────
if (-not $ToolsRoot) {
    if ($env:AUTO_REVERSE_TOOLS) { $ToolsRoot = $env:AUTO_REVERSE_TOOLS }
    else { $ToolsRoot = Join-Path $root 'tools/bin' }
}

# JSON-safe: forward slashes
$pyJson = ($py -replace '\\', '/')
$trJson = ($ToolsRoot -replace '\\', '/')

# ── render template -> .mcp.json ──────────────────────────────────
$tpl = Join-Path $root 'mcp/mcp.template.json'
if (-not (Test-Path $tpl)) { throw "template not found: $tpl" }
$out = (Get-Content $tpl -Raw).Replace('${PYTHON}', $pyJson).Replace('${TOOLS_ROOT}', $trJson)
$target = Join-Path $root '.mcp.json'
Set-Content -Path $target -Value $out -Encoding utf8 -NoNewline
Write-Host "[setup] wrote $target"
Write-Host "[setup]   PYTHON      = $pyJson"
Write-Host "[setup]   TOOLS_ROOT  = $trJson"

# ── verify it parses ──────────────────────────────────────────────
try { Get-Content $target -Raw | ConvertFrom-Json | Out-Null; Write-Host "[setup] .mcp.json is valid JSON" }
catch { throw "generated .mcp.json is not valid JSON: $_" }

# ── doctor ────────────────────────────────────────────────────────
if (-not $NoDoctor) {
    Write-Host "[setup] running doctor.py ..."
    & $py (Join-Path $root 'tools/doctor.py') --missing
}
Write-Host "[setup] done. Next: 'python tools/fetch.py <id>' to pull a tool on demand."
