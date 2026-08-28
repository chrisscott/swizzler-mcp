import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Overridable so the same suite can verify the esbuild bundle that ships in the .mcpb,
// not just the plain tsc output.
const serverPath =
  process.env.SWIZZLER_MCP_ENTRY ?? fileURLToPath(new URL("../dist/index.js", import.meta.url));
let workDir;

function libraryDocument(exportedAt) {
  return {
    version: 1,
    type: "library",
    stamp: {
      generation: 3,
      deviceID: "device-1",
      deviceModel: "iPhone",
      exportedAt,
      maxDateModified: exportedAt,
      recipeCount: 3,
      collectionCount: 1,
    },
    library: {
      recipes: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Daiquiri",
          spiritCategory: "rum",
          glassware: "coupe",
          isFavorite: true,
          ingredients: [
            { name: "White Rum", quantity: 2, unit: "oz", sortOrder: 0 },
            { name: "Lime Juice", quantity: 1, unit: "oz", sortOrder: 1 },
            { name: "Simple Syrup", quantity: 0.5, unit: "oz", sortOrder: 2 },
          ],
          instructions: [{ stepNumber: 1, text: "Shake with ice and strain." }],
          history: [
            { date: new Date(Date.now() - 86400000).toISOString(), rating: 5 },
            { date: new Date(Date.now() - 172800000).toISOString(), rating: 4 },
          ],
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          name: "Negroni",
          spiritCategory: "gin",
          isNextRound: true,
          ingredients: [
            { name: "Gin", quantity: 1, unit: "oz", sortOrder: 0 },
            { name: "Campari", quantity: 1, unit: "oz", sortOrder: 1 },
            { name: "Sweet Vermouth", quantity: 1, unit: "oz", sortOrder: 2 },
          ],
          instructions: [{ stepNumber: 1, text: "Stir and strain over ice." }],
        },
        {
          id: "33333333-3333-3333-3333-333333333333",
          name: "Margarita",
          spiritCategory: "tequila",
          isNextRound: true,
          ingredients: [
            { name: "Tequila", quantity: 2, unit: "oz", sortOrder: 0 },
            { name: "Lime Juice", quantity: 1, unit: "oz", sortOrder: 1 },
            { name: "Cointreau", quantity: 1, unit: "oz", sortOrder: 2 },
          ],
          instructions: [{ stepNumber: 1, text: "Shake and strain." }],
        },
      ],
      collections: [
        { id: "c1", name: "Summer", icon: "sun.max", color: "yellow", recipes: [] },
      ],
      memberships: [
        { collectionName: "Summer", recipeName: "Daiquiri", sortOrder: 0 },
        { collectionName: "Summer", recipeName: "Margarita", sortOrder: 1 },
      ],
    },
  };
}

async function connect(libraryPath) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...process.env, SWIZZLER_LIBRARY_PATH: libraryPath },
    }),
  );
  return client;
}

function textOf(result) {
  return result.content.map((block) => block.text).join("\n");
}

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "swizzler-mcp-"));
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("exposes the expected tools", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "diagnose_sync",
    "get_recipe",
    "list_collections",
    "recipe_history",
    "search_recipes",
    "snapshot_status",
    "what_can_i_make",
    "whats_next",
  ]);

  await client.close();
});

test("reports snapshot contents and a fresh age", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const body = textOf(await client.callTool({ name: "snapshot_status", arguments: {} }));
  assert.match(body, /Recipes: 3/);
  assert.match(body, /Collections: 1/);
  assert.match(body, /Published by: iPhone/);
  assert.match(body, /Snapshot published/);
  assert.doesNotMatch(body, /\[!\]/);

  await client.close();
});

test("warns loudly when the snapshot is stale", async () => {
  const path = join(workDir, "stale.swizzle");
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  writeFileSync(path, JSON.stringify(libraryDocument(threeDaysAgo)));
  const client = await connect(path);

  const body = textOf(await client.callTool({ name: "snapshot_status", arguments: {} }));
  assert.match(body, /\[!\]/);
  assert.match(body, /3 days ago/);
  assert.match(body, /may be out of date/);

  await client.close();
});

test("searches by ingredient, spirit and collection", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const byIngredient = textOf(
    await client.callTool({ name: "search_recipes", arguments: { ingredient: "lime" } }),
  );
  assert.match(byIngredient, /Daiquiri/);
  assert.match(byIngredient, /Margarita/);
  assert.doesNotMatch(byIngredient, /Negroni/);

  const bySpirit = textOf(
    await client.callTool({ name: "search_recipes", arguments: { spirit: "gin" } }),
  );
  assert.match(bySpirit, /Negroni/);
  assert.doesNotMatch(bySpirit, /Daiquiri/);

  const byCollection = textOf(
    await client.callTool({ name: "search_recipes", arguments: { collection: "Summer" } }),
  );
  assert.match(byCollection, /Daiquiri/);
  assert.doesNotMatch(byCollection, /Negroni/);

  await client.close();
});

