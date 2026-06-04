param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$SupabaseArgs
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env.supabase.local"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env.supabase.local is missing. Add SUPABASE_ACCESS_TOKEN=sbp_..."
}

Get-Content -LiteralPath $envPath -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $parts = $line.Split("=", 2)
  if ($parts.Count -ne 2) {
    return
  }

  [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
}

if (-not $env:SUPABASE_ACCESS_TOKEN -or $env:SUPABASE_ACCESS_TOKEN -notmatch "^sbp_") {
  throw "Invalid SUPABASE_ACCESS_TOKEN in .env.supabase.local. Expected sbp_..."
}

& npx supabase @SupabaseArgs
exit $LASTEXITCODE
