import { z } from 'zod';
import type { JSONSchema, LLMCategory } from '../core/types.js';

// Zod validators (post-decode, source of truth for structure)
export const EntryOutputSchema = z.object({
  description: z.string(),
  category: z.string(),
  scope: z.string().nullable(),
  breaking: z.boolean().nullable(),
  leadIn: z.string().nullable(),
});

export const EnhanceAndCategorizeOutputSchema = z.object({
  entries: z.array(EntryOutputSchema),
});

export const CategorizeEntryOutputSchema = z.object({
  category: z.string(),
  scope: z.string().nullable(),
});

export const CategorizeOutputSchema = z.object({
  entries: z.array(CategorizeEntryOutputSchema),
});

export type EntryOutput = z.infer<typeof EntryOutputSchema>;
export type EnhanceAndCategorizeOutput = z.infer<typeof EnhanceAndCategorizeOutputSchema>;
export type CategorizeOutput = z.infer<typeof CategorizeOutputSchema>;

// JSON schema builders (for provider-level structured output enforcement).
// OpenAI strict mode requires optional fields to be in `required` with nullable types.
function nullableString(): JSONSchema {
  return { anyOf: [{ type: 'string' }, { type: 'null' }] };
}

function nullableBoolean(): JSONSchema {
  return { anyOf: [{ type: 'boolean' }, { type: 'null' }] };
}

export function buildEnhanceAndCategorizeSchema(categories: LLMCategory[]): JSONSchema {
  const categoryNames = categories.map((c) => c.name);
  const categoryField: JSONSchema =
    categoryNames.length > 0 ? { type: 'string', enum: categoryNames } : { type: 'string' };

  return {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            category: categoryField,
            scope: nullableString(),
            breaking: nullableBoolean(),
            leadIn: nullableString(),
          },
          required: ['description', 'category', 'scope', 'breaking', 'leadIn'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  };
}

export function buildCategorizeSchema(categories: LLMCategory[]): JSONSchema {
  const categoryNames = categories.map((c) => c.name);
  const categoryField: JSONSchema =
    categoryNames.length > 0 ? { type: 'string', enum: categoryNames } : { type: 'string' };

  return {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: categoryField,
            scope: nullableString(),
          },
          required: ['category', 'scope'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  };
}
