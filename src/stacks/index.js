import { angular, vue, react, node } from './node.js';
import { fastapi, django } from './python.js';
import { dotnet } from './dotnet.js';
import { java } from './java.js';
import { go } from './go.js';
import { rust } from './rust.js';
import { php } from './php.js';
import { ruby } from './ruby.js';

/**
 * A stack provides: id, port, backend, ignore, starter(opts) -> info, dockerfile(info, port, c, build), ci(info, version = info.version)
 * -> { image, steps } (a step that belongs to a CI step carries `ciStep`: a manual run can switch it off), and optionally files(info, port, build), notes(info, port) and the other hooks described in CLAUDE.md.
 */
export const STACKS = [django, fastapi, dotnet, java, go, rust, php, ruby, angular, vue, react, node];
