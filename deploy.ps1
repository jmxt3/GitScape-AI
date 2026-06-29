# deploy.ps1
# Runs Cloud Build for the /api and /web services.
# Usage:
#   .\deploy.ps1              — deploy both API and Web
#   .\deploy.ps1 -Target f   — deploy Web (frontend) only
#   .\deploy.ps1 -Target b   — deploy API (backend) only

param (
    [ValidateSet("f", "b", "")]
    [string]$Target = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Deploy-Service {
    param (
        [string]$ServiceName,
        [string]$ServicePath
    )

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Deploying: $ServiceName" -ForegroundColor Cyan
    Write-Host "  Path:      $ServicePath" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    if (-not (Test-Path $ServicePath)) {
        Write-Host "[ERROR] Directory not found: $ServicePath" -ForegroundColor Red
        exit 1
    }

    Push-Location $ServicePath
    try {
        gcloud beta builds submit --config cloudbuild.yaml .
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] Cloud Build failed for $ServiceName (exit code $LASTEXITCODE)" -ForegroundColor Red
            exit $LASTEXITCODE
        }
        Write-Host "[OK] $ServiceName deployed successfully." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

$deployApi = $Target -eq "" -or $Target -eq "b"
$deployWeb = $Target -eq "" -or $Target -eq "f"

if (-not $deployApi -and -not $deployWeb) {
    Write-Host "[ERROR] Invalid -Target value. Use 'f' for frontend, 'b' for backend, or omit for both." -ForegroundColor Red
    exit 1
}

if ($deployApi)  { Deploy-Service -ServiceName "API" -ServicePath (Join-Path $ScriptDir "api") }
if ($deployWeb)  { Deploy-Service -ServiceName "Web" -ServicePath (Join-Path $ScriptDir "web") }

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All selected services deployed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
