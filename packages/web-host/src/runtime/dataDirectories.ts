/** Node-only migration of product-owned directories; custom paths are never renamed. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Move an owned directory and retain an alias for stored paths and older clients. */
export function migrateNexworkDirectory(previous: string, current: string): string {
  if (!path.isAbsolute(previous) || !path.isAbsolute(current)) throw new Error('Product directories must be absolute');
  if (previous === current) {
    fs.mkdirSync(current, { recursive: true });
    return current;
  }
  try {
    const legacy = fs.lstatSync(previous);
    // Resetting the new data directory can leave our compatibility link dangling.
    if (legacy.isSymbolicLink() && path.resolve(path.dirname(previous), fs.readlinkSync(previous)) === current) {
      fs.mkdirSync(current, { recursive: true });
      return current;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(current, { recursive: true });
    return current;
  }
  if (!fs.statSync(previous).isDirectory()) throw new Error('Legacy product path is not a directory');
  let emptyTargetMode: number | undefined;
  let target: fs.Stats | undefined;
  try {
    target = fs.lstatSync(current);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (target) {
    if (fs.existsSync(current) && fs.realpathSync(previous) === fs.realpathSync(current)) return current;
    if (!target.isDirectory() || fs.readdirSync(current).length > 0)
      throw new Error('Conflicting NexWork data directories; existing data was preserved');
    fs.rmdirSync(current);
    emptyTargetMode = target.mode;
  }
  try {
    fs.renameSync(previous, current);
  } catch (error) {
    if (emptyTargetMode !== undefined) fs.mkdirSync(current, { mode: emptyTargetMode });
    throw error;
  }
  try {
    // Sibling paths preserve relative symlink targets as well as real directories.
    fs.symlinkSync(current, previous, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    fs.renameSync(current, previous);
    if (emptyTargetMode !== undefined) fs.mkdirSync(current, { mode: emptyTargetMode });
    throw error;
  }
  return current;
}

/** Resolve the same standalone directory for the web server and its maintenance CLI. */
export function resolveNexworkWebDirectory(
  options: {
    home?: string;
    production?: boolean;
    multiInstance?: boolean;
    override?: string;
  } = {}
): string {
  if (options.override?.trim()) {
    const selected = path.resolve(options.override);
    fs.mkdirSync(selected, { recursive: true });
    return selected;
  }
  const home = options.home ?? os.homedir();
  const suffix = options.production ? '' : options.multiInstance ? '-dev-2' : '-dev';
  return migrateNexworkDirectory(path.join(home, `.aionui-web${suffix}`), path.join(home, `.nexwork-web${suffix}`));
}
