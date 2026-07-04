$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Step 1/3: Installing dependencies ===" -ForegroundColor Cyan
pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

Write-Host "`n=== Step 2/3: Building ===" -ForegroundColor Cyan
pnpm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "`n=== Step 3/3: Packaging Windows executable ===" -ForegroundColor Cyan
npx electron-builder --win --x64
if ($LASTEXITCODE -ne 0) { throw "packaging failed" }

Write-Host "`n=== Done! Check .\release\win-unpacked\ ===" -ForegroundColor Green
Get-ChildItem release\win-unpacked\*.exe
