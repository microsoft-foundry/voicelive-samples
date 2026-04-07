#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build-test all projects across JavaScript, Java, and C#.
.DESCRIPTION
    Orchestrates build tests for all sample projects in the repo.
    Useful for validating dependency updates (e.g., dependabot PRs).
.PARAMETER Language
    Optional filter: "javascript", "java", "csharp", or "all" (default).
.PARAMETER Projects
    Optional array of specific project paths to test (passed through to per-language scripts).
.EXAMPLE
    ./tests/build-all.ps1
    ./tests/build-all.ps1 -Language javascript
    ./tests/build-all.ps1 -Projects @("javascript/voice-live-avatar", "csharp/voice-live-quickstarts/AgentsNewQuickstart")
#>
param(
    [ValidateSet("all", "javascript", "java", "csharp")]
    [string]$Language = "all",

    [string[]]$Projects
)

$ErrorActionPreference = "Continue"
$scriptDir = $PSScriptRoot
$totalFailed = 0

function Invoke-BuildScript {
    param([string]$ScriptName, [string[]]$ProjectFilter)

    $scriptPath = Join-Path $scriptDir $ScriptName
    if (-not (Test-Path $scriptPath)) {
        Write-Host "ERROR: Script not found: $scriptPath" -ForegroundColor Red
        return 1
    }

    if ($ProjectFilter) {
        & $scriptPath -Projects $ProjectFilter
    }
    else {
        & $scriptPath
    }
    return $LASTEXITCODE
}

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "Build All - Dependency Validation" -ForegroundColor Magenta
Write-Host "Language: $Language" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

if ($Language -in @("all", "javascript")) {
    $totalFailed += (Invoke-BuildScript "build-javascript.ps1" $Projects)
}

if ($Language -in @("all", "java")) {
    $totalFailed += (Invoke-BuildScript "build-java.ps1" $Projects)
}

if ($Language -in @("all", "csharp")) {
    $totalFailed += (Invoke-BuildScript "build-csharp.ps1" $Projects)
}

Write-Host "`n========================================" -ForegroundColor Magenta
if ($totalFailed -eq 0) {
    Write-Host "ALL BUILDS PASSED" -ForegroundColor Green
}
else {
    Write-Host "BUILDS FAILED: $totalFailed project(s)" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Magenta

exit $totalFailed
