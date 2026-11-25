#Requires -Version 5.1
<#
.SYNOPSIS
  Upload local Apple signing materials from 密钥/ into GitHub Actions secrets via gh.
#>
param(
    [string]$Repo = "guanyue91141/cimbar-qr-IOS-WEB",
    [string]$KeysDir = ""
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    $here = Split-Path -Parent $PSScriptRoot
    return (Resolve-Path (Join-Path $here "..")).Path
}

$root = Get-RepoRoot
if (-not $KeysDir) {
    $KeysDir = Join-Path $root "密钥"
}
$KeysDir = (Resolve-Path $KeysDir).Path

$pwdFile = Join-Path $KeysDir "p12.密码"
if (-not (Test-Path $pwdFile)) {
    throw "Missing $pwdFile"
}

$meta = @{}
Get-Content -LiteralPath $pwdFile | ForEach-Object {
    if ($_ -match '^\s*([^=]+)=(.*)$') {
        $meta[$Matches[1].Trim()] = $Matches[2].Trim()
    }
}

$p12Password = $meta["P12KEY"]
if (-not $p12Password) { throw "P12KEY missing in p12.密码" }

$distP12Name = if ($meta["DIST_P12"]) { $meta["DIST_P12"] } else { "apple-distribution.p12" }
$distP12 = Join-Path $KeysDir $distP12Name
$appStoreProfile = Join-Path $KeysDir "cn.guanyue.face.ios.appstore.mobileprovision"
$devProfile = Join-Path $KeysDir "cn.guanyue.face.ios.development.mobileprovision"
$devP12 = Join-Path $KeysDir "apple.p12"

foreach ($required in @($distP12, $appStoreProfile)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing required file: $required"
    }
}

function Set-GhSecretFromFile {
    param(
        [string]$Name,
        [string]$Path
    )
    Write-Host "-> gh secret set $Name (from $(Split-Path -Leaf $Path))"
    # Pipe raw bytes as base64 text for portability in Actions
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $b64 = [Convert]::ToBase64String($bytes)
    $b64 | gh secret set $Name -R $Repo
}

function Set-GhSecretValue {
    param(
        [string]$Name,
        [string]$Value
    )
    Write-Host "-> gh secret set $Name"
    $Value | gh secret set $Name -R $Repo
}

Write-Host "Repo: $Repo"
Write-Host "Keys: $KeysDir"

Set-GhSecretFromFile -Name "IOS_DISTRIBUTION_P12_BASE64" -Path $distP12
Set-GhSecretFromFile -Name "IOS_APPSTORE_PROVISION_BASE64" -Path $appStoreProfile
Set-GhSecretValue -Name "IOS_P12_PASSWORD" -Value $p12Password
Set-GhSecretValue -Name "IOS_KEYCHAIN_PASSWORD" -Value ("face-" + [guid]::NewGuid().ToString("N").Substring(0, 16))

if (Test-Path -LiteralPath $devProfile) {
    Set-GhSecretFromFile -Name "IOS_DEVELOPMENT_PROVISION_BASE64" -Path $devProfile
} else {
    Write-Warning "Development profile not found; development export will be unavailable."
}

if (Test-Path -LiteralPath $devP12) {
    Write-Host "Note: apple.p12 present, but password may differ from P12KEY."
    Write-Host "If you know the development .p12 password, set:"
    Write-Host "  [Convert]::ToBase64String([IO.File]::ReadAllBytes('$devP12')) | gh secret set IOS_DEVELOPMENT_P12_BASE64 -R $Repo"
} else {
    Write-Warning "Development p12 not found."
}

Write-Host ""
Write-Host "Done. List secrets:"
gh secret list -R $Repo
Write-Host ""
Write-Host "Next: .\scripts\ios\build-ipa.ps1"
