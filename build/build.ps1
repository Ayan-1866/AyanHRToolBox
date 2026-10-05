# Rebuilds loi.html, experience.html, relieving.html and the dashboard index.html from the sources in this folder.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File build\build.ps1
$ErrorActionPreference='Stop'
$sp=$PSScriptRoot
$code=Split-Path $sp -Parent
$u8=New-Object Text.UTF8Encoding $false
$read={param($p)[IO.File]::ReadAllText($p,$u8)}

# pieces reused from the Appointment Letter tool
$appt=& $read "$code\appointment-letter.html"
$lines=$appt -split "`n"
$jszip=($lines[6..18] -join "`n").TrimEnd("`r")
if(-not $jszip.StartsWith('<script>') -or -not $jszip.EndsWith('</script>')){throw "JSZip block not where expected"}
$sel={param($id)$m=[regex]::Match($appt,"<select id=`"$id`">(.*?)</select>",[Text.RegularExpressions.RegexOptions]::Singleline);if(-not $m.Success){throw "$id list not found"};$m.Groups[1].Value}
$foots=([regex]::Match($appt,'(?m)^const FOOTS=(\[.*\]);')).Groups[1].Value
if(-not $foots){throw "Company footer list not found"}
$model=& $read "$sp\loi-model.js"
$logo=[Convert]::ToBase64String([IO.File]::ReadAllBytes("$sp\logo.png"))
# Department dropdown: one per line in departments.txt
$depts=((& $read "$sp\departments.txt") -split "\r?\n" | Where-Object { $_.Trim() } | ForEach-Object { "<option>"+[Net.WebUtility]::HtmlEncode($_.Trim())+"</option>" }) -join ""

# LOI Generator
$src=& $read "$sp\loi.src.html"
$loi=$src.Replace('__DESIG__',(& $sel 'DESIG')).Replace('__LOI_MODEL__',$model).Replace('__JSZIP__',$jszip)
[IO.File]::WriteAllText("$code\loi.html",$loi,$u8)

# Experience Letter and Relieving Letter (one source, two pages)
$src=& $read "$sp\exit.src.html"
foreach($mode in @(@("exp","Experience Letter","experience.html"),@("rel","Relieving Letter","relieving.html"))){
  $page=$src.Replace("__MODE__",$mode[0]).Replace("__TITLE__",$mode[1]).Replace("__DESIG__",(& $sel "DESIG")).Replace("__FOOTS__",$foots).Replace("__LOGO__",$logo).Replace("__DEPTS__",$depts)
  [IO.File]::WriteAllText("$code\$($mode[2])",$page,$u8)
}

# CV Inbox (needs to be served from https://employees.alcoverealty.in for Google sign-in)
$clientId="806459433972-nu3ab2cje78au731potll9bfu8pdv0pb.apps.googleusercontent.com"
# Google accounts allowed to open the portal (the sign-in screen on the website)
$portalUsers=@("hr@alcoverealty.in")
$allowedJson=ConvertTo-Json -Compress -InputObject @($portalUsers | ForEach-Object { $_.ToLower() })
# Login codes emailed to HR: the Google Apps Script Web app URL (see server\google-apps-script\SETUP.md).
# Leave the file out to keep the plain "allowed Google accounts only" sign-in.
$otpApi=""; if(Test-Path "$sp\otp-api.txt"){ $otpApi=(& $read "$sp\otp-api.txt").Trim() }
if($otpApi -and $otpApi -notmatch '^https://script\.google\.com/macros/s/[\w-]+/exec$'){ throw "otp-api.txt should hold the Web app URL ending in /exec" }
$desigJson=ConvertTo-Json -Compress -InputObject @([regex]::Matches((& $sel "DESIG"),"<option>(.*?)</option>") | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) })
$src=& $read "$sp\cv.src.html"
[IO.File]::WriteAllText("$code\cv.html",$src.Replace("__CLIENT_ID__",$clientId).Replace("__ALLOWED__",$allowedJson).Replace("__DESIG_JSON__",$desigJson).Replace("__JSZIP__",$jszip),$u8)

# Birthday Cards: designs in birthday\template1..5.jpg (printed name already removed)
$tpls=(1..5 | ForEach-Object { '"'+$_+'":"data:image/jpeg;base64,'+[Convert]::ToBase64String([IO.File]::ReadAllBytes("$sp\birthday\template$_.jpg"))+'"' }) -join ","
$src=& $read "$sp\bday.src.html"
[IO.File]::WriteAllText("$code\birthday.html",$src.Replace("__TEMPLATES__","{"+$tpls+"}").Replace("__JSZIP__",$jszip),$u8)

# Dashboard
$shell=& $read "$sp\shell.html"
$b={param($f)[Convert]::ToBase64String([IO.File]::ReadAllBytes("$code\$f"))}
$out=$shell.Replace("__BUILD__",(Get-Date).ToString("d MMM yyyy, h:mm tt")).Replace("__LOGO__",$logo).Replace("__CLIENT_ID__",$clientId).Replace("__ALLOWED__",$allowedJson).Replace("__OTP_API__",$otpApi).Replace("__EXP__",(& $b "experience.html")).Replace("__REL__",(& $b "relieving.html")).Replace('__LOI__',(& $b 'loi.html')).Replace('__APPT__',(& $b 'appointment-letter.html')).Replace('__JOINER__',(& $b 'index2.html')).Replace('__BDAY__',(& $b 'birthday.html'))
[IO.File]::WriteAllText("$code\index.html",$out,$u8)
"built loi.html, experience.html, relieving.html, cv.html, birthday.html and index.html"
