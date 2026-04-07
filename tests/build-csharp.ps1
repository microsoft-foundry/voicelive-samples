#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build-test all C# projects in the repo.
.DESCRIPTION
    Runs dotnet build for each C# project.
    Returns exit code 0 if all pass, 1 if any fail.
.PARAMETER Projects
    Optional array of project directory paths (relative to repo root) to test.
    If omitted, tests all known C# projects.
#>
param(
    [string[]]$Projects
)

$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel).Trim()

$allProjects = @(
    @{ Path = "csharp/CustomerServiceBot";                              CsProj = "CustomerServiceBot.csproj" }
    @{ Path = "csharp/voice-live-quickstarts/ModelQuickstart";          CsProj = "csharp.csproj" }
    @{ Path = "csharp/voice-live-quickstarts/MCPQuickstart";            CsProj = "MCPQuickstart.csproj" }
    @{ Path = "csharp/voice-live-quickstarts/AgentsNewQuickstart";      CsProj = "VoiceLiveWithAgent.csproj" }
    @{ Path = "csharp/voice-live-quickstarts/BringYourOwnModelQuickstart"; CsProj = "csharp.csproj" }
    @{ Path = "csharp/voice-live-quickstarts/AgentQuickstart";          CsProj = "csharp.csproj" }
    @{ Path = "voice-live-universal-assistant/csharp";                   CsProj = "VoiceLiveWebApp.csproj" }
)

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

    $csprojPath = Join-Path $projectDir $project.CsProj
    if (-not (Test-Path $csprojPath)) {
        Write-Host "SKIP: $($project.Path) ($($project.CsProj) not found)" -ForegroundColor Yellow
        continue
    }

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Testing: $($project.Path) [dotnet build $($project.CsProj)]" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    Push-Location $projectDir
    $success = $true

    try {
        dotnet build $project.CsProj --verbosity quiet --nologo 2>&1
        if ($LASTEXITCODE -ne 0) { $success = $false }
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
Write-Host "C# Build Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
foreach ($r in $results) {
    $color = if ($r.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host "  $($r.Status): $($r.Project)" -ForegroundColor $color
}
Write-Host "`nTotal: $($results.Count) projects, $failed failed"

exit $failed
