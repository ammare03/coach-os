import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { GALLERY_SECTIONS } from '../sections/registry.ts';

const GALLERY_DIR = path.resolve(__dirname, '..');
const SECTIONS_DIR = path.join(GALLERY_DIR, 'sections');
const UI_BARREL = path.resolve(GALLERY_DIR, '../../../../../packages/ui/src/index.ts');

/**
 * Every PascalCase value export from `@coachos/ui` is a component. Type
 * exports carry `type ` and are skipped; the package's constants are
 * SCREAMING_SNAKE and its hooks and helpers are camelCase, so neither
 * matches.
 */
function exportedComponents(): string[] {
  const source = readFileSync(UI_BARREL, 'utf8');
  const names = new Set<string>();

  for (const match of source.matchAll(/^\s{2}(?:export )?([A-Za-z_][\w]*),?$/gm)) {
    const name = match[1];
    if (name && /^[A-Z][A-Za-z0-9]*$/.test(name)) names.add(name);
  }
  for (const match of source.matchAll(/^export \{ ([^}]+) \} from/gm)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim();
      if (/^[A-Z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
  }

  return [...names];
}

function gallerySource(): string {
  const files = readdirSync(SECTIONS_DIR)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => path.join(SECTIONS_DIR, file));
  files.push(path.join(GALLERY_DIR, 'GalleryScreen.tsx'));

  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

describe('the component gallery', () => {
  // P04's exit gate is "every §7.4 primitive renders in the gallery". Without
  // this, a primitive added in a later phase silently never gets audited.
  it('renders every component `packages/ui` exports', () => {
    const source = gallerySource();
    const missing = exportedComponents().filter(
      (name) => !new RegExp(`<${name}[\\s/>]`).test(source),
    );

    expect(missing).toEqual([]);
  });

  it('registers one section per category, with unique names', () => {
    const names = GALLERY_SECTIONS.map((entry) => entry.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('registers every section file that exists', () => {
    const sectionFiles = readdirSync(SECTIONS_DIR).filter((file) => file.endsWith('Section.tsx'));

    expect(GALLERY_SECTIONS).toHaveLength(sectionFiles.length);
  });
});
