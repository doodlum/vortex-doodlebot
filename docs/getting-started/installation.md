# Install Doodlebot

Doodlebot is a TypeScript toolkit for testing Vortex. It starts an isolated app, lets your code inspect and operate it, and closes the app when your test finishes. Local tests use a disposable game and generated data.

## What you need

- Windows and a released Vortex installation.
- Node.js **20.19 or newer** and **pnpm 9.15.0**, matching this repository's `package.json`.
- Git, to clone the repository.
- A visible desktop for UI and performance tests.

You do not need a Nexus account, a commercial game, an LLM, or Vortex's source code for the first test. [Real collection tests](authentication.md) have extra prerequisites.

## Get the toolkit

Run these commands in PowerShell:

```powershell
git clone https://github.com/doodlum/vortex-doodlebot.git
cd vortex-doodlebot
pnpm install
```

Then [write your first TypeScript test](first-session.md). Its `withVortex()` call prepares the extension, starts the released app with an isolated profile, and cleans up afterward. You do not need a separate setup command.

If Vortex is installed somewhere Doodlebot cannot find, give `withVortex()` its executable path:

```typescript
await withVortex({ executable: "D:/Apps/Vortex/Vortex.exe" }, async (vortex) => {
  // Your test goes here.
});
```

For a missing prerequisite or startup failure, use [troubleshooting](../troubleshooting.md).
