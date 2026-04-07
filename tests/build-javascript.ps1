#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build-test all JavaScript/TypeScript projects in the repo.
.DESCRIPTION
    Runs npm ci && npm run build (or node --check for standalone scripts) for each JS project.
    Returns exit code 0 if all pass, 1 if any fail.
.PARAMETER Projects
    Optional array of project directory paths (relative to repo root) to test.
    If omitted, tests all known JS projects.
#>
param(
    [string[]]$Projects
)

$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel).Trim()

# All known JS projects with their build strategies
$allProjects = @(
    @{ Path = "javascript/basic-web-voice-assistant";                  Strategy = "npm-build" }
    @{ Path = "javascript/voice-live-avatar";                          Strategy = "npm-build" }
    @{ Path = "javascript/voice-live-car-demo";                        Strategy = "npm-build" }
    @{ Path = "javascript/voice-live-interpreter-demo";                Strategy = "npm-build" }
    @{ Path = "javascript/voice-live-trader-demo";                     Strategy = "npm-build" }
    @{ Path = "voice-live-universal-assistant/frontend";               Strategy = "npm-build" }
    @{ Path = "javascript/voice-live-quickstarts/AgentsNewQuickstart"; Strategy = "node-check"; Files = @("voice-live-with-agent-v2.js", "create-agent-with-voicelive.js") }
    @{ Path = "javascript/voice-live-quickstarts/ModelQuickstart";     Strategy = "node-check"; Files = @("model-quickstart.js") }
    @{ Path = "javascript/voice-live-quickstarts/MCPQuickstart";       Strategy = "node-check"; Files = @("mcp-quickstart.js") }
    @{ Path = "voice-live-universal-assistant/javascript";             Strategy = "npm-ci-only" }
)

# Filter to requested projects if specified
if ($Projects) {
    $allProjects = $allProjects | Where-Object { $Projects -contains $_.Path }
}

$results = @()
$failed = 0

foreach ($project in $allProjects) {
    $projectDir = Join-Path $repoRoot $project.Path
    if (-not (Test-Path $projectDir)) {
        Write-Host "SKIP: $($project.Path) (directory not found)" -ForegroundColor Yellow
        continue
    }

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Testing: $($project.Path) [$($project.Strategy)]" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    Push-Location $projectDir
    $success = $true

    try {
        # Use npm ci if lockfile exists, otherwise fall back to npm install
        function Invoke-NpmInstall {
            if (Test-Path "package-lock.json") {
                Write-Host "Running: npm ci" -ForegroundColor DarkGray
                npm ci --loglevel=error 2>&1
            } else {
                Write-Host "Running: npm install (no lockfile)" -ForegroundColor DarkGray
                npm install --loglevel=error 2>&1
            }
        }

        switch ($project.Strategy) {
            "npm-build" {
                Invoke-NpmInstall
                if ($LASTEXITCODE -ne 0) { $success = $false; break }

                Write-Host "Running: npm run build" -ForegroundColor DarkGray
                npm run build 2>&1
                if ($LASTEXITCODE -ne 0) { $success = $false }
            }
            "node-check" {
                if (Test-Path "package.json") {
                    Invoke-NpmInstall
                    if ($LASTEXITCODE -ne 0) { $success = $false; break }
                }
                foreach ($file in $project.Files) {
                    if (Test-Path $file) {
                        Write-Host "Running: node --check $file" -ForegroundColor DarkGray
                        node --check $file 2>&1
                        if ($LASTEXITCODE -ne 0) { $success = $false }
                    }
                }
            }
            "npm-ci-only" {
                Invoke-NpmInstall
                if ($LASTEXITCODE -ne 0) { $success = $false }
            }
        }
    }
    catch {
        $success = $false
        Write-Host "ERROR: $_" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }

    if ($success) {
        Write-Host "PASS: $($project.Path)" -ForegroundColor Green
        $results += @{ Project = $project.Path; Status = "PASS" }
    }
    else {
        Write-Host "FAIL: $($project.Path)" -ForegroundColor Red
        $results += @{ Project = $project.Path; Status = "FAIL" }
        $failed++
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "JavaScript Build Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
foreach ($r in $results) {
    $color = if ($r.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host "  $($r.Status): $($r.Project)" -ForegroundColor $color
}
Write-Host "`nTotal: $($results.Count) projects, $failed failed"

exit $failed
