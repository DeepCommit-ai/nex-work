# Feature Specification: Bundled Python for Managed Skills

**Feature Branch**: `nex-work`
**Created**: 2026-10-19
**Status**: Implemented; unit-verified on the dev Mac; installer and Windows checks pending

## Why

The purchase requisition review assistant (nex-agents `purchase-req-review`, delivered through the
cynapse catalog) runs a standard-library Python rules engine from its skill: `run.py --skeleton`,
`run.py --check` and `tools/capture_convert.py`. Employee machines cannot be assumed to have Python:

- Windows 10/11 ship none. `python` / `python3` are App Execution Aliases that open the Microsoft
  Store or print "Python was not found"; `py` exists only after a python.org install. Managed
  corporate machines often block the Store as well.
- macOS has `/usr/bin/python3` only as a stub that asks to install the Command Line Tools; with
  them it is 3.9.6.

Asking employees to install Python is not acceptable for a managed assistant, and downloading one
at first use depends on GitHub being reachable, which it often is not from mainland China.

## Requirements

- **FR-1** Every desktop installer carries a pinned CPython (python-build-standalone
  `install_only_stripped`, 3.12.15 / release 20261001) for its platform and architecture under
  `resources/bundled-python/<platform>-<arch>/`. Nothing is downloaded on the employee machine.
- **FR-2** The build fetches the archive and accepts it only if its SHA-256 matches the hash pinned
  for that platform in the root `package.json` (`bundledPython`). A mirror may be used through
  `NEXWORK_PYTHON_BASE_URL`; the pinned hash still decides.
- **FR-3** The bundle omits what managed skills must not use or do not need: pip and ensurepip
  (the bundle is read-only and stays the pinned standard library), the Tk GUI stack and C headers.
- **FR-4** A packaged app without the interpreter for its target fails the build (afterPack), as a
  missing bundled Claude Code already does.
- **FR-5** On every start NexWork sets `NEXWORK_PYTHON` in the Claude Code agent's `env_override`
  to the bundled interpreter's absolute path (forward slashes on Windows, where Claude Code runs
  commands through Git Bash). When no interpreter is bundled it removes a stale entry, so skills fall
  back to the machine's `python3`. Gateway provisioning keeps the entry.
- **FR-6** Contract with nex-agents: managed skills call `"${NEXWORK_PYTHON:-python3}"`. The name
  and semantics are recorded in cynapse `doc/spec/2026-09-09-managed-nexwork-agents.md` §17.

## Deviation rationale

Upstream AionUi does not bundle a Python. NexWork delivers managed skills whose scripts must run on
machines the employee does not administer; this follows the bundled Claude Code precedent
(cynapse issue #8): pinned at build time, verified, zero runtime download.

## Acceptance criteria

- [x] `preparePython` verifies the pinned hash, refuses a mismatch without leaving a partial bundle,
      prunes the listed parts, writes `VERSION` last and skips an up-to-date bundle (unit tests).
- [x] Every pinned platform has an asset name and a 64-hex hash (unit test).
- [x] `provisionManagedClaude` writes, keeps and removes `NEXWORK_PYTHON` as FR-5 describes, without
      touching other env entries (unit tests).
- [x] The build harness prepares Python for the target architecture after Claude Code (unit test).
- [x] darwin-arm64 bundle prepared from the real release on the dev Mac: 46 MB on disk (66 MB before
      pruning); the skill's three commands run with it and reproduce the committed sample results.
- [x] Live (NexWork-Dev, 2026-10-19): a new purchase review conversation's Claude Code process has
      `NEXWORK_PYTHON`; the assistant ran `"${NEXWORK_PYTHON:-python3}"` and got the bundled 3.12.15.
- [ ] Packaged macOS and Windows x64 installers contain the bundle; on Windows the interpreter runs
      from Git Bash with the forward-slash path.
