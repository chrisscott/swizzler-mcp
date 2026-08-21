#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  freshnessNote,
  loadSnapshot,
  snapshotPath,
  SnapshotUnavailableError,
  describeAge,
  type Snapshot,
} from "./library.js";
import {
  averageRating,
  looselyMatches,
  renderRecipe,
  summariseRecipe,
  timesMade,
} from "./format.js";
import type { TransferRecipe } from "./types.js";

const server = new McpServer({ name: "swizzler", version: "0.1.0" });

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

/**
 * Every tool answers from the snapshot and states its age. Reporting staleness is the
 * whole reason this reads cleanly offline — the alternative is confidently wrong answers.
 */
async function withSnapshot(handler: (snapshot: Snapshot) => string): Promise<ToolResult> {
  try {
    const snapshot = await loadSnapshot();
    return text(handler(snapshot) + freshnessNote(snapshot));
  } catch (error) {
    if (error instanceof SnapshotUnavailableError) return text(error.message, true);
    throw error;
  }
}

function findRecipe(snapshot: Snapshot, query: string): TransferRecipe | undefined {
  const recipes = snapshot.library.recipes;
  return (
    recipes.find((r) => r.id === query) ??
    recipes.find((r) => r.name.toLowerCase() === query.toLowerCase()) ??
    recipes.find((r) => looselyMatches(r.name, query))
  );
}

server.registerTool(
  "snapshot_status",
  {
    title: "Snapshot status",
    description:
      "Report how current the local Swizzler library snapshot is, and where it came from. " +
      "Use this when the user asks whether their recipes are up to date, or when a recipe " +
      "they expect seems to be missing.",
    inputSchema: {},
  },
  async () =>
    withSnapshot((snapshot) => {
      const { library, stamp } = snapshot;
      const lines = [
        `Recipes: ${library.recipes.length}`,
        `Collections: ${library.collections.length}`,
        `File: ${snapshot.path}`,
      ];
      if (stamp) {
        lines.push(
          `Published by: ${stamp.deviceModel}`,
          `Snapshot generation: ${stamp.generation}`,
        );
        if (stamp.maxDateModified) {
          lines.push(
            `Most recent recipe edit: ${describeAge(Date.now() - new Date(stamp.maxDateModified).getTime())}`,
          );
        }
      } else {
        lines.push("No stamp present — this file predates snapshot metadata.");
      }
      return lines.join("\n");
    }),
);

server.registerTool(
  "search_recipes",
  {
    title: "Search recipes",
    description:
      "Search the user's own cocktail library by name, ingredient, spirit, or collection. " +
      "Returns one line per match. Omit every filter to list the whole library.",
    inputSchema: {
      query: z.string().optional().describe("Free text matched against recipe names and keywords"),
      ingredient: z.string().optional().describe('Ingredient the recipe must contain, e.g. "mezcal"'),
      spirit: z.string().optional().describe('Base spirit category, e.g. "gin", "rum"'),
      collection: z.string().optional().describe("Only recipes in this collection"),
      favouritesOnly: z.boolean().optional().describe("Restrict to favourites"),
      limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
    },
  },
  async ({ query, ingredient, spirit, collection, favouritesOnly, limit }) =>
    withSnapshot((snapshot) => {
      const { recipes, memberships } = snapshot.library;

      const inCollection = collection
        ? new Set(
            memberships
              .filter((m) => looselyMatches(m.collectionName, collection))
              .map((m) => m.recipeName.toLowerCase()),
          )
        : undefined;

      const matches = recipes.filter((recipe) => {
        if (query) {
          const haystack = [recipe.name, ...(recipe.keywords ?? []), recipe.description ?? ""].join(" ");
          if (!looselyMatches(haystack, query)) return false;
        }
        if (ingredient && !recipe.ingredients.some((i) => looselyMatches(i.name, ingredient))) {
          return false;
        }
        if (spirit && !(recipe.spiritCategory && looselyMatches(recipe.spiritCategory, spirit))) {
          return false;
        }
        if (inCollection && !inCollection.has(recipe.name.toLowerCase())) return false;
        if (favouritesOnly && !recipe.isFavorite) return false;
        return true;
      });

      if (matches.length === 0) {
        return `No recipes matched. The library holds ${recipes.length} recipes.`;
      }

      const capped = matches.slice(0, limit ?? 50);
      const header =
        capped.length < matches.length
          ? `${matches.length} matches, showing ${capped.length}:`
          : `${matches.length} match${matches.length === 1 ? "" : "es"}:`;

      return [header, "", ...capped.map((r) => `- ${summariseRecipe(r)}`)].join("\n");
    }),
);

