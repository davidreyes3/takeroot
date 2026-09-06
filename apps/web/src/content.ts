/**
 * Loads every markdown file under content/ at build time.
 *
 * `eager: true` inlines them into the bundle, which is what makes the app work
 * offline with no fetch and no loading state. The whole Hebrew corpus is a few
 * tens of kilobytes of text; when it stops being, switch to lazy glob and load
 * per unit.
 */

const modules = import.meta.glob('../../../content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const contentFiles = Object.entries(modules)
  .filter(([path]) => !path.toLowerCase().endsWith('readme.md'))
  .map(([path, source]) => ({
    path: path.replace(/^.*?content\//u, 'content/'),
    source,
  }))
  .sort((a, b) => a.path.localeCompare(b.path));
