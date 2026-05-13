# Phase 2 — full bring-up of the timeline-builder repo.
#
# What this does, in order:
#   1. Local Node deps install (npm ci or npm install)
#   2. Local build verification (npm run build → dist/timeline.js)
#   3. git init
#   4. GitHub repo creation (TheJayLance/timeline-builder, public)
#   5. Initial commit + push
#   6. Enable GitHub Pages (source: GitHub Actions)
#   7. Wait for the first Actions run, report the published URL
#
# Prerequisites: git, Node 22+, npm, GitHub CLI (gh) all installed and on PATH.
# If `gh` isn't logged in, the script will prompt for browser auth once.
#
# Idempotent: re-running is safe. Steps already done are skipped.
#
# Mirrors C:\jeff-data\canon-public\.scripts\phase1-bringup.ps1.

$ErrorActionPreference = "Stop"

$RepoRoot   = "C:\jeff-data\timeline-builder"
$GhUser     = "TheJayLance"
$GhRepo     = "timeline-builder"
$RemoteUrl  = "https://github.com/$GhUser/$GhRepo.git"

function Section($title) {
    Write-Host ""
    Write-Host "═══ $title ═══" -ForegroundColor Cyan
}

# ----------------------------------------------------------------------------
# 1. Install Node deps
# ----------------------------------------------------------------------------
Section "1/7 Installing Node dependencies"

Set-Location $RepoRoot

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    throw "Node.js not found on PATH. Install Node 22+ and re-run."
}
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    throw "npm not found on PATH. Install Node/npm and re-run."
}

$nodeVer = (node --version)
Write-Host "  node: $nodeVer"

if (Test-Path "$RepoRoot\package-lock.json") {
    Write-Host "  Running npm ci..."
    npm ci
} else {
    Write-Host "  Running npm install (no lockfile yet)..."
    npm install
}
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

# ----------------------------------------------------------------------------
# 2. Local build verification
# ----------------------------------------------------------------------------
Section "2/7 Verifying local build"

Write-Host "  Running npm run build..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "Local build failed" }

if (-not (Test-Path "$RepoRoot\dist\timeline.js")) {
    throw "Local build succeeded but dist/timeline.js not produced"
}
$bundleSize = (Get-Item "$RepoRoot\dist\timeline.js").Length
$bundleKB = [math]::Round($bundleSize / 1024, 1)
Write-Host "  Local build OK. timeline.js size: $bundleKB KB" -ForegroundColor Green
if ($bundleSize -gt 200000) {
    Write-Warning "Bundle is larger than 200KB unminified. Check the build output before pushing."
}

# ----------------------------------------------------------------------------
# 3. git init
# ----------------------------------------------------------------------------
Section "3/7 Initializing git"

if (-not (Test-Path "$RepoRoot\.git")) {
    git init -b main | Out-Null
    git config user.email "claude-desktop@falken.local"
    git config user.name  "Claude Desktop"
    Write-Host "  git initialized on main branch"
} else {
    Write-Host "  git already initialized, skipping"
}

# ----------------------------------------------------------------------------
# 4. Check gh CLI auth, create remote repo
# ----------------------------------------------------------------------------
Section "4/7 GitHub repo creation"

$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCmd) {
    throw "GitHub CLI (gh) not found on PATH. Install from https://cli.github.com and re-run."
}

$prevErrAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
gh auth status *> $null
$authExitCode = $LASTEXITCODE
$ErrorActionPreference = $prevErrAction

if ($authExitCode -ne 0) {
    Write-Host "  gh is not authenticated. Launching browser login..." -ForegroundColor Yellow
    gh auth login --web --git-protocol https
    if ($LASTEXITCODE -ne 0) {
        throw "gh auth login failed. Re-run the script after authenticating."
    }
}

$ErrorActionPreference = "Continue"
gh repo view "$GhUser/$GhRepo" *> $null
$repoViewExitCode = $LASTEXITCODE
$ErrorActionPreference = $prevErrAction