server.registerTool(
  "get_recipe",
  {
    title: "Get recipe",
    description: "Full details for one recipe in the user's library, by name or id.",
    inputSchema: { name: z.string().describe("Recipe name or id") },
  },
  async ({ name }) =>
    withSnapshot((snapshot) => {
      const recipe = findRecipe(snapshot, name);
      if (!recipe) {
        const near = snapshot.library.recipes
          .filter((r) => looselyMatches(r.name, name.split(" ")[0] ?? name))
          .slice(0, 5)
          .map((r) => r.name);
        return near.length > 0
          ? `No recipe called "${name}". Did you mean: ${near.join(", ")}?`
          : `No recipe called "${name}" in the library.`;
      }
      return renderRecipe(recipe, snapshot.library);
    }),
);

server.registerTool(
  "list_collections",
  {
    title: "List collections",
    description: "List the user's recipe collections and how many recipes each holds.",
    inputSchema: {},
  },
  async () =>
    withSnapshot((snapshot) => {
      const { collections, memberships } = snapshot.library;
      if (collections.length === 0) return "No collections yet.";

      return collections
        .map((collection) => {
          const count = memberships.filter((m) => m.collectionName === collection.name).length;
          const kind = collection.isSmartCollection ? " (smart)" : "";
          return `- ${collection.name}${kind}: ${count} recipe${count === 1 ? "" : "s"}`;
        })
        .join("\n");
    }),
);

server.registerTool(
  "what_can_i_make",
  {
    title: "What can I make",
    description:
      "Given the bottles and ingredients the user has on hand, find recipes they can make. " +
      "Set allowMissing above 0 to include near-misses and see what is missing.",
    inputSchema: {
      ingredients: z.array(z.string()).min(1).describe("Ingredients on hand"),
      allowMissing: z
        .number()
        .int()
        .min(0)
        .max(3)
        .optional()
        .describe("How many ingredients may be missing (default 0)"),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ ingredients, allowMissing, limit }) =>
    withSnapshot((snapshot) => {
      const budget = allowMissing ?? 0;

      const scored = snapshot.library.recipes
        .map((recipe) => {
          const missing = recipe.ingredients
            .filter((needed) => !ingredients.some((have) => looselyMatches(needed.name, have)))
            .map((needed) => needed.name);
          return { recipe, missing };
        })
        .filter((entry) => entry.missing.length <= budget)
        .sort((a, b) => a.missing.length - b.missing.length || a.recipe.name.localeCompare(b.recipe.name));

      if (scored.length === 0) {
        return budget === 0
          ? "Nothing in the library can be made from exactly those ingredients. Try allowMissing: 1."
          : `Nothing matched within ${budget} missing ingredient${budget === 1 ? "" : "s"}.`;
      }

      const capped = scored.slice(0, limit ?? 25);
      return [
        `${scored.length} recipe${scored.length === 1 ? "" : "s"} within reach:`,
        "",
        ...capped.map(({ recipe, missing }) =>
          missing.length === 0
            ? `- ${recipe.name} — you have everything`
            : `- ${recipe.name} — missing ${missing.join(", ")}`,
        ),
      ].join("\n");
    }),
);

server.registerTool(
  "recipe_history",
  {
    title: "Recipe history",
    description:
      'What the user has actually made and how they rated it, from their "Made It" history. ' +
      "Use for questions like what they drink most or which recipes they rated highest.",
    inputSchema: {
      minRating: z.number().min(1).max(5).optional().describe("Only recipes averaging at least this"),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ minRating, limit }) =>
    withSnapshot((snapshot) => {
      const made = snapshot.library.recipes
        .filter((recipe) => timesMade(recipe) > 0)
        .map((recipe) => ({ recipe, count: timesMade(recipe), rating: averageRating(recipe) }))
        .filter((entry) => minRating === undefined || (entry.rating ?? 0) >= minRating)
        .sort((a, b) => b.count - a.count || (b.rating ?? 0) - (a.rating ?? 0));

      if (made.length === 0) {
        return minRating === undefined
          ? "No recipes have been logged as made yet."
          : `No recipes average ${minRating}/5 or better.`;
      }

      return [
        `${made.length} recipe${made.length === 1 ? "" : "s"} with history:`,
        "",
        ...made.slice(0, limit ?? 25).map(({ recipe, count, rating }) => {
          const last = recipe.history?.[0]?.date;
          const parts = [`made ${count}x`];
          if (rating) parts.push(`avg ${rating.toFixed(1)}/5`);
          if (last) parts.push(`last ${describeAge(Date.now() - new Date(last).getTime())}`);
          return `- ${recipe.name} — ${parts.join(", ")}`;
        }),
      ].join("\n");
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`swizzler-mcp reading ${snapshotPath()}`);
