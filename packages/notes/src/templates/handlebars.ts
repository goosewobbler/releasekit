import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import type { DocumentContext, TemplateContext } from '../core/types.js';
import { TemplateError } from '../errors/index.js';

export function registerHandlebarsHelpers(): void {
  Handlebars.registerHelper('capitalize', (str: string) => {
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => {
    return a === b;
  });

  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => {
    return a !== b;
  });

  Handlebars.registerHelper('join', (arr: unknown, separator: string) => {
    return Array.isArray(arr) ? arr.join(separator) : '';
  });
}

export function renderHandlebars(template: string, context: TemplateContext | DocumentContext): string {
  registerHandlebarsHelpers();

  try {
    const compiled = Handlebars.compile(template);
    return compiled(context);
  } catch (error) {
    throw new TemplateError(`Handlebars render error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function renderHandlebarsFile(filePath: string, context: TemplateContext | DocumentContext): string {
  if (!fs.existsSync(filePath)) {
    throw new TemplateError(`Template file not found: ${filePath}`);
  }

  const template = fs.readFileSync(filePath, 'utf-8');
  return renderHandlebars(template, context);
}

export function renderHandlebarsComposable(templateDir: string, context: DocumentContext): string {
  registerHandlebarsHelpers();

  const versionPath = path.join(templateDir, 'version.hbs');
  const entryPath = path.join(templateDir, 'entry.hbs');
  const documentPath = path.join(templateDir, 'document.hbs');

  if (!fs.existsSync(documentPath)) {
    throw new TemplateError(`Document template not found: ${documentPath}`);
  }

  if (fs.existsSync(versionPath)) {
    Handlebars.registerPartial('version', fs.readFileSync(versionPath, 'utf-8'));
  }

  if (fs.existsSync(entryPath)) {
    Handlebars.registerPartial('entry', fs.readFileSync(entryPath, 'utf-8'));
  }

  try {
    const compiled = Handlebars.compile(fs.readFileSync(documentPath, 'utf-8'));
    return compiled(context);
  } catch (error) {
    throw new TemplateError(`Handlebars render error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
