# Windows compatibility notes

Keep this in sync as we learn more. Read this before doing browser runs on Windows.

- Browser engine is enabled on Windows now, but automation is flakier than macOS. If it fails, rerun with `--engine api --wait` or use `--remote-chrome` to point at a logged-in Chrome with remote debugging.
- Cookies: the Chrome cookies DB is copied to a temp location (named `Cookies`) to avoid file locks; we try native decrypt (DPAPI + AES-GCM) and fall back to `chrome-cookies-secure`. If cookies still fail, close Chrome completely or pass inline cookies (`--browser-inline-cookies(-file)` / `ORACLE_BROWSER_COOKIES_JSON`). `--browser-no-cookie-sync` forces a manual login path.
- DPAPI: we override `win-dpapi` to the prebuilt `@primno/dpapi`; VS Build Tools are not required.
- Cookie paths: preferred path is `%LOCALAPPDATA%\\Google\\Chrome\\User Data\\<Profile>\\Network\\Cookies`. If that errors, try the top-level `Cookies` file or supply the exact path via `--browser-cookie-path`.
- mcporter chrome-devtools: requires a valid `CHROME_DEVTOOLS_URL` from a live session; otherwise calls will fail.
- agent-scripts helpers (`runner`, `scripts/committer`) are bash-based and may fail under PowerShell/CMD; run commands directly if they misbehave.
