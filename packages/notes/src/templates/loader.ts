import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentContext, TemplateContext, TemplateEngine } from '../core/types.js';
import { TemplateError } from '../errors/index.js';
import { renderEjs, renderEjsFile } from './ejs.js';
import { renderHandlebars, renderHandlebarsComposable, renderHandlebarsFile } from './handlebars.js';
import { renderLiquid, renderLiquidComposable, renderLiquidFile } from './liquid.js';

export interface TemplateResult {
  content: string;
  engine: TemplateEngine;
}

type RenderFn = (template: string, context: TemplateContext | DocumentContext) => string;
type RenderFileFn = (filePath: string, context: TemplateContext | DocumentContext) => string;

function getEngineFromFile(filePath: string): TemplateEngine {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.liquid':
      return 'liquid';
    case '.hbs':
    case '.handlebars':
      return 'handlebars';
    case '.ejs':
      return 'ejs';
    default:
      throw new TemplateError(`Unknown template extension: ${ext}`);
  }
}

function getRenderFn(engine: TemplateEngine): RenderFn {
  switch (engine) {
    case 'liquid':
      return renderLiquid;
    case 'handlebars':
      return renderHandlebars;
    case 'ejs':
      return renderEjs;
  }
}

function getRenderFileFn(engine: TemplateEngine): RenderFileFn {
  switch (engine) {
    case 'liquid':
      return renderLiquidFile;
    case 'handlebars':
      return renderHandlebarsFile;
    case 'ejs':
      return renderEjsFile;
  }
}

export function detectTemplateMode(templatePath: string): 'single' | 'composable' {
  if (!fs.existsSync(templatePath)) {
    throw new TemplateError(`Template path not found: ${templatePath}`);
  }

  const stat = fs.statSync(templatePath);

  if (stat.isFile()) {
    return 'single';
  }

  if (stat.isDirectory()) {
    return 'composable';
  }

  throw new TemplateError(`Invalid template path: ${templatePath}`);
}

export function renderSingleFile(
  templatePath: string,
  context: DocumentContext,
  engine?: TemplateEngine,
): TemplateResult {
  const resolvedEngine = engine ?? getEngineFromFile(templatePath);
  const renderFile = getRenderFileFn(resolvedEngine);

  return {
    content: renderFile(templatePath, context),
    engine: resolvedEngine,
  };
}

export function renderComposable(
  templateDir: string,
  context: DocumentContext,
  engine?: TemplateEngine,
): TemplateResult {
  const files = fs.readdirSync(templateDir);
  const engineMap: Record<TemplateEngine, { document: string; version: string; entry: string }> = {
    liquid: { document: 'document.liquid', version: 'version.liquid', entry: 'entry.liquid' },
    handlebars: { document: 'document.hbs', version: 'version.hbs', entry: 'entry.hbs' },
    ejs: { document: 'document.ejs', version: 'version.ejs', entry: 'entry.ejs' },
  };

  let resolvedEngine: TemplateEngine;

  if (engine) {
    resolvedEngine = engine;
  } else {
    const detected = detectEngineFromFiles(templateDir, files);
    if (!detected) {
      throw new TemplateError(`Could not detect template engine. Found files: ${files.join(', ')}`);
    }
    resolvedEngine = detected;
  }

  // Liquid and Handlebars use native include/partial mechanisms so sub-templates
  // resolve correctly relative to the template directory.
  if (resolvedEngine === 'liquid') {
    return { content: renderLiquidComposable(templateDir, context), engine: resolvedEngine };
  }

  if (resolvedEngine === 'handlebars') {
    return { content: renderHandlebarsComposable(templateDir, context), engine: resolvedEngine };
  }

  // EJS: pre-render sub-templates and pass rendered strings to the document template.
  const expectedFiles = engineMap[resolvedEngine];
  const documentPath = path.join(templateDir, expectedFiles.document);

  if (!fs.existsSync(documentPath)) {
    throw new TemplateError(`Document template not found: ${expectedFiles.document}`);
  }

  const versionPath = path.join(templateDir, expectedFiles.version);
  const entryPath = path.join(templateDir, expectedFiles.entry);

  const render = getRenderFn(resolvedEngine);

  const entryTemplate = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf-8') : null;
  const versionTemplate = fs.existsSync(versionPath) ? fs.readFileSync(versionPath, 'utf-8') : null;

  if (entryTemplate && versionTemplate) {
    const versionsWithEntries = context.versions.map((versionCtx) => {
      const entries = versionCtx.entries.map((entry) => {
        const entryCtx = { ...entry, packageName: versionCtx.packageName, version: versionCtx.version };
        return render(entryTemplate, entryCtx as unknown as TemplateContext);
      });
      return render(versionTemplate, { ...versionCtx, renderedEntries: entries } as unknown as TemplateContext);
    });

    const docContext = { ...context, renderedVersions: versionsWithEntries } as unknown as DocumentContext;
    return {
      content: render(fs.readFileSync(documentPath, 'utf-8'), docContext),
      engine: resolvedEngine,
    };
  }

  return renderSingleFile(documentPath, context, resolvedEngine);
}

function detectEngineFromFiles(_dir: string, files: string[]): TemplateEngine | null {
  if (files.some((f) => f.endsWith('.liquid'))) return 'liquid';
  if (files.some((f) => f.endsWith('.hbs') || f.endsWith('.handlebars'))) return 'handlebars';
  if (files.some((f) => f.endsWith('.ejs'))) return 'ejs';
  return null;
}

function validateDocumentContext(context: DocumentContext, templatePath: string): void {
  if (!context.project?.name) {
    throw new TemplateError(`${templatePath}: DocumentContext missing required field "project.name"`);
  }

  if (!Array.isArray(context.versions)) {
    throw new TemplateError(`${templatePath}: DocumentContext missing required field "versions" (must be an array)`);
  }

  const requiredVersionFields = ['packageName', 'version', 'date', 'entries'] as const;

  for (const [i, v] of context.versions.entries()) {
    for (const field of requiredVersionFields) {
      if (v[field] === undefined || v[field] === null) {
        throw new TemplateError(`${templatePath}: versions[${i}] missing required field "${field}"`);
      }
    }

    if (!Array.isArray(v.entries)) {
      throw new TemplateError(`${templatePath}: versions[${i}].entries must be an array`);
    }
  }
}

export function renderTemplate(
  templatePath: string,
  context: DocumentContext,
  engine?: TemplateEngine,
): TemplateResult {
  validateDocumentContext(context, templatePath);

  const mode = detectTemplateMode(templatePath);

  if (mode === 'single') {
    return renderSingleFile(templatePath, context, engine);
  }

  return renderComposable(templatePath, context, engine);
}
