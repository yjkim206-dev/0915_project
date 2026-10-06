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

if (-not $env:SUPABASE_ACCESS_TOKEN) { throw 'SUPABASE_ACCESS_TOKEN이 .env에 없습니다.' }
if (-not $env:SUPABASE_PROJECT_REF) { throw 'SUPABASE_PROJECT_REF가 .env에 없습니다.' }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) { throw 'SUPABASE_SERVICE_ROLE_KEY가 .env에 없습니다.' }

Set-Location (Join-Path $projectRoot 'backend')
supabase link --project-ref $env:SUPABASE_PROJECT_REF
supabase db push
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=$env:SUPABASE_SERVICE_ROLE_KEY
supabase functions deploy api

Write-Host 'Supabase migration과 api Edge Function 배포가 완료되었습니다.'
