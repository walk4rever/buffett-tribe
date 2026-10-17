import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

export type ProcessGroupResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  output: string;
};

export type RunProcessGroupOptions = SpawnOptions & {
  signal?: AbortSignal;
  forceKillAfterMs?: number;
  inheritStdio?: boolean;
};

const activeChildPids = new Set<number>();

function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      try {
        process.kill(pid, signal);
      } catch {
        // The process may have exited between the group and process signals.
      }
    }
  }
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function terminateActiveProcessGroups(graceMs = 1_500): Promise<void> {
  const pids = [...activeChildPids];
  if (pids.length === 0) return;

  for (const pid of pids) {
    signalProcessGroup(pid, "SIGTERM");
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const alive = pids.some((pid) => isProcessGroupAlive(pid));
    if (!alive) {
      for (const pid of pids) activeChildPids.delete(pid);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  for (const pid of pids) {
    if (isProcessGroupAlive(pid)) {
      signalProcessGroup(pid, "SIGKILL");
    }
    activeChildPids.delete(pid);
  }
}

export function runProcessGroup(
  command: string,
  args: string[],
  options: RunProcessGroupOptions = {},
): Promise<ProcessGroupResult> {
  const { signal, forceKillAfterMs = 10_000, inheritStdio = false, ...spawnOptions } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) {
      activeChildPids.add(child.pid);
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const clearShutdownHooks = () => {
      if (child.pid) {
        activeChildPids.delete(child.pid);
      }
      signal?.removeEventListener("abort", onAbort);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const terminateGroup = () => {
      if (!child.pid || settled) return;
      signalProcessGroup(child.pid, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.pid && !settled) signalProcessGroup(child.pid, "SIGKILL");
      }, forceKillAfterMs);
      forceKillTimer.unref();
    };

    const onAbort = () => terminateGroup();
    if (signal?.aborted) {
      terminateGroup();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (inheritStdio) {
        process.stdout.write(chunk);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (inheritStdio) {
        process.stderr.write(chunk);
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearShutdownHooks();
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      if (settled) return;
      settled = true;
      clearShutdownHooks();
      resolve({
        exitCode: code ?? 1,
        signal: childSignal,
        output: stdout + (stderr ? `\n${stderr}` : ""),
      });
    });
  });
}
