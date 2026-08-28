/**
 * Mirrors the Codable transfer types in Swizzler/Services/SwizzleFileService.swift.
 * The snapshot is a normal `.swizzle` library document that also carries a stamp.
 */

export interface TransferIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  role?: string | null;
  notes?: string | null;
  sortOrder: number;
}

export interface TransferInstruction {
  stepNumber: number;
  text: string;
}

export interface TransferHistory {
  date: string;
  rating?: number | null;
  notes?: string | null;
}

export interface TransferRecipe {
  id?: string;
  name: string;
  description?: string | null;
  author?: string | null;
  sourceURL?: string | null;
  spiritCategory?: string | null;
  glassware?: string | null;
  method?: string | null;
  difficulty?: string | null;
  iceType?: string | null;
  recipeYield?: number | null;
  estimatedABV?: number | null;
  keywords?: string[] | null;
  ingredients: TransferIngredient[];
  instructions: TransferInstruction[];
  garnish?: string | null;
  tips?: string | null;
  notes?: string | null;
  isFavorite?: boolean | null;
  /** "Next Round" — the user's queue of drinks they mean to make next. */
  isNextRound?: boolean | null;
  history?: TransferHistory[] | null;
}

export interface TransferCollection {
  id?: string;
  name: string;
  icon: string;
  color: string;
  isSmartCollection?: boolean | null;
  smartRules?: string | null;
  userSortOrder?: number | null;
  recipes: TransferRecipe[];
}

export interface TransferCollectionMembership {
  collectionId?: string;
  collectionName: string;
  recipeId?: string;
  recipeName: string;
  sortOrder: number;
}

export interface TransferLibrary {
  recipes: TransferRecipe[];
  collections: TransferCollection[];
  memberships: TransferCollectionMembership[];
}

/** Written by MCPSnapshotService so readers can judge how stale the data is. */
export interface SnapshotStamp {
  generation: number;
  deviceID: string;
  deviceModel: string;
  exportedAt: string;
  maxDateModified?: string | null;
  recipeCount: number;
  collectionCount: number;
}

export interface SwizzleDocument {
  version: number;
  type: string;
  recipe?: TransferRecipe;
  collection?: TransferCollection;
  library?: TransferLibrary;
  stamp?: SnapshotStamp;
}
