import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class KeychainUnavailableError extends Error {
  constructor() {
    super("macOS Keychain is only available on macOS.");
    this.name = "KeychainUnavailableError";
  }
}

export async function savePassword(
  service: string,
  account: string,
  password: string,
): Promise<void> {
  ensureMacOS();

  await execFileAsync("security", [
    "add-generic-password",
    "-a",
    account,
    "-s",
    service,
    "-w",
    password,
    "-U",
  ]);
}

export async function readPassword(
  service: string,
  account: string,
): Promise<string | undefined> {
  ensureMacOS();

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a",
      account,
      "-s",
      service,
      "-w",
    ]);
    return stdout.trimEnd();
  } catch {
    return undefined;
  }
}

export async function deletePassword(
  service: string,
  account: string,
): Promise<void> {
  ensureMacOS();

  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-a",
      account,
      "-s",
      service,
    ]);
  } catch {
    return;
  }
}

function ensureMacOS(): void {
  if (process.platform !== "darwin") {
    throw new KeychainUnavailableError();
  }
}