test("returns full recipe detail and suggests near misses", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const detail = textOf(await client.callTool({ name: "get_recipe", arguments: { name: "Daiquiri" } }));
  assert.match(detail, /# Daiquiri/);
  assert.match(detail, /2 oz White Rum/);
  assert.match(detail, /1\/2 oz Simple Syrup/);
  assert.match(detail, /Shake with ice/);
  assert.match(detail, /Collections: Summer/);
  assert.match(detail, /average rating 4\.5\/5/);

  const missing = textOf(await client.callTool({ name: "get_recipe", arguments: { name: "Sazerac" } }));
  assert.match(missing, /No recipe called "Sazerac"/);

  await client.close();
});

test("finds what can be made from ingredients on hand", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const exact = textOf(
    await client.callTool({
      name: "what_can_i_make",
      arguments: { ingredients: ["white rum", "lime juice", "simple syrup"] },
    }),
  );
  assert.match(exact, /Daiquiri — you have everything/);
  assert.doesNotMatch(exact, /Negroni/);

  const nearMiss = textOf(
    await client.callTool({
      name: "what_can_i_make",
      arguments: { ingredients: ["gin", "campari"], allowMissing: 1 },
    }),
  );
  assert.match(nearMiss, /Negroni — missing Sweet Vermouth/);

  await client.close();
});

test("lists what is queued up next", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const body = textOf(await client.callTool({ name: "whats_next", arguments: {} }));
  assert.match(body, /2 recipes queued up next/);
  assert.match(body, /Negroni/);
  assert.match(body, /Margarita/);
  assert.doesNotMatch(body, /Daiquiri/);
  assert.match(body, /next round/);

  await client.close();
});

test("search can filter to the Next Round queue", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const body = textOf(
    await client.callTool({ name: "search_recipes", arguments: { nextRoundOnly: true, spirit: "gin" } }),
  );
  assert.match(body, /Negroni/);
  assert.doesNotMatch(body, /Margarita/);

  const detail = textOf(await client.callTool({ name: "get_recipe", arguments: { name: "Negroni" } }));
  assert.match(detail, /Queued in Next Round/);

  await client.close();
});

test("says so plainly when the queue is empty", async () => {
  const path = join(workDir, "empty-queue.swizzle");
  const doc = libraryDocument(new Date().toISOString());
  for (const recipe of doc.library.recipes) delete recipe.isNextRound;
  writeFileSync(path, JSON.stringify(doc));
  const client = await connect(path);

  const body = textOf(await client.callTool({ name: "whats_next", arguments: {} }));
  assert.match(body, /Nothing is flagged Next Round/);
  assert.match(body, /tap the arrow button/);

  await client.close();
});

test("summarises what has actually been made", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const body = textOf(await client.callTool({ name: "recipe_history", arguments: {} }));
  assert.match(body, /Daiquiri — made 2x, avg 4\.5\/5/);
  assert.doesNotMatch(body, /Negroni/);

  await client.close();
});

test("explains why there is no snapshot", async () => {
  const client = await connect(join(workDir, "does-not-exist.swizzle"));

  const result = await client.callTool({ name: "search_recipes", arguments: {} });
  assert.equal(result.isError, true);
  const body = textOf(result);
  assert.match(body, /No Swizzler library snapshot at/);
  assert.match(body, /does-not-exist\.swizzle/);
  // Whichever branch fires, it must tell the user somewhere concrete to go.
  assert.match(body, /iCloud|Share with Claude/);

  await client.close();
});

test("diagnose_sync reports iCloud Drive state alongside the snapshot", async () => {
  const path = join(workDir, "fresh.swizzle");
  writeFileSync(path, JSON.stringify(libraryDocument(new Date().toISOString())));
  const client = await connect(path);

  const body = textOf(await client.callTool({ name: "diagnose_sync", arguments: {} }));
  assert.match(body, /iCloud Drive:/);
  assert.match(body, /Snapshot: found at/);
  assert.match(body, /Recipes: 3/);

  await client.close();
});

test("diagnose_sync still answers when the snapshot is missing", async () => {
  const client = await connect(join(workDir, "absent.swizzle"));

  const result = await client.callTool({ name: "diagnose_sync", arguments: {} });
  // Diagnosing is the whole job here, so this is a successful answer, not an error.
  assert.notEqual(result.isError, true);
  const body = textOf(result);
  assert.match(body, /iCloud Drive:/);
  assert.match(body, /No Swizzler library snapshot at/);

  await client.close();
});
