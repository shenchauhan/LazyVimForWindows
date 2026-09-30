[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'WinGet is not installed. Install or update App Installer from the Microsoft Store, then rerun this script.'
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is not set; cannot locate the Neovim configuration directory.'
}

$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture
switch ($architecture) {
    Arm64 {
        $compilerPackageId = 'MartinStorsjo.LLVM-MinGW.UCRT'
        $compilerExecutable = 'aarch64-w64-mingw32-gcc.exe'
        $compilerTarget = 'aarch64-w64-windows-gnu'
    }
    X64 {
        $compilerPackageId = 'BrechtSanders.WinLibs.POSIX.UCRT'
        $compilerExecutable = 'gcc.exe'
        $compilerTarget = 'x86_64-w64-mingw32'
    }
    X86 {
        $compilerPackageId = 'BrechtSanders.WinLibs.POSIX.UCRT'
        $compilerExecutable = 'gcc.exe'
        $compilerTarget = 'i686-w64-mingw32'
    }
    default {
        throw "Unsupported Windows architecture: $architecture."
    }
}

$packageIds = @(
    'Neovim.Neovim'
    $compilerPackageId
    'Microsoft.VisualStudio.BuildTools'
    'tree-sitter.tree-sitter-cli'
    'sharkdp.fd'
    'junegunn.fzf'
    'BurntSushi.ripgrep.GNU'
)

if ($architecture -eq [Runtime.InteropServices.Architecture]::Arm64) {
    $arm64EmulatedTools = @(
        'LuaLS.lua-language-server'
        'JohnnyMorganz.StyLua'
        'mvdan.shfmt'
    )
    $packageIds += $arm64EmulatedTools
}

foreach ($packageId in $packageIds) {
    $null = winget.exe list --id $packageId --exact --source winget `
        --accept-source-agreements

    if ($LASTEXITCODE -eq 0) {
        Write-Host "$packageId is already installed; skipping."
        continue
    }

    # 0x8A150014 means no installed package matched the query.
    if ($LASTEXITCODE -ne -1978335212) {
        throw "Checking $packageId failed with WinGet exit code $LASTEXITCODE."
    }

    Write-Host "Installing $packageId from the WinGet community repository..."
    $installArgs = @('install', '--id', $packageId, '--exact', '--source', 'winget',
        '--silent', '--accept-package-agreements', '--accept-source-agreements')
    if ($architecture -eq [Runtime.InteropServices.Architecture]::Arm64 -and
        $arm64EmulatedTools -contains $packageId) {
        $installArgs += @('--architecture', 'x64')
    }
    winget.exe @installArgs

    if ($LASTEXITCODE -ne 0) {
        throw "$packageId installation failed with WinGet exit code $LASTEXITCODE."
    }
}

$env:Path = @(
    $env:Path
    [Environment]::GetEnvironmentVariable('Path', 'Machine')
    [Environment]::GetEnvironmentVariable('Path', 'User')
) -join ';'

$compiler = Get-Command $compilerExecutable -All -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -like "*$compilerPackageId*" } |
    Select-Object -First 1
if (-not $compiler) {
    throw "$compilerExecutable from $compilerPackageId was not found on PATH. Open a new terminal and rerun this script."
}

$target = & $compiler.Source -dumpmachine
if ($LASTEXITCODE -ne 0 -or $target -notlike "$compilerTarget*") {
    throw "Compiler '$($compiler.Source)' targets '$target', not $compilerTarget."
}

$userCompiler = [Environment]::GetEnvironmentVariable('CC', 'User')
if ($userCompiler -and $userCompiler -ne $compiler.Source) {
    throw "User CC is already set to '$userCompiler'. Set it to '$($compiler.Source)' and rerun this script."
}

if ($architecture -eq [Runtime.InteropServices.Architecture]::Arm64) {
    $flagsName = 'CFLAGS_aarch64_pc_windows_msvc'
    $flags = '--target=aarch64-w64-mingw32'
    $userFlags = [Environment]::GetEnvironmentVariable($flagsName, 'User')
    if ($userFlags -and $userFlags -ne $flags) {
        throw "User $flagsName is already set to '$userFlags'. Set it to '$flags' and rerun this script."
    }

    # tree-sitter builds for the MSVC host target; override it for the MinGW compiler.
    [Environment]::SetEnvironmentVariable($flagsName, $flags, 'User')
    Set-Item -Path "Env:$flagsName" -Value $flags
}

[Environment]::SetEnvironmentVariable('CC', $compiler.Source, 'User')
$env:CC = $compiler.Source
Write-Host "Configured CC for $architecture as '$($compiler.Source)'."

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Write-Host 'Git is required by LazyVim; installing Git.Git from the WinGet community repository...'
    winget.exe install --id Git.Git --exact --source winget --silent `
        --accept-package-agreements --accept-source-agreements

    if ($LASTEXITCODE -ne 0) {
        throw "Git installation failed with WinGet exit code $LASTEXITCODE."
    }

    $env:Path = @(
        $env:Path
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) -join ';'
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw 'Git is not available in this PowerShell session. Open a new terminal and rerun this script.'
}

