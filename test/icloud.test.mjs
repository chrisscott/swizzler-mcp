import { test } from "node:test";
import assert from "node:assert/strict";
import { parseICloudDriveState, missingSnapshotGuidance } from "../dist/icloud.js";

const account = (services, loggedIn = 1) => ({ Accounts: [{ LoggedIn: loggedIn, Services: services }] });

test("reports off when iCloud Drive is explicitly disabled", () => {
  const parsed = account([{ Name: "MOBILE_DOCUMENTS", Enabled: 0 }]);
  assert.equal(parseICloudDriveState(parsed), "off");
  assert.equal(parseICloudDriveState(account([{ Name: "MOBILE_DOCUMENTS", Enabled: false }])), "off");
});

test("reports on when enabled, including when the flag is omitted", () => {
  assert.equal(parseICloudDriveState(account([{ Name: "MOBILE_DOCUMENTS", Enabled: 1 }])), "on");
  assert.equal(parseICloudDriveState(account([{ Name: "MOBILE_DOCUMENTS", Enabled: true }])), "on");
  // Enabled services sometimes omit the key; assuming "off" there would misdiagnose.
  assert.equal(parseICloudDriveState(account([{ Name: "MOBILE_DOCUMENTS" }])), "on");
});

test("distinguishes signed out from unknown", () => {
  assert.equal(parseICloudDriveState({ Accounts: [] }), "signed-out");
  assert.equal(parseICloudDriveState({}), "signed-out");
  assert.equal(parseICloudDriveState(account([{ Name: "MOBILE_DOCUMENTS", Enabled: 0 }], 0)), "signed-out");
  // Signed in, but the service isn't listed at all.
  assert.equal(parseICloudDriveState(account([{ Name: "PHOTO_STREAM", Enabled: 1 }])), "unknown");
});

test("survives junk without claiming iCloud Drive is off", () => {
  for (const junk of [null, undefined, 42, "nope", { Accounts: "no" }]) {
    assert.notEqual(parseICloudDriveState(junk), "off");
  }
});

test("guidance names the actual problem for each state", async () => {
  const off = await missingSnapshotGuidance("/tmp/x.swizzle", "off");
  assert.match(off, /iCloud Drive is turned off on this Mac/);
  assert.match(off, /System Settings/);

  const signedOut = await missingSnapshotGuidance("/tmp/x.swizzle", "signed-out");
  assert.match(signedOut, /not signed in to iCloud/);

  const on = await missingSnapshotGuidance("/tmp/x.swizzle", "on");
  assert.match(on, /Share with Claude/);
  assert.doesNotMatch(on, /turned off on this Mac/);

  for (const body of [off, signedOut, on]) {
    assert.match(body, /No Swizzler library snapshot at \/tmp\/x\.swizzle/);
  }
});

// --- Bundle path resolution ---
import { resolveConfiguredPath, DEFAULT_SNAPSHOT_PATH } from "../dist/library.js";

test("falls back to the default path for unset or un-substituted config", () => {
  for (const unset of [undefined, "", "   "]) {
    assert.equal(resolveConfiguredPath(unset), DEFAULT_SNAPSHOT_PATH);
  }
  // A host that leaves an optional placeholder unsubstituted must not send us chasing it.
  assert.equal(resolveConfiguredPath("${user_config.library_path}"), DEFAULT_SNAPSHOT_PATH);
});

test("honours a real configured path", () => {
  assert.equal(resolveConfiguredPath("/tmp/custom.swizzle"), "/tmp/custom.swizzle");
  assert.equal(resolveConfiguredPath("  /tmp/spaced.swizzle  "), "/tmp/spaced.swizzle");
});
