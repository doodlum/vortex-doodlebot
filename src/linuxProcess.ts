import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

// Only the boolean leaves the host. As in the native scanner, argv is read only
// for a matching truncated comm, and is never returned or logged.
const HOST_PROCESS_PROBE = String.raw`
import errno, json, os, sys
if sys.version_info < (3, 10): raise SystemExit('Python 3.10 or newer is required')
image = sys.argv[1]
windows = image.lower().endswith(('.exe', '.bat', '.cmd'))
fold = (lambda value: value.lower()) if windows else (lambda value: value)
expected = image.encode()[:15].decode(errors='replace')
def running():
    for pid in os.listdir('/proc'):
        if not pid.isdecimal(): continue
        try:
            base = '/proc/' + pid
            with open(base + '/comm', encoding='utf-8', errors='replace') as stream:
                comm = stream.read().removesuffix('\n')
            matching = fold(comm) == fold(expected)
            if not matching and (windows or os.path.basename(os.readlink(base + '/exe')) != image):
                continue
            with open(base + '/stat', encoding='utf-8', errors='replace') as stream:
                status = stream.read()
            if status[status.rfind(')') + 2:].startswith('Z '): continue
            if not matching: return True
            if len(image.encode()) <= 15: return True
            with open(base + '/cmdline', 'rb') as stream:
                arguments = stream.read().decode(errors='replace').split('\0')
            if any(fold(arg.replace('\\', '/').rsplit('/', 1)[-1]) == fold(image) for arg in arguments):
                return True
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ESRCH, errno.EACCES, errno.EPERM): raise
    return False
print(json.dumps(running()))
`;

function hostProcessRunning(imageName: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const failed = (cause: unknown): void =>
      reject(
        new Error(
          "Could not inspect host processes from Flatpak. Check flatpak-spawn host access and Python 3.10 or newer.",
          { cause },
        ),
      );
    execFile(
      "flatpak-spawn",
      ["--host", "python3", "-c", HOST_PROCESS_PROBE, imageName],
      // A packaged renderer can run in /app/main, which does not exist on the host.
      { cwd: "/", encoding: "utf8", timeout: 5_000, maxBuffer: 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          failed(error);
          return;
        }
        const value = stdout.trim();
        if (value === "true" || value === "false") resolve(value === "true");
        else failed(new Error("Unexpected host process response"));
      },
    );
  });
}

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
  // Proton launched with --host is outside the application's PID namespace.
  // An unavailable host observer is not evidence that a game has stopped.
  if (process.env.IS_FLATPAK === "true" || process.env.FLATPAK_ID) {
    return hostProcessRunning(imageName);
  }
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
