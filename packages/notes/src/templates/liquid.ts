import * as fs from 'node:fs';
import * as path from 'node:path';
import { Liquid } from 'liquidjs';
import type { DocumentContext, TemplateContext } from '../core/types.js';
import { TemplateError } from '../errors/index.js';

export function createLiquidEngine(root?: string): Liquid {
  return new Liquid({
    root: root ? [root] : [],
    extname: '.liquid',
    cache: false,
  });
}

export function renderLiquid(template: string, context: TemplateContext | DocumentContext): string {
  const engine = createLiquidEngine();

  try {
    return engine.renderSync(engine.parse(template), context);
  } catch (error) {
    throw new TemplateError(`Liquid render error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function renderLiquidFile(filePath: string, context: TemplateContext | DocumentContext): string {
  if (!fs.existsSync(filePath)) {
    throw new TemplateError(`Template file not found: ${filePath}`);
  }

  const template = fs.readFileSync(filePath, 'utf-8');
  return renderLiquid(template, context);
}

export function renderLiquidComposable(templateDir: string, context: DocumentContext): string {
  const documentPath = path.join(templateDir, 'document.liquid');
  if (!fs.existsSync(documentPath)) {
    throw new TemplateError(`Document template not found: ${documentPath}`);
  }

  const engine = createLiquidEngine(templateDir);

  try {
    return engine.renderFileSync('document', context) as string;
  } catch (error) {
    throw new TemplateError(`Liquid render error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
