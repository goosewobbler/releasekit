import * as fs from 'node:fs';
import ejs from 'ejs';
import type { DocumentContext, TemplateContext } from '../core/types.js';
import { TemplateError } from '../errors/index.js';

export function renderEjs(template: string, context: TemplateContext | DocumentContext): string {
  try {
    return ejs.render(template, context);
  } catch (error) {
    throw new TemplateError(`EJS render error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function renderEjsFile(filePath: string, context: TemplateContext | DocumentContext): string {
  if (!fs.existsSync(filePath)) {
    throw new TemplateError(`Template file not found: ${filePath}`);
  }

  const template = fs.readFileSync(filePath, 'utf-8');
  return renderEjs(template, context);
}

export async function renderEjsFileAsync(
  filePath: string,
  context: TemplateContext | DocumentContext,
): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new TemplateError(`Template file not found: ${filePath}`);
  }

  try {
    return await ejs.renderFile(filePath, context);
  } catch (error) {
    throw new TemplateError(`EJS render error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
