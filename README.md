# ✨ LazyVim for Windows

> A friendly, WinGet-powered setup script for getting a beautiful, batteries-included Neovim environment running on Windows.

![LazyVim dashboard](https://github.com/user-attachments/assets/e2c9fd3c-0ca9-4153-a55c-8bca49a217aa)

This project installs [Neovim](https://neovim.io/), the tools LazyVim needs, and the official [LazyVim starter configuration](https://github.com/LazyVim/starter). It is designed to make a fresh Windows setup feel more like a one-command adventure than a weekend project. 🚀

## 🧰 What the script sets up

`Install-LazyVim.ps1` uses **WinGet** to install:

- Neovim
- Git and the Microsoft C/C++ build tools
- A compiler matched to your Windows architecture
- Tree-sitter CLI
- `fd`, `fzf`, and ripgrep
- Extra language-server and formatting tools on ARM64

It also:

- Detects x64, x86, and ARM64 Windows automatically
- Configures the compiler used by Neovim tools
- Backs up existing Neovim configuration and data before replacing them
- Leaves an existing LazyVim installation untouched
- Adds ARM64-specific settings so supported tools work with Mason alternatives

## ✅ Before you begin

You need:

- Windows with **WinGet** (App Installer)
- PowerShell
- An internet connection
- `curl.exe` (included with modern Windows)

The script checks for prerequisites and stops with an actionable message if something is missing.

## 🚀 Install

Open PowerShell and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Install-LazyVim.ps1
```

If you downloaded the script somewhere else, first change to that directory:

```powershell
cd C:\path\to\LazyVimForWindows
.\Install-LazyVim.ps1
```

The installer may take a few minutes while WinGet downloads tools and the LazyVim starter. Existing folders are renamed with a timestamped `.bak` suffix before the new configuration is installed.

## 🎮 First launch

When the installer finishes:

1. Open a **new** terminal so updated PATH and compiler variables are loaded.
2. Start Neovim:

   ```powershell
   nvim
   ```

3. Let LazyVim finish installing its plugins.
4. Run `:LazyHealth` inside Neovim to verify the setup.

You should land on a dashboard similar to this:

![LazyVim in action](https://github.com/user-attachments/assets/99a6a8ec-a9c2-42f4-b3a9-e6c26efaaa09)

## 🛡️ Safe by default

The script only replaces the Neovim directories when a LazyVim configuration is not already detected:

- Configuration: `%LOCALAPPDATA%\nvim`
- Plugin/data directory: `%LOCALAPPDATA%\nvim-data`

If either directory already exists, it is backed up as a timestamped folder such as `nvim.bak.20260930-123456-...`. If setup fails partway through, the installer attempts to restore the backups.

## 🪟 ARM64 notes

On Windows ARM64, the script installs the ARM64 compiler and uses x64 emulation for tools that do not currently provide a native package. It also creates:

```text
%LOCALAPPDATA%\nvim\lua\plugins\windows-arm64.lua
```

This tells LazyVim to use the WinGet-installed Lua language server, StyLua, and `shfmt` instead of unsupported Mason packages.

## 🧯 Troubleshooting

- **“WinGet is not installed”** — update or install **App Installer** from the Microsoft Store.
- **A tool is not found after installation** — open a new PowerShell window and rerun the script.
- **Git is too old** — LazyVim requires Git 2.19 or newer.
- **An existing ARM64 plugin file differs** — review the file manually before rerunning; the script will not overwrite it.
- **Something went wrong during setup** — check the timestamped `.bak` folders under `%LOCALAPPDATA%` and restore them if needed.

## 🧹 Uninstall or start over

The installer does not remove tools installed through WinGet. To start over, close Neovim, rename or remove `%LOCALAPPDATA%\nvim` and `%LOCALAPPDATA%\nvim-data`, then run the installer again. Keep a backup if you have custom configuration you want to preserve.

## 📄 License

This repository contains the Windows setup script. LazyVim and its plugins remain subject to their own licenses.
