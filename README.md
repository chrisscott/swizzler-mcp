# swizzler-mcp

An MCP server that lets Claude read your Swizzler cocktail library — search recipes,
pull up a spec, work out what you can make from the bottles on your shelf, and look at
what you've actually been drinking.

Read-only. Nothing here can change your library.

## How it works

Swizzler stores recipes on-device in SwiftData, synced through your private CloudKit
database. Neither of those is reachable from a desktop MCP server, so the app publishes a
snapshot instead: turn on **Settings → Claude Access → Share with Claude**, and Swizzler
writes a photo-free copy of your library to its own iCloud Drive folder. This server reads
that file from your Mac.

```
iPhone/iPad ──SwiftData──> private CloudKit  (app's own sync, untouched)
     │
     └──snapshot──> iCloud Drive/Swizzler/Library.swizzle ──> swizzler-mcp ──> Claude
```

### Freshness

The snapshot only refreshes while Swizzler is running — it rewrites on every edit and when
the app goes to the background. In practice that covers the single-device case completely,
because your library can only change while the app is open in front of you.

Where it can lag is multi-device: edit on your iPad, then ask Claude on your Mac without
opening Swizzler on any device that has synced. So **every tool result states the
snapshot's age**, and past 24 hours it says so with a warning rather than answering as if
the data were current. Ask Claude to check `snapshot_status` any time you want to know.

## Install as a bundle (Claude Desktop)

```bash
npm install
npm run bundle      # produces swizzler.mcpb
```

Double-click `swizzler.mcpb` to install it in Claude Desktop — no Node setup, no config
file editing, and it survives moving the repo.

The bundle ships as a single esbuild-produced file rather than a packed `node_modules`.
MCPB has no install step on the user's machine, so dependencies have to travel with it,
and the MCP SDK pulls in express, hono, and jose — HTTP transport code a stdio server
never touches. Bundling takes it from ~24 MB across 3,500 files to **194 KB in two**.

`npm run test:bundle` runs the full end-to-end suite against the bundled entry point, so
what ships is what's tested.

To distribute it to anyone else, sign it first (`mcpb sign`); unsigned bundles install
with a warning.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

Then register it with Claude Code:

```bash
claude mcp add swizzler -- node /absolute/path/to/mcp-server/dist/index.js
```

Once published to npm, that becomes a one-liner needing no checkout at all:

```bash
claude mcp add swizzler -- npx -y swizzler-mcp
codex mcp add swizzler -- npx -y swizzler-mcp
```

Or, if you would rather not use the bundle, add it to Claude Desktop's
`claude_desktop_config.json` by hand:

```json
{
  "mcpServers": {
    "swizzler": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"]
    }
  }
}
```

By default it reads:

```
~/Library/Mobile Documents/iCloud~com~getswizzler~app/Documents/Library.swizzle
```

Set `SWIZZLER_LIBRARY_PATH` to point somewhere else.

## Tools

| Tool | What it answers |
|---|---|
| `snapshot_status` | How current is this data, and where did it come from? |
| `diagnose_sync` | Why are recipes missing or stale? Checks iCloud Drive on this Mac. |
| `search_recipes` | By name, ingredient, spirit, collection, or favourites |
| `get_recipe` | The full spec for one drink |
| `whats_next` | The Next Round queue — what you've lined up to make |
| `list_collections` | Your collections and their sizes |
| `what_can_i_make` | Given these bottles, what's within reach (and what's missing)? |
| `recipe_history` | What you've actually made, how often, and how you rated it |

### Smart collections

Smart collections have no stored membership — the app evaluates their rules at query time.
The snapshot resolves them into concrete memberships before writing, so the rule engine
stays in Swift rather than being reimplemented here and drifting. Backup exports keep them
as rules, so re-importing restores a smart collection rather than freezing today's matches.

## Tests

```bash
npm test
```

Drives the built server over stdio with a real MCP client against fixture libraries,
covering search, detail rendering, staleness warnings, and the missing-snapshot path.

## Troubleshooting

**"No Swizzler library snapshot at …"** — Check three things, in this order:

1. **iCloud Drive is on for this Mac.** System Settings → your name → iCloud → iCloud Drive.
   If it is off, nothing syncs down at all and `~/Library/Mobile Documents/` will hold only
   an empty `com~apple~CloudDocs`. To check from a terminal:

   ```bash
   defaults read MobileMeAccounts | grep -A2 MOBILE_DOCUMENTS
   ```

   `Enabled = 0` means iCloud Drive is off.

2. **Sharing is on in the app.** Settings → Claude Access → Share with Claude. The status
   row underneath reports what the last write actually did.

3. **The snapshot has been published since you turned it on.** Background the app to force
   a write, then give iCloud a minute.

**The Swizzler folder doesn't appear in Finder** — iOS caches the `NSUbiquitousContainers`
key, so the folder sometimes only shows up after the app's build number changes.

**Recipes look out of date** — Open Swizzler on the device you last edited on. The
snapshot is republished when the app backgrounds.
