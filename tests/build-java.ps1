#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build-test all Java projects in the repo.
.DESCRIPTION
    Runs mvn compile for each Java project.
    Returns exit code 0 if all pass, 1 if any fail.
.PARAMETER Projects
    Optional array of project directory paths (relative to repo root) to test.
    If omitted, tests all known Java projects.
#>
param(
    [string[]]$Projects
)

$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel).Trim()

$allProjects = @(
    @{ Path = "java/voice-live-quickstarts/ModelQuickstart"; PomFile = "pom.xml" }
    @{ Path = "java/voice-live-quickstarts/MCPQuickstart";   PomFile = "pom.xml" }
    @{ Path = "java/voice-live-quickstarts/AgentsNewQuickstart"; PomFile = "pom-agent.xml" }
    @{ Path = "voice-live-universal-assistant/java";         PomFile = "pom.xml" }
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

    $pomPath = Join-Path $projectDir $project.PomFile
    if (-not (Test-Path $pomPath)) {
        Write-Host "SKIP: $($project.Path) ($($project.PomFile) not found)" -ForegroundColor Yellow
        continue
    }

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Testing: $($project.Path) [mvn -f $($project.PomFile) compile]" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    Push-Location $projectDir
    $success = $true

    try {
        mvn -f $project.PomFile compile -q 2>&1
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
Write-Host "Java Build Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
foreach ($r in $results) {
    $color = if ($r.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host "  $($r.Status): $($r.Project)" -ForegroundColor $color
}
Write-Host "`nTotal: $($results.Count) projects, $failed failed"

exit $failed
