# Rebuilds loi.html and the dashboard index.html from the sources in this folder.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File build\build.ps1
$ErrorActionPreference='Stop'
$sp=$PSScriptRoot
$code=Split-Path $sp -Parent
$u8=New-Object Text.UTF8Encoding $false
$appt=[IO.File]::ReadAllText("$code\appointment-letter.html",$u8)
$lines=$appt -split "`n"
$jszip=($lines[6..18] -join "`n").TrimEnd("`r")
if(-not $jszip.StartsWith('<script>') -or -not $jszip.EndsWith('</script>')){throw "JSZip block not where expected"}
$m=[regex]::Match($appt,'<select id="DESIG">(.*?)</select>',[Text.RegularExpressions.RegexOptions]::Singleline)
if(-not $m.Success){throw "DESIG list not found"}
$src=[IO.File]::ReadAllText("$sp\loi.src.html",$u8)
[IO.File]::WriteAllText("$code\loi.html",$src.Replace('__JSZIP__',$jszip).Replace('__DESIG__',$m.Groups[1].Value),$u8)
$shell=[IO.File]::ReadAllText("$sp\shell.html",$u8)
$b={param($f)[Convert]::ToBase64String([IO.File]::ReadAllBytes("$code\$f"))}
$out=$shell.Replace('__LOI__',(& $b 'loi.html')).Replace('__APPT__',(& $b 'appointment-letter.html')).Replace('__JOINER__',(& $b 'index2.html'))
[IO.File]::WriteAllText("$code\index.html",$out,$u8)
"built loi.html and index.html"