if ($repoViewExitCode -eq 0) {
    Write-Host "  Remote repo $GhUser/$GhRepo already exists, skipping creation"
} else {
    Write-Host "  Creating $GhUser/$GhRepo (public)..."
    gh repo create "$GhUser/$GhRepo" --public --description "Embeddable web component wrapper for the parallel-tracks timeline library. Publishes timeline.js to GitHub Pages." | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "gh repo create failed."
    }
}

$ErrorActionPreference = "Continue"
$existingRemote = git remote get-url origin 2>$null
$remoteExitCode = $LASTEXITCODE
$ErrorActionPreference = $prevErrAction

if ($remoteExitCode -ne 0) {
    git remote add origin $RemoteUrl
    Write-Host "  Added remote origin → $RemoteUrl"
} else {
    git remote set-url origin $RemoteUrl
    Write-Host "  Remote origin already configured"
}

# ----------------------------------------------------------------------------
# 5. Initial commit and push
# ----------------------------------------------------------------------------
Section "5/7 Commit and push"

git add -A
$staged = git diff --cached --name-only
if ([string]::IsNullOrWhiteSpace($staged)) {
    Write-Host "  Nothing to commit"
} else {
    git commit -m "Initial timeline-builder bring-up: <jeff-timeline> web component v1"
    Write-Host "  Pushing to origin/main..."
    git push -u origin main
}

# ----------------------------------------------------------------------------
# 6. Enable GitHub Pages
# ----------------------------------------------------------------------------
Section "6/7 Enabling GitHub Pages"

gh api -X POST "repos/$GhUser/$GhRepo/pages" `
    -H "Accept: application/vnd.github+json" `
    -f build_type=workflow 2>&1 | Out-Null
$postExit = $LASTEXITCODE

if ($postExit -ne 0) {
    gh api -X PUT "repos/$GhUser/$GhRepo/pages" `
        -H "Accept: application/vnd.github+json" `
        -f build_type=workflow 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not enable Pages programmatically. Enable manually at https://github.com/$GhUser/$GhRepo/settings/pages (set source to GitHub Actions)."
    } else {
        Write-Host "  Pages updated to use GitHub Actions source"
    }
} else {
    Write-Host "  Pages enabled, source: GitHub Actions"
}

# ----------------------------------------------------------------------------
# 7. Wait for the first workflow run
# ----------------------------------------------------------------------------
Section "7/7 Awaiting first build"

Write-Host "  Waiting up to 5 minutes for the Pages build to complete..."
$maxWait = 300
$elapsed = 0
$success = $false
while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds 10
    $elapsed += 10
    $runs = gh run list --repo "$GhUser/$GhRepo" --workflow "publish.yml" --limit 1 --json status,conclusion,url 2>$null | ConvertFrom-Json
    if ($runs -and $runs.Count -gt 0) {
        $run = $runs[0]
        if ($run.status -eq "completed") {
            if ($run.conclusion -eq "success") {
                $success = $true
                Write-Host "  Build succeeded after ${elapsed}s" -ForegroundColor Green
            } else {
                Write-Warning "Build failed: $($run.url)"
            }
            break
        }
        Write-Host "  ...still running (${elapsed}s elapsed, status: $($run.status))"
    }
}

if (-not $success -and $elapsed -ge $maxWait) {
    Write-Warning "Did not see a completed run within 5 minutes. Check https://github.com/$GhUser/$GhRepo/actions"
}

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
Write-Host ""
Write-Host "═════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "Phase 2 bring-up COMPLETE" -ForegroundColor Green
Write-Host "═════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Repo:           https://github.com/$GhUser/$GhRepo"
Write-Host "Live demo:      https://$($GhUser.ToLower()).github.io/$GhRepo/v1/"
Write-Host "Bundle URL:     https://$($GhUser.ToLower()).github.io/$GhRepo/v1/timeline.js"
Write-Host ""
if ($success) {
    Write-Host "Open the live demo URL in a browser. You should see the career map" -ForegroundColor Cyan
    Write-Host "rendered against the live canon. If it works, Step 1b is complete." -ForegroundColor Cyan
}
