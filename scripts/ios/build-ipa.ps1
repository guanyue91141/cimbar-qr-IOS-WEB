#Requires -Version 5.1
<#
.SYNOPSIS
  Trigger ios-ipa GitHub Actions workflow via gh, wait, and download signed IPA.
#>
param(
    [string]$Repo = "guanyue91141/cimbar-qr-IOS-WEB",
    [ValidateSet("app-store", "development")]
    [string]$ExportMethod = "app-store",
    [string]$BuildNumber = "",
    [string]$OutDir = "",
    [string]$Ref = "master",
    [switch]$SkipWatch
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    $here = Split-Path -Parent $PSScriptRoot
    return (Resolve-Path (Join-Path $here "..")).Path
}

$root = Get-RepoRoot
if (-not $OutDir) {
    $OutDir = Join-Path $root "dist\ios"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Trigger workflow ios-ipa.yml on $Repo@$Ref method=$ExportMethod"

$args = @(
    "workflow", "run", "ios-ipa.yml",
    "-R", $Repo,
    "--ref", $Ref,
    "-f", "export_method=$ExportMethod"
)
if ($BuildNumber) {
    $args += @("-f", "build_number=$BuildNumber")
}

& gh @args
if ($LASTEXITCODE -ne 0) { throw "gh workflow run failed" }

Start-Sleep -Seconds 3

$runJson = gh run list -R $Repo --workflow ios-ipa.yml --limit 1 --json databaseId,status,conclusion,url,createdAt,headBranch
$run = ($runJson | ConvertFrom-Json)[0]
if (-not $run) { throw "No workflow run found" }

$runId = $run.databaseId
Write-Host "Run: $($run.url) (id=$runId)"

if (-not $SkipWatch) {
    gh run watch $runId -R $Repo --exit-status
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed. Logs:"
        gh run view $runId -R $Repo --log-failed
        throw "ios-ipa workflow failed"
    }
}

Write-Host "Download artifact FaceNative-ipa -> $OutDir"
gh run download $runId -R $Repo -n FaceNative-ipa -D $OutDir
if ($LASTEXITCODE -ne 0) { throw "gh run download failed" }

Get-ChildItem -LiteralPath $OutDir -Filter *.ipa -Recurse | ForEach-Object {
    Write-Host "IPA: $($_.FullName) ($([math]::Round($_.Length/1MB, 2)) MB)"
}
