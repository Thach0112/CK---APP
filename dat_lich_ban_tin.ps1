# Dat lich "CK Ban tin sang": 7h00 thu 2 - thu 6 chay CHAY_BAN_TIN.bat (tao ban tin va mo tren trinh duyet).
# Neu luc 7h may dang tat, Windows se chay ngay khi may bat len.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat = Join-Path $dir "CHAY_BAN_TIN.bat"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At "07:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "CK Ban tin sang" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Get-ScheduledTask -TaskName "CK Ban tin sang" | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime | Format-List
