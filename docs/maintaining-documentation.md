# Build and preview the documentation

The site uses MkDocs Material. Human guides live in `docs/`, navigation is in `mkdocs.yml`, and the repository README links to the published site.

## Install the site tools

With Python available, install the pinned documentation dependencies:

```powershell
python -m pip install -r requirements-docs.txt
```

Run these from the repository root:

```powershell
pnpm run docs:generate
pnpm run docs:check
pnpm run docs:test
pnpm run docs:build
```

`docs:generate` refreshes source-derived references. `docs:check` catches drift and link/contract problems. `docs:test` tests the documentation checks themselves. `docs:build` runs a strict MkDocs build and writes `site/`.

If you use a different Python executable, set `DOODLEBOT_DOCS_PYTHON` to its path. The build script uses that executable instead of `python`.

## Preview a change

Run `pnpm run docs:serve` and open the local address it prints. Check the page at desktop and narrow widths. Try code copy, follow the main task links, and verify that the page tells a reader what to do and what result to expect.

Keep navigation focused on practical tasks and make code examples easy to copy.

## Write examples people can run

Use TypeScript for operations and tests. Give complete standalone snippets a filename, such as `first-test.mts`, and show one short run command. Explain the inputs a person must supply, what the example observes, and what a failure means.

Separate real collection prerequisites from local generated data. Keep unagreed performance targets as TBD. If an example requires an account, game, encoder, or unavailable service, say so before the code.

The topic mapping is in `scripts/documentation-map.json`. The human reference is organized by sessions, runners, tables, collections and results. Keep the purpose, inputs, return value, defaults and failures beside each method. `docs:generate` updates only the marked signature blocks on these pages; it does not replace their explanations. Add a `contract` block when documenting a source-derived signature. The complete specialist inventory is generated separately.

When changing the public workflow, ask a fresh reader to use only a frozen copy of the human pages. Compile and run the example it produces separately. Preserve failures and fix the API or explanation that caused them. More generated declarations do not substitute for a usable procedure.

## Publication

The repository's GitHub Pages workflow publishes the built site after the appropriate repository update. Preview and verify a draft before publishing it. Building the local site does not publish anything.
