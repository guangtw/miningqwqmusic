#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\artifacts\MiningQwQMusic-win-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\artifacts\release"
#endif
[Setup]
AppId={{A45B92BE-CA73-498E-9F0A-7EF09828A112}
AppName=Mining唱片行
AppVersion={#AppVersion}
AppPublisher=MiningQwQ
AppPublisherURL=https://github.com/guangtw/miningqwqmusic
AppSupportURL=https://github.com/guangtw/miningqwqmusic/issues
DefaultDirName={localappdata}\Programs\MiningQwQMusic
DefaultGroupName=Mining唱片行
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=MiningQwQMusic-Windows-{#AppVersion}-x64-Setup
SetupIconFile={#SourceDir}\Assets\AppIcon.ico
UninstallDisplayIcon={app}\Assets\AppIcon-v{#AppVersion}.ico
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimp"; MessagesFile: "languages\ChineseSimplified.isl"
[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: checkedonce
[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\Assets\AppIcon.ico"; DestDir: "{app}\Assets"; DestName: "AppIcon-v{#AppVersion}.ico"; Flags: ignoreversion
Source: "languages\LICENSE"; DestDir: "{app}\notices"; DestName: "InstallerTranslation-LICENSE.txt"; Flags: ignoreversion
[Icons]
Name: "{autoprograms}\Mining唱片行"; Filename: "{app}\MiningQwQMusic.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Assets\AppIcon-v{#AppVersion}.ico"
Name: "{autodesktop}\Mining唱片行"; Filename: "{app}\MiningQwQMusic.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Assets\AppIcon-v{#AppVersion}.ico"; Tasks: desktopicon
[Run]
Filename: "{app}\MiningQwQMusic.exe"; Description: "打开 Mining唱片行"; Flags: nowait postinstall skipifsilent
