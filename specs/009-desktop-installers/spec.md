# Desktop installers

Distribute the existing NexWork enterprise client through GitHub Releases. Employees install the application, open Settings → Enterprise, enter their configuration service URL and department key, and apply configuration. No onboarding or automatic updates are added.

The first release targets macOS arm64, macOS x64, and Windows x64. Installers must include the pinned AionCore backend, its managed resources, and the pinned Claude Code executable. Missing payloads or failed builds must stop publication. Release notes must distinguish build/resource checks from installation tests and disclose unsigned packages.

The service and gateway addresses must be reachable from employee machines; local SSH tunnel addresses are not distributed as defaults. No department credentials are embedded in installers.
