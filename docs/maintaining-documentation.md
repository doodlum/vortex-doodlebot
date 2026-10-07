# Maintain documentation

Keep the setup instructions, examples and references current when you change Doodlebot.
This page covers the paired documentation checks, local preview and GitHub Pages deployment.

## Audience boundaries

- `README.md` introduces useful tasks for people and links into this site.
- `/docs` contains human guides and source-generated human references. Only this folder is published.
- Root/harness instruction and specialist files are written for agents and remain outside the site.
- Both audiences must describe the behavior established by implementation and tests.

Update both audiences in the same change when behavior, setup, flags, schemas, fixture
requirements or workflow guarantees change. For a new test or benchmark, explain how people
can run it, what they need and what the result establishes.

## Shared contracts and paired changes

```powershell
pnpm run docs:generate
pnpm run docs:check
pnpm run docs:test
```

The generator reads TypeScript AST declarations, evaluates the registered Zod input schemas
without running Vortex, and creates separate MCP/CLI/helper/script references for people
and agents from the same source facts. Review the generated changes, then update the task
guides wherever the procedure or prerequisites changed.

`scripts/documentation-map.json` maps source areas to human pages and AI companions. The
check verifies each mapped file exists, generated references match source, site pages do not
link readers into agent instructions, and changed source has an updated mapped companion in
each audience. CI supplies `DOODLEBOT_DOCS_BASE` to check the full PR/push change, including
already committed changes; local checks also inspect the working diff. For a local committed
review, set that variable to your actual comparison base.

The mapping helps reviewers find the relevant guides. Update it when adding a source area
or splitting a guide, and make sure the mapped pages explain the new behavior. Reviewers
still need to check whether the procedure and reference are accurate; a token prose edit
cannot establish that.

## Preview the site

Python 3.10 or newer can build the pinned documentation packages. The site does not require
Vortex or private credentials. From the repository root:

```powershell
python -m venv .venv-docs
.\.venv-docs\Scripts\python.exe -m pip install -r requirements-docs.txt
$env:DOODLEBOT_DOCS_PYTHON = (Resolve-Path .\.venv-docs\Scripts\python.exe).Path
pnpm run docs:serve
```

Open the printed local URL. On other systems use that environment's `bin/python` path.
The site uses Markdown, Material search/navigation/code-copy, and the pinned Nexus Mods Next
theme CSS and local fonts. Edit the Markdown rather than generated HTML in `site/`.

## Build and validate

```powershell
pnpm run docs:check
pnpm run docs:build
```

Build runs MkDocs with `--strict`, so broken internal pages, missing anchors and omitted nav
pages fail the build. Review desktop/mobile pages,
search, syntax highlighting, diagrams and representative examples. Code marked as a template
contains placeholders; runnable recipes need type and/or actual execution checks appropriate
to their prerequisites. A successful site build checks the documentation; live-service
examples also need their own execution checks before you report them as tested.

## Deploy on GitHub Pages

The documentation workflow builds and checks pull requests without deployment. On `main`,
it uploads only generated `site/` output and deploys through GitHub Pages with a scoped
environment and token permissions. Repository Pages uses **GitHub Actions** as the source.
The public URL is `https://doodlum.github.io/vortex-doodlebot/` after a successful deployment.
Check the workflow's deployment result to confirm the site is live after a push.

Human docs are kept separate from agent manuals, private `.cache`, task artifacts and
Vortex source. None of those directories is copied into the site output. Theme source
revision and third-party notices are recorded on [credits](credits.md).
