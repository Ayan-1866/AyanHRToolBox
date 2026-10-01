# Rebuilds loi.html, bulk.html and the dashboard index.html from the sources in this folder.
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
$tpl=([regex]::Match($appt,'(?m)^const TPL="[A-Za-z0-9+/=]+";')).Value
if(-not $tpl){throw "Appointment template not found"}
$foots=([regex]::Match($appt,'(?m)^const FOOTS=(\[.*\]);')).Groups[1].Value
if(-not $foots){throw "Company footer list not found"}
$model=& $read "$sp\loi-model.js"
$logo=[Convert]::ToBase64String([IO.File]::ReadAllBytes("$sp\logo.png"))

# LOI Generator
$src=& $read "$sp\loi.src.html"
$loi=$src.Replace('__DESIG__',(& $sel 'DESIG')).Replace('__LOI_MODEL__',$model).Replace('__JSZIP__',$jszip)
[IO.File]::WriteAllText("$code\loi.html",$loi,$u8)

# Bulk Letters
$src=& $read "$sp\bulk.src.html"
$bulk=$src.Replace('__OFFLOC__',(& $sel 'OFFLOC')).Replace('__OFFADDR__',(& $sel 'OFFADDR')).Replace('__FOOTS__',$foots).Replace('__LOGO__',$logo).Replace('__LOI_MODEL__',$model).Replace('__APPT_TPL__',$tpl).Replace('__JSZIP__',$jszip)
[IO.File]::WriteAllText("$code\bulk.html",$bulk,$u8)

# Dashboard
$shell=& $read "$sp\shell.html"
$b={param($f)[Convert]::ToBase64String([IO.File]::ReadAllBytes("$code\$f"))}
$out=$shell.Replace('__BULK__',(& $b 'bulk.html')).Replace('__LOI__',(& $b 'loi.html')).Replace('__APPT__',(& $b 'appointment-letter.html')).Replace('__JOINER__',(& $b 'index2.html'))
[IO.File]::WriteAllText("$code\index.html",$out,$u8)
"built loi.html, bulk.html and index.html"
