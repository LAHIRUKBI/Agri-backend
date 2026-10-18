
# ==========================================================
# Smart Agriculture Support System
# Start Python ML API + Node.js Backend in One Terminal
# ==========================================================

$ErrorActionPreference = "Stop"

$backendDir = "G:\Agri\Agri-backend"
$modelDir   = Join-Path $backendDir "model"
$pythonExe  = Join-Path $modelDir "venv\Scripts\python.exe"

$apiUrl     = "http://127.0.0.1:8000"
$healthUrl  = "$apiUrl/openapi.json"
$marketUrl  = "$apiUrl/market"

$logDir     = Join-Path $modelDir "logs"
$stdoutLog  = Join-Path $logDir "ml-api.log"
$stderrLog  = Join-Path $logDir "ml-api-error.log"

$pythonProcess = $null
$dnsBootstrap  = Join-Path $env:TEMP "agri-dns-bootstrap.cjs"
$oldNodeOptions = $env:NODE_OPTIONS
$oldMLApiUrl = $env:ML_API_URL

try {
    # ------------------------------------------------------
    # 1. Validate required files
    # ------------------------------------------------------

    if (-not (Test-Path (Join-Path $backendDir "server.js"))) {
        throw "Node.js server.js was not found: $backendDir"
    }

    if (-not (Test-Path (Join-Path $backendDir "package.json"))) {
        throw "package.json was not found: $backendDir"
    }

    if (-not (Test-Path (Join-Path $modelDir "app.py"))) {
        throw "Python app.py was not found: $modelDir"
    }

    if (-not (Test-Path $pythonExe)) {
        throw "Python virtual environment not found: $pythonExe"
    }

    # ------------------------------------------------------
    # 2. Configure environment variables
    # ------------------------------------------------------

    $env:ML_API_URL = $marketUrl

# Fix Unicode / emoji output on Windows
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

    New-Item -ItemType Directory -Path $logDir -Force |
        Out-Null

    Set-Location -LiteralPath $backendDir

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host " Smart Agriculture Support System" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Cyan

    # ------------------------------------------------------
    # 3. Configure DNS for Node.js processes
    # ------------------------------------------------------

    @'
const dns = require("node:dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

console.log("[Agri] DNS servers:", dns.getServers());
'@ | Set-Content -LiteralPath $dnsBootstrap -Encoding utf8

# Use forward slashes to prevent Windows path parsing issues.
$dnsBootstrapForNode = $dnsBootstrap -replace '\\', '/'

$env:NODE_OPTIONS = "--require=$dnsBootstrapForNode"

    # ------------------------------------------------------
    # 4. Check whether Python ML API is already running
    # ------------------------------------------------------

    $apiReady = $false

    try {
        $response = Invoke-RestMethod `
            -Uri $healthUrl `
            -TimeoutSec 3

        if ($response.openapi) {
            $apiReady = $true
            Write-Host "[OK] Python ML API is already running." `
                -ForegroundColor Green
        }
    }
    catch {
        # No API response; start our Python API below.
    }

    # ------------------------------------------------------
    # 5. Start Python ML API without another terminal
    # ------------------------------------------------------

    if (-not $apiReady) {

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host " STARTING PYTHON ML MODELS" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""

    $pythonProcess = Start-Process `
        -FilePath $pythonExe `
        -ArgumentList @(
            "-u",
            "-m",
            "uvicorn",
            "app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000"
        ) `
        -WorkingDirectory $modelDir `
        -PassThru `
        -NoNewWindow

    # Wait for FastAPI to become ready
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $timeoutSeconds = 120

    while ($timer.Elapsed.TotalSeconds -lt $timeoutSeconds) {

        if ($pythonProcess.HasExited) {
            throw "Python ML API exited unexpectedly. Check the Python errors displayed above."
        }

        try {
            $response = Invoke-RestMethod `
                -Uri $healthUrl `
                -TimeoutSec 3

            if ($response.openapi) {
                $apiReady = $true
                break
            }
        }
        catch {
            # Python models are still loading.
        }

        Start-Sleep -Seconds 2
    }

    if (-not $apiReady) {
        throw "Python ML API did not become ready within $timeoutSeconds seconds."
    }

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "[OK] ALL PYTHON STARTUP CHECKS PASSED" -ForegroundColor Green
    Write-Host "[OK] FastAPI: $apiUrl" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
}

    # ------------------------------------------------------
    # 6. Start Node.js backend in this same terminal
    # ------------------------------------------------------

    Write-Host ""
    Write-Host "Starting Node.js backend..." -ForegroundColor Cyan
    Write-Host "ML_API_URL: $env:ML_API_URL" -ForegroundColor Gray
    Write-Host "Backend: http://localhost:5000" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Press Ctrl+C to stop the development server." `
        -ForegroundColor Yellow
    Write-Host ""

    & npm.cmd run dev

    if ($LASTEXITCODE -ne 0) {
        throw "Node.js backend exited with code $LASTEXITCODE"
    }
}
catch {
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red

    if (Test-Path $stderrLog) {
        Write-Host ""
        Write-Host "Python error log: $stderrLog" -ForegroundColor Yellow
        Get-Content -LiteralPath $stderrLog -Tail 30
    }

    throw
}
finally {
    # Stop the Python API started by this script.
    # Do not stop an API that was already running before startup.

    if ($null -ne $pythonProcess) {
        if (-not $pythonProcess.HasExited) {
            Write-Host ""
            Write-Host "Stopping Python ML API..." -ForegroundColor Cyan

            & taskkill.exe /PID $pythonProcess.Id /T /F 2>$null |
                Out-Null
        }
    }

    # Restore the original environment variables.
    $env:ML_API_URL = $oldMLApiUrl
    $env:NODE_OPTIONS = $oldNodeOptions

    Remove-Item -LiteralPath $dnsBootstrap `
        -Force -ErrorAction SilentlyContinue

    Write-Host "Agri startup script finished." -ForegroundColor Gray
}
