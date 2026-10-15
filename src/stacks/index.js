import { angular, vue, react, node } from './node.js';
import { fastapi, django } from './python.js';
import { dotnet } from './dotnet.js';
import { java } from './java.js';
import { go } from './go.js';
import { rust } from './rust.js';
import { php } from './php.js';
import { ruby } from './ruby.js';

/**
 * Detection order: specific server stacks first (a Django app may also carry a package.json for tooling),
 * then SPA frameworks, then the generic Node fallback.
 *
 * A stack provides: id, port, backend, ignore, detect(dir, opts) -> info|null, dockerfile(info, port),
 * ci(info, version = info.version) -> { image, steps }, and optionally files(info, port) and notes(info, port).
 */
export const STACKS = [django, fastapi, dotnet, java, go, rust, php, ruby, angular, vue, react, node];
