$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw '프로젝트 루트에 .env 파일을 만들고 토큰을 입력하세요.' }

Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    $key = $matches[1].Trim()
    $value = $matches[2].Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
  }
}

# Preserve compatibility with an existing backend/.env while the project-wide
# .env is being adopted. Project-root values always take precedence.
$backendEnvFile = Join-Path $projectRoot 'backend\.env'
if (Test-Path -LiteralPath $backendEnvFile) {
  Get-Content -LiteralPath $backendEnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
      $key = $matches[1].Trim()
      $value = $matches[2].Trim().Trim('"').Trim("'")
      if ($key -eq 'ADMIN _NAME') { $key = 'ADMIN_NAME' }
      if ($key -in @('ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD') -and -not [Environment]::GetEnvironmentVariable($key, 'Process')) {
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
      }
    }
  }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) { throw 'SUPABASE_ACCESS_TOKEN이 .env에 없습니다.' }
if (-not $env:SUPABASE_PROJECT_REF) { throw 'SUPABASE_PROJECT_REF가 .env에 없습니다.' }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) { throw 'SUPABASE_SERVICE_ROLE_KEY가 .env에 없습니다.' }

Set-Location (Join-Path $projectRoot 'backend')
if ($env:ADMIN_NAME -and $env:ADMIN_EMAIL -and $env:ADMIN_PASSWORD) {
  npx.cmd supabase secrets set "ADMIN_NAME=$env:ADMIN_NAME" "ADMIN_EMAIL=$env:ADMIN_EMAIL" "ADMIN_PASSWORD=$env:ADMIN_PASSWORD"
} else {
  Write-Warning 'ADMIN_* values are absent; existing remote administrator secrets are unchanged.'
}
npx.cmd supabase link --project-ref $env:SUPABASE_PROJECT_REF
npx.cmd supabase db push
npx.cmd supabase functions deploy api

Write-Host 'Supabase migration과 api Edge Function 배포가 완료되었습니다.'
