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

Give each task one guide and one main run path. Get started owns installation and the generated local test; Run a collection owns game preparation, login, snapshots and the first real install; Run benchmarks owns catalog selection and comparisons; Write a benchmark owns custom authoring. Link to the owning guide instead of repeating its procedure. Keep API options and advanced app controls in the reference, and table-specific fixture recipes in Prepare table fixtures. A copyable benchmark should start in one file; split it only when a reader actually needs reusable cases or configuration.

The human CLI reference lists commands and links to these guides. Keep the complete built-in help in the machine reference rather than publishing another first-run procedure.

## Write examples people can run

Use TypeScript for operations and tests. Give complete standalone snippets a filename, such as `first-test.mts`, and show one short run command. Explain the inputs a person must supply, what the example observes, and what a failure means.

Separate real collection prerequisites from local generated data. Keep unagreed performance targets as TBD. If an example requires an account, game, encoder, or unavailable service, say so before the code.

The topic mapping is in `scripts/documentation-map.json`. Each group there lists source paths, the human pages and the agent instructions that describe them; when a change touches a group's source path, `docs:check` expects at least one of that group's human pages and one of its agent instructions to change as well. The "Design-first workflow" group covers the `design` commands (`harness/src/design.ts` and `harness/src/designCommand.ts`), the review resources in `harness/egm/`, the coding-agent plugin settings and review agent under `.claude/`, and `designs/SITEMAP.md`. Its human pages are [Set up design review in your coding agent](guides/agent-plugins.md) and [Review and approve a design](guides/design-review.md).

Approved designs for changes to Doodlebot itself are kept in `designs/`, one Markdown file per design, and each is listed in `designs/SITEMAP.md` with its status and target. These files are not part of the published site. Run `pnpm run ai -- design check <file>` after editing one: changing its text after approval voids the approval. Designs for Vortex changes are kept out of this repository, in `harness/.artifacts/designs/`.

The human reference is organized by sessions, runners, tables, collections and results. Keep the purpose, inputs, return value, defaults and failures beside each method. `docs:generate` updates only the marked signature blocks on these pages; it does not replace their explanations. Add a `contract` block when documenting a source-derived signature. The complete specialist inventory is generated separately.

When changing the public workflow, ask a fresh reader to use only a frozen copy of the human pages. Compile and run the example it produces separately. Preserve failures and fix the API or explanation that caused them. More generated declarations do not substitute for a usable procedure.

## Publication

The repository's GitHub Pages workflow publishes the built site after the appropriate repository update. Preview and verify a draft before publishing it. Building the local site does not publish anything.