$gitVersionOutput = git.exe --version
if ($LASTEXITCODE -ne 0 -or $gitVersionOutput -notmatch '^git version (\d+\.\d+\.\d+)') {
    throw "Could not determine the installed Git version: $gitVersionOutput"
}

if ([version]$Matches[1] -lt [version]'2.19.0') {
    throw "LazyVim requires Git 2.19 or newer; found $($Matches[1]). Update Git and rerun this script."
}

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    throw 'LazyVim requires curl.exe. Install curl, then rerun this script.'
}

$configPath = Join-Path $env:LOCALAPPDATA 'nvim'
$dataPath = Join-Path $env:LOCALAPPDATA 'nvim-data'
$lazyConfigPath = Join-Path $configPath 'lua\config\lazy.lua'

if ((Test-Path -LiteralPath (Join-Path $configPath 'init.lua') -PathType Leaf) -and
    (Test-Path -LiteralPath $lazyConfigPath -PathType Leaf) -and
    (Select-String -LiteralPath $lazyConfigPath -Pattern 'LazyVim/LazyVim' -SimpleMatch -Quiet)) {
    Write-Host "LazyVim is already configured at '$configPath'; keeping the existing configuration and data."
}
else {
    $stagingPath = Join-Path $env:LOCALAPPDATA "LazyVim-starter-$([guid]::NewGuid().ToString('N'))"
    $backupSuffix = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N'))"
    $backups = @{}

    try {
        Write-Host 'Cloning the LazyVim starter...'
        git.exe clone --filter=blob:none https://github.com/LazyVim/starter.git $stagingPath
        if ($LASTEXITCODE -ne 0) {
            throw "Cloning the LazyVim starter failed with Git exit code $LASTEXITCODE."
        }

        if (-not (Test-Path -LiteralPath (Join-Path $stagingPath 'init.lua') -PathType Leaf) -or
            -not (Test-Path -LiteralPath (Join-Path $stagingPath 'lua\config\lazy.lua') -PathType Leaf)) {
            throw 'The LazyVim starter clone is missing required configuration files.'
        }

        Remove-Item -LiteralPath (Join-Path $stagingPath '.git') -Recurse -Force

        foreach ($path in @($configPath, $dataPath)) {
            if (Test-Path -LiteralPath $path) {
                $backupPath = "$path.bak.$backupSuffix"
                Move-Item -LiteralPath $path -Destination $backupPath
                $backups[$path] = $backupPath
                Write-Host "Backed up '$path' to '$backupPath'."
            }
        }

        Move-Item -LiteralPath $stagingPath -Destination $configPath
    }
    catch {
        foreach ($path in @($configPath, $dataPath)) {
            if ($backups.ContainsKey($path) -and -not (Test-Path -LiteralPath $path)) {
                Move-Item -LiteralPath $backups[$path] -Destination $path
            }
        }
        throw
    }
    finally {
        if (Test-Path -LiteralPath $stagingPath) {
            Remove-Item -LiteralPath $stagingPath -Recurse -Force
        }
    }

    Write-Host "LazyVim starter configured at '$configPath'."
}

if ($architecture -eq [Runtime.InteropServices.Architecture]::Arm64) {
    foreach ($executable in @('lua-language-server.exe', 'stylua.exe', 'shfmt.exe')) {
        if (-not (Get-Command $executable -ErrorAction SilentlyContinue)) {
            throw "$executable is not on PATH after installation. Open a new terminal and rerun this script."
        }
    }

    $pluginPath = Join-Path $configPath 'lua\plugins\windows-arm64.lua'
    $plugin = @'
return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        lua_ls = { mason = false, cmd = { "lua-language-server" } },
      },
    },
  },
  {
    "mason-org/mason.nvim",
    opts = function(_, opts)
      opts.ensure_installed = vim.tbl_filter(function(tool)
        return tool ~= "stylua" and tool ~= "shfmt"
      end, opts.ensure_installed or {})
    end,
  },
}
'@
    if (Test-Path -LiteralPath $pluginPath) {
        if ((Get-Content -LiteralPath $pluginPath -Raw).Trim() -ne $plugin.Trim()) {
            throw "Existing '$pluginPath' differs from the installer-managed ARM64 configuration. Review it before rerunning."
        }
    }
    else {
        [IO.File]::WriteAllText($pluginPath, $plugin + [Environment]::NewLine,
            [Text.UTF8Encoding]::new($false))
        Write-Host "Configured LazyVim to use WinGet tools instead of unsupported Mason ARM64 packages at '$pluginPath'."
    }
}

Write-Host 'Open a new terminal, run nvim to install the plugins, then run :LazyHealth in Neovim.'
