// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeDialogs,
  click,
  snapshot,
  type ClickOptions,
  type SnapshotOptions,
} from "../../src/uiAutomation";
import { confirmCollectionProfile } from "./collections";
import type { VortexMcpClient } from "./mcpClient";

const question = "Do you want to switch to this profile?";
const instructions = "Long curator instructions. ".repeat(30);

function modal(
  id: string,
  bodyQuestion: string,
  prose = instructions,
  footer = "<button>No</button><button>Yes</button>",
): string {
  return `<div role="dialog" class="modal in" id="${id}"><div class="modal-dialog"><div class="modal-content">
    <div class="modal-header"><h4 class="modal-title">Skyrim Special Edition collection added</h4></div>
    <div class="modal-body"><div class="textarea-install-collection-instructions"><p>${prose}</p></div>
      <p>${bodyQuestion}</p><label><input type="checkbox" checked>Install mods during collection downloads</label></div>
    <div class="modal-footer">${footer}</div></div></div></div>`;
}

function client(beforeClick?: (options: ClickOptions) => void): {
  mcp: VortexMcpClient;
  clicked: string[];
  calls: string[];
} {
  const clicked: string[] = [];
  const calls: string[] = [];
  for (const el of Array.from(document.querySelectorAll("button"))) {
    el.addEventListener("click", () => {
      clicked.push(`${el.closest('[role="dialog"]')?.id}:${el.textContent}`);
      el.closest('[role="dialog"]')?.remove();
    });
  }
  const mcp = {
    call: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "ui_active_dialogs") return activeDialogs();
      if (name === "ui_snapshot") {
        expect(args.selector).toBeDefined();
        return snapshot(args as SnapshotOptions);
      }
      if (name === "ui_click") {
        beforeClick?.(args as ClickOptions);
        return click(args as ClickOptions);
      }
      throw new Error(`Unexpected tool ${name}`);
    },
  } as unknown as VortexMcpClient;
  return { mcp, clicked, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
    () => [{ width: 1, height: 1 } as DOMRect] as unknown as DOMRectList,
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100,
    height: 30,
    left: 0,
    top: 0,
    right: 100,
    bottom: 30,
  } as DOMRect);
});

describe("curated collection profile confirmation", () => {
  it("answers the app question beyond a truncated summary and keeps checkbox defaults", async () => {
    document.body.innerHTML = modal("profile", question);
    const checkbox = document.querySelector("input") as HTMLInputElement;
    expect(activeDialogs()[0]).not.toContain(question);
    const { mcp, clicked } = client();
    expect(await confirmCollectionProfile(mcp)).toHaveLength(1);
    expect(clicked).toEqual(["profile:Yes"]);
    expect(checkbox.checked).toBe(true);
  });

  it.each([`Quoted curator text: ${question}`, question])(
    "rejects a curator question when the app asks to delete instead: %s",
    async (prose) => {
      document.body.innerHTML = modal("delete", "Do you want to delete this profile?", prose);
      const { mcp, clicked } = client();
      expect(await confirmCollectionProfile(mcp)).toEqual([]);
      expect(clicked).toEqual([]);
    },
  );

  it("clicks the validated modal when stacked summaries share the same prefix", async () => {
    document.body.innerHTML =
      modal("delete", "Do you want to delete this profile?") + modal("profile", question);
    expect(activeDialogs()).toHaveLength(1);
    const { mcp, clicked } = client();
    expect(await confirmCollectionProfile(mcp)).toHaveLength(1);
    expect(clicked).toEqual(["profile:Yes"]);
    expect(document.getElementById("delete")).not.toBeNull();
  });

  it.each(["nested", "hidden", "hidden-body"])(
    "rejects a matching question outside the visible app body: %s",
    async (mode) => {
      document.body.innerHTML = modal(
        "delete",
        "Delete this profile?",
        mode === "nested" ? `<div class="modal-body"><p>${question}</p></div>` : instructions,
      );
      if (mode === "hidden")
        document
          .querySelector(".modal-content > .modal-body")
          ?.insertAdjacentHTML("beforeend", `<p style="display:none">${question}</p>`);
      if (mode === "hidden-body") {
        const body = document.querySelector(".modal-content > .modal-body") as HTMLElement;
        (body.querySelector(":scope > p") as Element).textContent = question;
        body.style.display = "none";
      }
      const { mcp, clicked } = client();
      expect(await confirmCollectionProfile(mcp)).toEqual([]);
      expect(clicked).toEqual([]);
    },
  );

  it.each(["replace", "reuse"])("rejects a dialog changed after the snapshot: %s", async (mode) => {
    document.body.innerHTML = modal("profile", question);
    const { mcp, clicked } = client(() => {
      if (mode === "replace") document.body.innerHTML = modal("delete", "Delete this profile?");
      else
        (document.querySelector(".modal-body > p") as Element).textContent = "Delete this profile?";
    });
    if (mode === "replace")
      await expect(confirmCollectionProfile(mcp)).rejects.toThrow("removed from the DOM");
    else expect(await confirmCollectionProfile(mcp)).toEqual([]);
    expect(clicked).toEqual([]);
  });

  it.each([
    "<button>No</button><button disabled>Yes</button>",
    "<button>No</button><button>Yes</button><button>Yes</button>",
    "<button>Yes</button>",
  ])("rejects a disabled or ambiguous footer: %s", async (footer) => {
    document.body.innerHTML = modal("profile", question, instructions, footer);
    const { mcp, clicked } = client();
    expect(await confirmCollectionProfile(mcp)).toEqual([]);
    expect(clicked).toEqual([]);
  });
});
