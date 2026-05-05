import { homedir } from 'os'
import { join } from 'path'

// Runtime paths that abstract Electron's app.getPath/app.getAppPath/app.isPackaged
// so the same modules (mlx.ts, workspace.ts, tools.ts) can run from both the
// Electron main process and a standalone CLI process.
//
// Electron sets these via setRuntimePaths() in src/main/index.ts at startup.
// CLI sets them in src/cli/index.ts before any other module is imported.

interface RuntimePaths {
  userData: string
  appRoot: string
  packaged: boolean
}

let paths: RuntimePaths | null = null

export function setRuntimePaths(p: RuntimePaths): void {
  paths = p
}

function ensure(): RuntimePaths {
  if (paths) return paths
  // Default fallback for macOS so the CLI works without explicit init.
  // Matches Electron's default userData location for productName "gemma-chat".
  paths = {
    userData: join(homedir(), 'Library', 'Application Support', 'gemma-chat'),
    appRoot: process.cwd(),
    packaged: false
  }
  return paths
}

export function userDataDir(): string {
  return ensure().userData
}

export function appRootDir(): string {
  return ensure().appRoot
}

export function isPackaged(): boolean {
  return ensure().packaged
}
