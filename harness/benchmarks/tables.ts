import type { Page, Locator } from "@playwright/test";
import type { BenchmarkSession } from "./session";
import {
  BenchmarkBlocked,
  type ActionOptions,
  type DragOptions,
  type InputOptions,
  type TableDefinition,
} from "./types";

export class BenchmarkTable {
  private populated = false;
  constructor(
    private readonly session: BenchmarkSession,
    private readonly definition: TableDefinition,
    private readonly id: string,
  ) {}
  private get page(): Page {
    return this.session.page;
  }
  async open(): Promise<void> {
    await this.session.openPage(this.definition.page);
    try {
      await this.page
        .locator(this.definition.root)
        .waitFor({ state: "visible", timeout: this.session.timeoutMs });
    } catch (error) {
      throw new BenchmarkBlocked(
        `${this.id}: table ${this.definition.root} did not become uniquely visible after navigation; supply game-specific controls/data`,
        { cause: error },
      );
    }
    if ((await this.page.locator(this.definition.root).count()) !== 1)
      throw new BenchmarkBlocked(
        `${this.id}: missing unique table ${this.definition.root}; supply game-specific table controls/data`,
      );
    if (!this.populated) {
      try {
        await this.page
          .locator(this.definition.rows)
          .nth(1)
          .waitFor({ state: "attached", timeout: this.session.timeoutMs });
      } catch (error) {
        throw new BenchmarkBlocked(
          `${this.id}: at least two populated rows required; install matching real data`,
          { cause: error },
        );
      }
    }
    if (!this.populated && (await this.page.locator(this.definition.rows).count()) < 2)
      throw new BenchmarkBlocked(
        `${this.id}: at least two populated rows required; install matching real data`,
      );
    this.populated = true;
  }
  async rows(): Promise<string[]> {
    return this.page.locator(this.definition.rows).allTextContents();
  }
  private async control(selector: string) {
    const locator = this.page.locator(selector);
    if (
      (await locator.count()) !== 1 ||
      !(await locator.isVisible()) ||
      !(await locator.isEnabled())
    )
      throw new BenchmarkBlocked(`${this.id}: missing unique visible enabled control ${selector}`);
    return locator;
  }
  private async action(
    kind: string,
    options: ActionOptions,
    input: () => Promise<void>,
  ): Promise<void> {
    await this.open();
    const before = await this.session.observe(options.expect);
    if (JSON.stringify(before) === JSON.stringify(options.expect.equals))
      throw new BenchmarkBlocked(
        `${this.id}.${kind}: fixture already has expected result; action would be a no-op`,
      );
    await this.session.measure(options.name ?? `${this.id}.${kind}`, async () => {
      await input();
      await this.session.waitFor(options.expect);
    });
    this.session.evidence.push({
      action: `${this.id}.${kind}`,
      before,
      after: await this.session.observe(options.expect),
      expectation: options.expect,
    });
  }
  private async uniqueVisible(locator: Locator, label: string): Promise<Locator> {
    const visible: Locator[] = [];
    for (let i = 0; i < (await locator.count()); i++)
      if (await locator.nth(i).isVisible()) visible.push(locator.nth(i));
    if (visible.length !== 1)
      throw new BenchmarkBlocked(
        `${this.id}: expected one visible ${label}, found ${visible.length}; supply explicit ActionOptions for this released UI`,
      );
    return visible[0]!;
  }
  private async until(condition: () => Promise<boolean>, description: string): Promise<void> {
    const deadline = Date.now() + this.session.timeoutMs;
    while (!(await condition())) {
      if (Date.now() >= deadline) throw new Error(`${this.id}: ${description}`);
      await this.page.waitForTimeout(25);
    }
  }
  async sort(options: ActionOptions | string = "name"): Promise<void> {
    if (typeof options !== "string")
      return this.action("sort", options, async () => {
        await (await this.control(options.control)).click();
      });
    if (options !== "name" && options !== "filename")
      throw new BenchmarkBlocked(
        `Simple sort has no verified comparator for ${options}; use ActionOptions with an explicit observable order`,
      );
    await this.open();
    const header = await this.uniqueVisible(
      this.page.locator(`${this.definition.root} .header-${options}`),
      `${options} column header`,
    );
    const clickSort = async () => {
      const icon = await this.uniqueVisible(
        header.locator('.cell-controls svg[class*="icon-sort"]'),
        `${options} sort icon`,
      );
      await icon.click();
    };
    type SortRow = { id: string; value: string; visible: boolean };
    type Direction = "ascending" | "descending";
    const read = () =>
      this.page.locator(this.definition.rows).evaluateAll((rows, column) => {
        const view = rows[0]?.ownerDocument.defaultView;
        type Clip = { top: number; bottom: number };
        const viewport = { top: 0, bottom: view?.innerHeight ?? 0 };
        const clips = new Map<Element, Clip>();
        const clipFor = (element: Element | null): Clip => {
          if (!element || !view) return viewport;
          const cached = clips.get(element);
          if (cached) return cached;
          const inherited = clipFor(element.parentElement);
          let result = inherited;
          if (
            ["auto", "scroll", "overlay", "hidden", "clip"].includes(
              view.getComputedStyle(element).overflowY,
            )
          ) {
            const bounds = element.getBoundingClientRect();
            result = {
              top: Math.max(inherited.top, bounds.top),
              bottom: Math.min(inherited.bottom, bounds.bottom),
            };
          }
          clips.set(element, result);
          return result;
        };
        return rows.map((row) => {
          const rect = row.getBoundingClientRect();
          const { top, bottom } = clipFor(row.parentElement);
          return {
            id: row.getAttribute("data-rowid") ?? "",
            value: row.querySelector(`.cell-${column}`)?.textContent?.trim() ?? "",
            visible:
              bottom > top &&
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > top &&
              rect.top < bottom,
          };
        });
      }, options);
    const original = await read();
    if (
      original.length < 2 ||
      original.some((row) => !row.id) ||
      new Set(original.map((row) => row.id)).size !== original.length
    )
      throw new BenchmarkBlocked("Sort requires complete unique row IDs");
    const identity = (rows: SortRow[]) => JSON.stringify(rows.map((row) => row.id).sort());
    const originalIdentity = identity(original);
    const originalValues = new Map<string, string>();
    const collect = (rows: SortRow[]) => {
      if (identity(rows) !== originalIdentity)
        throw new Error("Sort preparation changed the original row IDs");
      for (const row of rows) {
        if (!row.value) continue;
        const previous = originalValues.get(row.id);
        if (previous !== undefined && previous !== row.value)
          throw new Error("Sort preparation changed a row's original cell text");
        originalValues.set(row.id, row.value);
      }
    };
    collect(original);
    const deadline = Date.now() + this.session.timeoutMs;
    const scanned = originalValues.size !== original.length;
    while (originalValues.size < original.length) {
      const missing = original.find((row) => !originalValues.has(row.id))!;
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new BenchmarkBlocked(
          "Sort preparation could not collect every row's actual displayed name before timeout",
        );
      await this.page
        .locator(`${this.definition.root} tr[data-rowid=${JSON.stringify(missing.id)}]`)
        .scrollIntoViewIfNeeded({ timeout: remaining });
      await this.until(async () => {
        collect(await read());
        if (Date.now() >= deadline)
          throw new BenchmarkBlocked(
            "Sort preparation could not collect every row's actual displayed name before timeout",
          );
        return originalValues.has(missing.id);
      }, "virtualized row did not populate its displayed name");
    }
    const rendered = (rows: SortRow[]) =>
      rows.some((row) => row.visible) &&
      rows.every(
        (row) =>
          (!row.value || originalValues.get(row.id) === row.value) &&
          (!row.visible || row.value.length > 0),
      );
    if (scanned) {
      await this.page
        .locator(`${this.definition.root} tr[data-rowid=${JSON.stringify(original[0]!.id)}]`)
        .scrollIntoViewIfNeeded({ timeout: Math.max(1, deadline - Date.now()) });
      await this.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await this.until(async () => {
        const rows = await read();
        if (Date.now() >= deadline)
          throw new BenchmarkBlocked(
            "Sort preparation did not restore populated starting rows before timeout",
          );
        return (
          identity(rows) === originalIdentity &&
          rendered(rows) &&
          rows.some(
            (row) =>
              row.id === original[0]!.id && row.visible && row.value === originalValues.get(row.id),
          )
        );
      }, "starting virtualized rows did not become populated after restoration");
    }
    const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
    const ordered = (rows: SortRow[], direction: Direction) =>
      identity(rows) === originalIdentity &&
      rendered(rows) &&
      rows.every(
        (row, index) =>
          index === 0 ||
          compare(originalValues.get(rows[index - 1]!.id)!, originalValues.get(row.id)!) *
            (direction === "ascending" ? 1 : -1) <=
            0,
      );
    const direction = async (): Promise<Direction | undefined> => {
      const up = await header.locator(".icon-sort-up").count();
      const down = await header.locator(".icon-sort-down").count();
      return Boolean(up) === Boolean(down) ? undefined : up ? "ascending" : "descending";
    };
    if (await header.locator(".icon-sort-none").count()) {
      await clickSort();
      await this.until(
        async () => (await direction()) === "ascending" && ordered(await read(), "ascending"),
        "initial sort did not render all rows in ascending order with the original row IDs",
      );
    } else {
      await this.until(async () => {
        const current = await direction();
        return current !== undefined && ordered(await read(), current);
      }, "active sort direction and complete row order did not agree");
    }
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const beforeRows = await read();
    const before = beforeRows.map((row) => row.id);
    const current = await direction();
    if (!current || !ordered(beforeRows, current))
      throw new Error("Sort preparation lost its established row order");
    if (
      beforeRows.every(
        (row) => compare(originalValues.get(row.id)!, originalValues.get(beforeRows[0]!.id)!) === 0,
      )
    )
      throw new BenchmarkBlocked(
        "Sort requires at least two distinct name values; reversing tied values would be a no-op",
      );
    const target: Direction = current === "ascending" ? "descending" : "ascending";
    await this.session.measure(`${this.id}.sort`, async () => {
      await clickSort();
      await this.until(async () => {
        if ((await direction()) !== target) return false;
        const rows = await read();
        return (
          ordered(rows, target) &&
          JSON.stringify(rows.map((row) => row.id)) !== JSON.stringify(before)
        );
      }, `sort did not render all rows in ${target} order with the original row IDs`);
    });
    const afterRows = await read();
    const after = afterRows.map((row) => row.id);
    if (
      (await direction()) !== target ||
      !ordered(afterRows, target) ||
      JSON.stringify(after) === JSON.stringify(before)
    )
      throw new Error(
        `Sort changed during final paint: expected ${target} order with original row IDs and their original cell text`,
      );
    this.session.evidence.push({
      action: `${this.id}.sort`,
      column: options,
      direction: target,
      before,
      after,
      beforeValues: beforeRows.map((row) => originalValues.get(row.id)!),
      afterValues: afterRows.map((row) => originalValues.get(row.id)!),
      nameCapture:
        "actual populated DOM cells collected before timing; hidden virtual placeholders checked through original ID mapping",
    });
  }
  private async ids(): Promise<string[]> {
    return this.page
      .locator(this.definition.rows)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-rowid") ?? ""));
  }
  async group(options: ActionOptions | string = "status"): Promise<void> {
    if (typeof options !== "string")
      return this.action("group", options, async () => {
        await (await this.control(options.control)).click();
      });
    await this.open();
    const root = this.page.locator(this.definition.root);
    const column = options === "status" ? "enabled" : options;
    const groupControl = await this.uniqueVisible(
      root.locator(`.header-${column} button[title="Group the table by this attribute"]`),
      `Group by ${options} control`,
    );
    const groupRows = `${this.definition.root} .table-group-header, ${this.definition.root} .group-header, ${this.definition.root} tr[class*="group"]`;
    const before = await this.page.locator(groupRows).count();
    await this.session.measure(`${this.id}.group`, async () => {
      await groupControl.click();
      await this.until(
        async () => (await this.page.locator(groupRows).count()) > before,
        "group did not produce group headings",
      );
    });
    this.session.evidence.push({
      action: `${this.id}.group`,
      column: options,
      groupHeadings: await this.page.locator(groupRows).allTextContents(),
    });
  }
  async ungroup(options?: ActionOptions): Promise<void> {
    if (options)
      return this.action("ungroup", options, async () => {
        await (await this.control(options.control)).click();
      });
    await this.open();
    const root = this.page.locator(this.definition.root);
    const groupControl = await this.uniqueVisible(
      root.locator('button.table-group-enabled[title="Group the table by this attribute"]'),
      "Active grouping control",
    );
    const groupRows = `${this.definition.root} .table-group-header, ${this.definition.root} .group-header, ${this.definition.root} tr[class*="group"]`;
    if ((await this.page.locator(groupRows).count()) === 0)
      throw new BenchmarkBlocked(`${this.id}: ungroup requires an already grouped fixture`);
    await this.session.measure(`${this.id}.ungroup`, async () => {
      await groupControl.click();
      await this.until(
        async () => (await this.page.locator(groupRows).count()) === 0,
        "ungroup left group headings",
      );
    });
    this.session.evidence.push({ action: `${this.id}.ungroup`, groupHeadings: 0 });
  }
  private async toggle(ids: readonly string[], enabled: boolean): Promise<void> {
    if (this.id !== "mods" || ids.length === 0)
      throw new BenchmarkBlocked(
        "Simple enable/disable requires nonempty Mods ids; engine tables use ActionOptions",
      );
    await this.open();
    const profile = await this.session.call<{
      id: string;
      modState: Record<string, { enabled?: boolean }>;
    }>("vortex_query", { selector: "activeProfile" });
    if (ids.some((id) => profile.modState[id]?.enabled === enabled))
      throw new BenchmarkBlocked(
        "Enable/disable precondition would include a no-op; choose mods in the opposite state",
      );
    await this.session.measure(`${this.id}.${enabled ? "enable" : "disable"}`, async () => {
      for (const id of ids) {
        // The row itself carries data-rowid; exact filtering avoids label collisions.
        const actual = this.page.locator(
          `${this.definition.root} tr[data-rowid=${JSON.stringify(id)}]`,
        );
        await actual.scrollIntoViewIfNeeded();
        const dropdown = await this.uniqueVisible(
          actual.locator(
            ".cell-status button.dropdown-toggle, .cell-enabled button.dropdown-toggle",
          ),
          "row status menu control",
        );
        await dropdown.click();
        // The primary button can retain a stale cycle target after state changes.
        // Pick the observed released menu's explicit desired state instead.
        const state = enabled ? "enabled" : "disabled";
        const option = await this.uniqueVisible(
          this.page.locator(`.option-mods-enabled-${state} a`),
          `${state} status menu option`,
        );
        await option.click();
        await this.until(async () => {
          const after = await this.session.call<typeof profile>("vortex_query", {
            selector: "activeProfile",
          });
          const label = await actual
            .locator(".cell-status button.dropdown-title, .cell-enabled button.dropdown-title")
            .textContent();
          return after.modState[id]?.enabled === enabled && label?.trim().toLowerCase() === state;
        }, `status menu did not update profile and visible row to ${state}`);
      }
      await this.until(async () => {
        const after = await this.session.call<typeof profile>("vortex_query", {
          selector: "activeProfile",
        });
        return ids.every((id) => after.modState[id]?.enabled === enabled);
      }, "row toggles did not update actual profile mod state");
    });
    this.session.evidence.push({
      action: `${this.id}.${enabled ? "enable" : "disable"}`,
      ids,
      enabled,
    });
  }
  async enable(options: ActionOptions | readonly string[]): Promise<void> {
    if (Array.isArray(options)) return this.toggle(options, true);
    const custom = options as ActionOptions;
    await this.action("enable", custom, async () => {
      await (await this.control(custom.control)).click();
    });
  }
  async disable(options: ActionOptions | readonly string[]): Promise<void> {
    if (Array.isArray(options)) return this.toggle(options, false);
    const custom = options as ActionOptions;
    await this.action("disable", custom, async () => {
      await (await this.control(custom.control)).click();
    });
  }
  async selectAll(options?: ActionOptions): Promise<void> {
    if (options)
      return this.action("select-all", options, async () => {
        await (await this.control(options.control)).click();
      });
    await this.open();
    const ids = await this.ids();
    const selected = () =>
      this.page
        .locator(
          `${this.definition.rows}.table-selected, ${this.definition.rows}.selected, ${this.definition.rows}.multi-selected, ${this.definition.rows}[aria-selected="true"]`,
        )
        .count();
    if ((await selected()) === ids.length)
      throw new BenchmarkBlocked(`${this.id}: every row is already selected`);
    await this.session.measure(`${this.id}.select-all`, async () => {
      const first = this.page.locator(this.definition.rows).first();
      await first.click();
      await this.page.keyboard.press("Control+a");
      await this.until(
        async () => (await selected()) === ids.length,
        "Select all did not select every table row",
      );
    });
    this.session.evidence.push({
      action: `${this.id}.select-all`,
      selected: await selected(),
      total: ids.length,
    });
  }
  private async textFilter(value: string, kind: "search" | "filter"): Promise<void> {
    await this.open();
    const input = await this.uniqueVisible(
      this.page.locator(this.definition.search ?? `${this.definition.root} input[type="text"]`),
      "name filter",
    );
    if ((await input.inputValue()) === value)
      throw new BenchmarkBlocked(`${this.id}: ${kind} value is already present`);
    const before = await this.ids();
    await this.session.measure(`${this.id}.${kind}`, async () => {
      await input.fill(value);
      await this.until(
        async () => JSON.stringify(await this.ids()) !== JSON.stringify(before),
        `${kind} did not change matching rows; choose a discriminating query`,
      );
    });
    this.session.evidence.push({
      action: `${this.id}.${kind}`,
      value,
      before,
      after: await this.ids(),
    });
  }
  async search(options: InputOptions | string): Promise<void> {
    if (typeof options === "string") return this.textFilter(options, "search");
    await this.action("search", options, async () => {
      await (await this.control(options.control)).fill(options.value);
    });
  }
  async filter(options: InputOptions | string): Promise<void> {
    if (typeof options === "string") {
      if (this.id !== "mods" || !["enabled", "disabled", "all"].includes(options.toLowerCase()))
        return this.textFilter(options, "filter");
      await this.open();
      const header = this.page.locator(
        `${this.definition.root} .header-status, ${this.definition.root} .header-enabled`,
      );
      const control = await this.uniqueVisible(header.getByRole("combobox"), "Status filter");
      const before = await this.ids();
      await this.session.measure(`${this.id}.filter`, async () => {
        if (options === "all") {
          const clear = await this.uniqueVisible(
            header.locator(".Select-clear-zone"),
            "Status filter clear control",
          );
          await clear.click();
        } else {
          await control.fill(options);
          const item = await this.uniqueVisible(
            header.locator(".Select-option").filter({ hasText: new RegExp(`^${options}$`, "i") }),
            `${options} filter option`,
          );
          await item.click();
        }
        await this.until(
          async () => JSON.stringify(await this.ids()) !== JSON.stringify(before),
          "Status filter did not change rows; include enabled and disabled fixture mods",
        );
      });
      const profile = await this.session.call<{ modState: Record<string, { enabled?: boolean }> }>(
        "vortex_query",
        { selector: "activeProfile" },
      );
      const after = await this.ids();
      if (options !== "all")
        this.session.assert(
          after.length > 0 &&
            after.every((id) => profile.modState[id]?.enabled === (options === "enabled")),
          "Status filter displayed mods with incorrect enabled state",
        );
      this.session.evidence.push({ action: `${this.id}.filter`, value: options, before, after });
      return;
    }
    await this.action("filter", options, async () => {
      const control = await this.control(options.control);
      if ((await control.evaluate((element) => element.tagName.toLowerCase())) === "select")
        await control.selectOption(options.value);
      else await control.fill(options.value);
    });
  }
  async drag(options: DragOptions): Promise<void> {
    await this.action("drag", options, async () => {
      const source = await this.control(options.control);
      await source.dragTo(await this.control(options.target));
    });
  }
  async scroll(options: { ticks?: number; delta?: number; name?: string } = {}): Promise<void> {
    await this.open();
    const origin = await this.control(this.definition.scroller);
    // Tables in released builds can scroll an ancestor of table-main-pane.
    await origin.evaluate((node) => {
      let element: Element | null = node;
      while (
        element &&
        !(
          element.scrollHeight > element.clientHeight &&
          ["auto", "scroll", "overlay"].includes(getComputedStyle(element).overflowY)
        )
      )
        element = element.parentElement;
      if (element) element.setAttribute("data-benchmark-scroll", "active");
    });
    const scroller = await this.uniqueVisible(
      this.page.locator('[data-benchmark-scroll="active"]'),
      "actual table scroller",
    );
    const before = await scroller.evaluate((element) => element.scrollTop);
    const range = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
    if (range <= 0)
      throw new BenchmarkBlocked(`${this.id}: table has no scroll range; supply enough data`);
    const ticks = options.ticks ?? 20;
    const delta = options.delta ?? 400;
    if (!Number.isInteger(ticks) || ticks < 1 || !Number.isFinite(delta) || delta === 0)
      throw new Error("Scroll requires positive ticks and nonzero finite delta");
    if ((before <= 0 && delta < 0) || (before >= range - 1 && delta > 0))
      throw new BenchmarkBlocked(`${this.id}: scroll input points beyond table edge`);
    await this.session.measure(options.name ?? `${this.id}.scroll`, async () => {
      await scroller.hover();
      for (let tick = 0; tick < ticks; tick++) {
        await this.page.mouse.wheel(0, delta);
        await this.page.waitForTimeout(30);
      }
      await this.page.waitForFunction(
        ({ selector, position }) => document.querySelector(selector)?.scrollTop !== position,
        { selector: '[data-benchmark-scroll="active"]', position: before },
        { timeout: this.session.timeoutMs },
      );
      await this.page.waitForFunction(
        (selector) => {
          const rows = Array.from(document.querySelectorAll(selector)).filter((row) => {
            const b = row.getBoundingClientRect();
            return b.bottom > 0 && b.top < innerHeight;
          });
          return (
            rows.length > 0 &&
            rows.every((row) => row.children.length > 1 && row.textContent?.trim())
          );
        },
        this.definition.rows,
        { timeout: this.session.timeoutMs },
      );
    });
    this.session.evidence.push({
      action: `${this.id}.scroll`,
      before,
      after: await scroller.evaluate((element) => element.scrollTop),
      ticks,
      delta,
    });
    await scroller.evaluate((element) => element.removeAttribute("data-benchmark-scroll"));
  }
}
