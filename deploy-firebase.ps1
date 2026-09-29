# GraceGuide — deploy the push-notification server (Cloud Functions only).
#
# What this turns on:
#   * Chat, Forum, comment, Amen and Brethren notifications pop up on phones
#     instantly, even when GraceGuide is closed (sendPushOnNotification).
#   * Admin notifications pop up without the admin page asking for a Google
#     sign-in (the server sends them).
#   * The evening "time to read" reminder for website users.
#
# Before running: the Firebase project must be on the Blaze (pay-as-you-go)
# plan — Firebase console > (gear) > Usage and billing > Modify plan. Cloud
# Functions need it; GraceGuide's traffic stays inside the free monthly
# allowance (2 million function calls), so it normally costs nothing. You can
# set a budget alert there too.
#
# Run from this folder in PowerShell:   .\deploy-firebase.ps1
# A browser window opens once to sign in to the Google account that owns the project.

$ErrorActionPreference = "Stop"
$project = "graceguide-8d9f5"
Set-Location $PSScriptRoot

Write-Host "`n1/4  Installing the server's packages..." -ForegroundColor Cyan
Push-Location functions
npm install --no-audit --no-fund
Pop-Location

Write-Host "`n2/4  Signing in to Firebase (a browser window opens if needed)..." -ForegroundColor Cyan
npx -y firebase-tools@latest login

Write-Host "`n3/4  Deploying the push server..." -ForegroundColor Cyan
# Functions ONLY. database.rules.json in this folder is NOT the live ruleset (it lacks rules for chats,
# /tokens and cross-user notifications) — publishing it would break Chats, Shepherd and the Bible.
npx -y firebase-tools@latest deploy --only functions --project $project

Write-Host "`n4/4  Telling the admin page the server now sends pop-ups..." -ForegroundColor Cyan
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
npx -y firebase-tools@latest database:set /appConfig/serverPushLastSeen --data "$now" --force --project $project

Write-Host "`nDone. Chats and admin notifications now pop up on phones, and the admin page no longer asks for a Google sign-in." -ForegroundColor Green
