import { z } from 'zod';
import type { JSONSchema, LLMCategory } from '../core/types.js';

// Zod validators (post-decode, source of truth for structure)
export const EntryOutputSchema = z.object({
  index: z.number().int(),
  description: z.string(),
  category: z.string(),
  scope: z.string().nullable(),
  leadIn: z.string().nullable(),
});

export const EnhanceAndCategorizeOutputSchema = z.object({
  entries: z.array(EntryOutputSchema),
});

export const CategorizeEntryOutputSchema = z.object({
  index: z.number().int(),
  category: z.string(),
  scope: z.string().nullable(),
});

export const CategorizeOutputSchema = z.object({
  entries: z.array(CategorizeEntryOutputSchema),
});

// JSON schema builders (for provider-level structured output enforcement).
// OpenAI strict mode requires optional fields to be in `required` with nullable types.
function nullableString(): JSONSchema {
  return { anyOf: [{ type: 'string' }, { type: 'null' }] };
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
            index: { type: 'integer' },
            description: { type: 'string' },
            category: categoryField,
            scope: nullableString(),
            leadIn: nullableString(),
          },
          required: ['index', 'description', 'category', 'scope', 'leadIn'],
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
            index: { type: 'integer' },
            category: categoryField,
            scope: nullableString(),
          },
          required: ['index', 'category', 'scope'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  };
}
