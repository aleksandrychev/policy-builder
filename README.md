# CFEngine Policy Builder

[![CI](https://github.com/cfengine/policy-builder/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cfengine/policy-builder/actions/workflows/ci.yml)
[![Electron security](https://github.com/cfengine/policy-builder/actions/workflows/electron-security.yml/badge.svg?branch=main)](SECURITY-CHECKLIST.md)
[![TypeScript coverage](https://img.shields.io/codecov/c/github/cfengine/policy-builder/main?flag=typescript&label=TypeScript%20coverage)](https://app.codecov.io/gh/cfengine/policy-builder?flags%5B0%5D=typescript)
[![Python coverage](https://img.shields.io/codecov/c/github/cfengine/policy-builder/main?flag=python&label=Python%20coverage)](https://app.codecov.io/gh/cfengine/policy-builder?flags%5B0%5D=python)

Desktop application for building CFEngine policy.

**Stack:** 
 - Electron 
 - React
 - TypeScript
 - MUI
 - Python (bundled sidecar for the CFEngine toolchain)

## Requirements

- Node.js 22.12+
- npm 10+
- uv - manages the Python sidecar and its interpreter, so no system Python is needed

## Getting started

```sh
npm ci               # install exactly the versions package-lock.json pins
npm run backend:sync # create python/.venv with the CFEngine toolchain
npm run dev          # launches Electron app
```

`npm run dev` needs the sidecar to exist, so `backend:sync` is a one-time
prerequisite. Without it, the app runs but anything touching the backend
reports that it cannot be found.

## Security

How the app follows Electron's security recommendations, item by item, and
how that is checked: [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md).

## Project structure

electron-vite builds three targets from `src/`:

```
src/
├── main/      # Electron main process: window creation, ipcMain handlers
├── preload/   # contextBridge exposing `window.api`
└── renderer/  # React app
python/        # Python sidecar, packaged with PyInstaller
```

## The Python sidecar

Policy formatting, and later `cfbs` policy generation, local container testing
and the AI backend, run in a Python process bundled with the app — see
[python/README.md](python/README.md). Electron spawns it **once per user
action**, writes the policy to stdin and reads the result from stdout, the same
contract as `prettier` or `black --stdin`.

`npm run backend:build` freezes it with PyInstaller into
`python/dist/cfpb-backend/`, which `electron-builder` then ships in the app's
resources. The `build:*` scripts do that for you.

## Scripts

| Script                  | What it does                                               |
| ----------------------- | ---------------------------------------------------------- |
| `npm run dev`           | Dev app with hot reload                                    |
| `npm run build`         | Type-check then build main/preload/renderer bundles        |
| `npm start`             | Preview the production build                               |
| `npm run build:mac`     | Build sidecar + app, package for macOS (`dmg`, `zip`)      |
| `npm run build:win`     | Build sidecar + app, package a Windows installer (`nsis`)  |
| `npm run build:linux`   | Build sidecar + app, package Linux (`AppImage`,`deb`,`rpm`)|
| `npm run lint`          | ESLint (flat config)                                       |
| `npm run format`        | Prettier write                                             |
| `npm run typecheck`     | `tsc --noEmit` for node + web projects                     |
| `npm test`              | Vitest unit tests (jsdom)                                  |
| `npm run backend:sync`  | Install the sidecar's Python dependencies (uv)             |
| `npm run backend:build` | Freeze the sidecar with PyInstaller                        |
| `npm run backend:test`  | pytest                                                     |
| `npm run backend:format`| Black write                                                |
| `npm run backend:format:check` | Black check, as CI runs it                          |

## CI

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs
lint + format check, type check, unit tests, and the Python backend's own lint
and tests on every push and PR.

## Releases

Pushing a tag that matches `package.json`'s version (`v0.1.0`) runs
[.github/workflows/release.yml](.github/workflows/release.yml): it builds the
installers for macOS (arm64 and x64), Linux and Windows and attaches them to a
draft prerelease, visible only to the repository's maintainers until published.
The builds aren't code-signed yet; the release notes say how to open them.
