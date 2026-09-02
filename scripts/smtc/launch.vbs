' Starts the collector with no console window at all.
'
' WHY THIS SHIM EXISTS
' powershell.exe is a CONSOLE application. Windows allocates and shows its
' console before the process reads its own arguments, so -WindowStyle Hidden
' arrives too late and a black window flashes on every launch -- and on some
' machines simply stays. There is no PowerShell-side flag that prevents this;
' the window has to be suppressed by whatever starts the process.
'
' wscript.exe is a WINDOWLESS host. Run(..., 0, False) means "hidden, do not
' wait", so the collector starts with nothing drawn on screen at any point.
' Its only visible surface is the tray icon, which is the entire point of it.
'
' The alternative was compiling a small WinExe launcher. Three lines of VBScript
' that ship in the repo and need no build step beat a binary nobody can read.

Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "tray.ps1""", 0, False
