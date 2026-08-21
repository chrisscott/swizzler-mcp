import type { TransferLibrary, TransferRecipe } from "./types.js";

export function normalise(text: string): string {
  return text.toLowerCase().trim();
}

/** Loose two-way containment, so "lime" matches "Lime Juice" and vice versa. */
export function looselyMatches(haystack: string, needle: string): boolean {
  const a = normalise(haystack);
  const b = normalise(needle);
  return a.includes(b) || b.includes(a);
}

export function formatQuantity(value?: number | null): string {
  if (value === undefined || value === null) return "";
  if (Number.isInteger(value)) return String(value);
  const fractions: Record<string, string> = {
    "0.25": "1/4",
    "0.5": "1/2",
    "0.75": "3/4",
    "0.33": "1/3",
    "0.67": "2/3",
  };
  const whole = Math.floor(value);
  const remainder = Number((value - whole).toFixed(2));
  const fraction = fractions[String(remainder)];
  if (fraction) return whole > 0 ? `${whole} ${fraction}` : fraction;
  return String(Number(value.toFixed(2)));
}

export function ingredientLine(ingredient: TransferRecipe["ingredients"][number]): string {
  const parts = [formatQuantity(ingredient.quantity), ingredient.unit ?? "", ingredient.name]
    .filter((part) => part !== "" && part !== null && part !== undefined);
  const line = parts.join(" ");
  return ingredient.notes ? `${line} (${ingredient.notes})` : line;
}

export function timesMade(recipe: TransferRecipe): number {
  return recipe.history?.length ?? 0;
}

export function averageRating(recipe: TransferRecipe): number | undefined {
  const ratings = (recipe.history ?? [])
    .map((entry) => entry.rating)
    .filter((rating): rating is number => typeof rating === "number");
  if (ratings.length === 0) return undefined;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

/** One-line summary for list results. */
export function summariseRecipe(recipe: TransferRecipe): string {
  const bits: string[] = [];
  if (recipe.spiritCategory) bits.push(recipe.spiritCategory);
  if (recipe.isFavorite) bits.push("favourite");
  const made = timesMade(recipe);
  if (made > 0) {
    const rating = averageRating(recipe);
    bits.push(rating ? `made ${made}x, avg ${rating.toFixed(1)}/5` : `made ${made}x`);
  }
  const ingredients = recipe.ingredients.map((i) => i.name).join(", ");
  const suffix = bits.length > 0 ? ` [${bits.join(" | ")}]` : "";
  return `${recipe.name}${suffix}\n    ${ingredients}`;
}

/** Full detail for a single recipe. */
export function renderRecipe(recipe: TransferRecipe, library: TransferLibrary): string {
  const lines: string[] = [`# ${recipe.name}`];

  if (recipe.description) lines.push("", recipe.description);

  const meta: string[] = [];
  if (recipe.spiritCategory) meta.push(`Spirit: ${recipe.spiritCategory}`);
  if (recipe.glassware) meta.push(`Glass: ${recipe.glassware}`);
  if (recipe.method) meta.push(`Method: ${recipe.method}`);
  if (recipe.iceType) meta.push(`Ice: ${recipe.iceType}`);
  if (recipe.recipeYield && recipe.recipeYield !== 1) meta.push(`Serves: ${recipe.recipeYield}`);
  if (meta.length > 0) lines.push("", meta.join(" | "));

  lines.push("", "## Ingredients");
  for (const ingredient of [...recipe.ingredients].sort((a, b) => a.sortOrder - b.sortOrder)) {
    lines.push(`- ${ingredientLine(ingredient)}`);
  }

  if (recipe.instructions.length > 0) {
    lines.push("", "## Instructions");
    for (const step of [...recipe.instructions].sort((a, b) => a.stepNumber - b.stepNumber)) {
      lines.push(`${step.stepNumber}. ${step.text}`);
    }
  }

  if (recipe.garnish) lines.push("", `Garnish: ${recipe.garnish}`);
  if (recipe.tips) lines.push("", `Tips: ${recipe.tips}`);
  if (recipe.notes) lines.push("", `Notes: ${recipe.notes}`);

  const made = timesMade(recipe);
  if (made > 0) {
    const rating = averageRating(recipe);
    lines.push(
      "",
      rating
        ? `Made ${made} time${made === 1 ? "" : "s"}, average rating ${rating.toFixed(1)}/5.`
        : `Made ${made} time${made === 1 ? "" : "s"}.`,
    );
  }

  const collections = library.memberships
    .filter((m) => m.recipeName === recipe.name || (recipe.id && m.recipeId === recipe.id))
    .map((m) => m.collectionName);
  if (collections.length > 0) lines.push("", `Collections: ${collections.join(", ")}`);

  if (recipe.sourceURL) lines.push("", `Source: ${recipe.sourceURL}`);

  return lines.join("\n");
}
