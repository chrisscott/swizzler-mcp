import { execFile } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type ICloudDriveState = "on" | "off" | "signed-out" | "unknown";

interface MobileMeService {
  Name?: string;
  Enabled?: boolean | number;
}

interface MobileMeAccount {
  LoggedIn?: boolean | number;
  AccountID?: string;
  Services?: MobileMeService[];
}

interface MobileMeAccounts {
  Accounts?: MobileMeAccount[];
}

function isTruthyFlag(value: boolean | number | undefined): boolean {
  return value === true || value === 1;
}

/**
 * Kept pure so the branch that matters — iCloud Drive explicitly disabled — is testable
 * without depending on how the machine running the tests happens to be configured.
 *
 * Only reports "off" when the flag is positively disabled. Enabled services sometimes omit
 * the key entirely, and a false "iCloud Drive is off" would send users chasing the wrong
 * problem, which is exactly what this check exists to prevent.
 */
export function parseICloudDriveState(parsed: unknown): ICloudDriveState {
  const accounts = (parsed as MobileMeAccounts)?.Accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) return "signed-out";

  const account = accounts.find((candidate) => isTruthyFlag(candidate.LoggedIn));
  if (!account) return "signed-out";

  const drive = account.Services?.find((service) => service.Name === "MOBILE_DOCUMENTS");
  if (!drive) return "unknown";

  return drive.Enabled === false || drive.Enabled === 0 ? "off" : "on";
}

/** macOS only; anywhere else this can't be determined and says so. */
export async function iCloudDriveState(): Promise<ICloudDriveState> {
  if (platform() !== "darwin") return "unknown";

  const plist = join(homedir(), "Library/Preferences/MobileMeAccounts.plist");
  try {
    const { stdout } = await run("plutil", ["-convert", "json", "-o", "-", plist], {
      timeout: 5_000,
    });
    return parseICloudDriveState(JSON.parse(stdout));
  } catch {
    return "unknown";
  }
}

/**
 * The three ways this can fail look identical from the file system — an absent file — but
 * need completely different fixes, so name the one that actually applies.
 */
export async function missingSnapshotGuidance(
  path: string,
  state?: ICloudDriveState,
): Promise<string> {
  const resolved = state ?? (await iCloudDriveState());
  const lines = [`No Swizzler library snapshot at ${path}.`, ""];

  switch (resolved) {
    case "off":
      lines.push(
        "iCloud Drive is turned off on this Mac, so nothing syncs down from Swizzler at all.",
        "",
        "Turn it on in System Settings > [your name] > iCloud > iCloud Drive. Then open",
        'Swizzler on your iPhone, check Settings > AI Assistants > "Share Library" is on,',
        "and background the app to republish.",
      );
      break;

    case "signed-out":
      lines.push(
        "This Mac is not signed in to iCloud, so the Swizzler folder cannot sync here.",
        "",
        "Sign in with the same Apple Account as your iPhone in System Settings, and make sure",
        "iCloud Drive is enabled.",
      );
      break;

    default:
      lines.push(
        'In Swizzler on your iPhone or iPad, open Settings and turn on "Share Library"',
        "under AI Assistants. The status row there reports what the last publish did.",
        "",
        "If it is already on, background the app to force a publish and give iCloud a minute.",
      );
      break;
  }

  return lines.join("\n");
}
