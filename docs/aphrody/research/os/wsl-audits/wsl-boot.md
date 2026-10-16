# WSL boot action audit

Date: 2026-10-01, Europe/Paris. Source checkout: `.cache/upstream/WSL` (not in repo) (generated or machine-local artifact; presence depends on the build host), Microsoft WSL commit `c34e75aea8dcc50c0c2f9e76b2de9b26a58e8b67`.

## Finding

The failing scheduled action quoted the distro name in a raw `cmd.exe` command: `--distribution "Ubuntu-24.04"`. WSL parses its raw Windows command line, and the `--distribution` branch does not strip those literal quotes. It therefore asks the service for a registered distribution whose name includes quotes. This caused `Wsl/Service/WSL_E_DISTRO_NOT_FOUND`; it did not demonstrate that S4U cannot access this account's distribution.

Source evidence, pinned to the checkout:

- `src/windows/wsl/main.cpp:17-19`: WSL forwards `GetCommandLineW()` to `WslClient::Main`.
- `src/windows/common/WslClient.cpp:1577-1596`: `--distribution` consumes its next token using `helpers::ParseArgument(commandLine)` and passes the resulting string directly to `SvcComm::GetDistributionId`.
- `src/windows/common/helpers.hpp:188`: `ParseArgument` defaults `HandleQuotes` to false.
- `src/windows/common/helpers.cpp:664-684`: the parser selects a whitespace-delimited substring and returns it; it performs no removal of double quotes.
- `src/windows/service/exe/LxssUserSession.cpp:1262-1293`: the service opens the caller's user registration key, compares the supplied name to each registered `DistributionName`, and returns `WSL_E_DISTRO_NOT_FOUND` when no match exists.

## Controlled live checks

All audit tasks copied the actual AphrodyWslBoot principal: user aphro, S4U, highest run level. No credentials were obtained or disclosed. No WSL shutdown or Windows reboot was performed.

1. Existing `task-diagnostic.ps1` under the same principal showed account `APHRODY\aphro`, the registered distro `Ubuntu-24.04`, and successful `wsl --list --quiet` enumeration.
2. `AphrodyWslBootCmdAudit` duplicated the failing `cmd.exe` action, replacing the persistent sleep with `/usr/bin/id` and redirecting to a separate audit log. It reproduced `WSL_E_DISTRO_NOT_FOUND` with task result `4294967295`.
3. `AphrodyWslBootAudit` executed a protected-directory PowerShell script with `& 'C:\Program Files\WSL\wsl.exe' --distribution Ubuntu-24.04 --exec /usr/bin/id`. It returned `uid=1000(aphro)` and exit 0. Its subsequent `/bin/sleep 120` kept the task Running, then exited normally with task result 0.
4. `AphrodyWslBootCmdFixedAudit` used the original cmd quoting around executable and output paths but left the distro token unquoted. `/usr/bin/id` returned the same uid=1000 and task result 0. This isolates distro-token quoting as the fault.

The integrating agent replaced the real action with a protected PowerShell script. That script should invoke the executable through PowerShell's call operator and a normal argument value for this distro, rather than constructing a nested cmd command. It must retain the correct user principal because WSL distribution registration is scoped to that Windows account.

Audit tasks were removed after the checks. Temporary audit scripts and logs contain only nonsecret diagnostics.

## Limits

A manually started S4U task proves noninteractive task execution and a persistent WSL process under that principal. It does not prove a full cold Windows boot before the first interactive sign-in. That requires a separately scheduled reboot acceptance check. The integrating agent owns verification of the final installed AphrodyWslBoot task and service state.
