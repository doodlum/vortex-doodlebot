import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";

/** Match Linux's comm field, checking full argv for names truncated at 15 bytes. */
export function linuxProcessMatches(imageName: string, comm: string, cmdline: string): boolean {
  const fold = /\.(exe|bat|cmd)$/i.test(imageName)
    ? (value: string): string => value.toLowerCase()
    : (value: string): string => value;
  const expectedComm = Buffer.from(imageName).subarray(0, 15).toString("utf8");
  if (fold(comm) !== fold(expectedComm)) return false;
  if (Buffer.byteLength(imageName) <= 15) return true;
  return cmdline.split("\0").some((argument) => {
    const basename = argument.replace(/\\/g, "/").split("/").at(-1);
    return basename !== undefined && fold(basename) === fold(imageName);
  });
}

/** Read only matching processes' argv; do not retain or log process arguments. */
export async function linuxProcessRunning(imageName: string): Promise<boolean> {
  const expected = Buffer.from(imageName).subarray(0, 15).toString("utf8");
  const windows = /\.(exe|bat|cmd)$/i.test(imageName);
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const comm = (await readFile(`/proc/${pid}/comm`, "utf8")).replace(/\n$/, "");
      const matchingComm =
        (windows ? comm.toLowerCase() : comm) === (windows ? expected.toLowerCase() : expected);
      // Native programs can rename their main thread (Node reports MainThread).
      // Their executable identity remains available independently of comm/argv.
      if (
        !matchingComm &&
        (windows || path.basename(await readlink(`/proc/${pid}/exe`)) !== imageName)
      )
        continue;
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ")) continue;
      if (!matchingComm) return true;
      const cmdline =
        Buffer.byteLength(imageName) > 15 ? await readFile(`/proc/${pid}/cmdline`, "utf8") : "";
      if (linuxProcessMatches(imageName, comm, cmdline)) return true;
    } catch (error) {
      if (
        !["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
  }
  return false;
}
