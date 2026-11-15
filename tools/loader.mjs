// Node loader hooks so the simulator can import game sources directly:
//  - extensionless relative imports ("./data") resolve to ".ts"
//  - Vite-style "?raw" imports return the file text as a default export
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?raw')) {
    const url = new URL(specifier.slice(0, -4), context.parentURL);
    return { url: url.href + '?raw', shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('?raw')) {
    const text = await readFile(fileURLToPath(url.slice(0, -4)), 'utf8');
    return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }
  return next(url, context);
}
