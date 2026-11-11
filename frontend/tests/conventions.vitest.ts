/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/*
 * Project rule: every component keeps its markup in a separate .html file
 * (templateUrl) and its styles in a separate .css file (styleUrls/styleUrl).
 * Inline `template:` and `styles:` are not allowed.
 */
const sources = import.meta.glob<string>(['../src/app/**/*.ts', '!../src/app/**/*.spec.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const assetFiles = new Set(Object.keys(import.meta.glob('../src/app/**/*.{html,css}')));

const components = Object.entries(sources).filter(([, source]) => source.includes('@Component('));

/** Resolves a './x.html' reference against the component file's folder. */
const sibling = (file: string, ref: string) => file.slice(0, file.lastIndexOf('/') + 1) + ref.replace(/^\.\//, '');

describe('component file conventions', () => {
  it('finds the components', () => {
    expect(components.length).toBeGreaterThan(0);
  });

  it.each(components)('%s uses separate template and style files', (file, source) => {
    expect(source).not.toMatch(/^\s*template\s*:/m);
    expect(source).not.toMatch(/^\s*styles\s*:/m);

    const templateUrl = source.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
    expect(templateUrl, 'missing templateUrl').not.toBeNull();
    expect(assetFiles.has(sibling(file, templateUrl![1])), `${templateUrl![1]} not found`).toBe(true);

    for (const [, styleFile] of source.matchAll(/['"](\.\/[^'"]+\.css)['"]/g)) {
      expect(assetFiles.has(sibling(file, styleFile)), `${styleFile} not found`).toBe(true);
    }
  });
});
