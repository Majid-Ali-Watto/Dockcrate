/**
 * Splits file paths into the things they belong to: one group per service (its own folder, or a per-service folder
 * of a deploy target such as `k8s/<name>/`), then `Project` for everything shared. Groups keep their first-seen order.
 */
export function groupPaths(paths, services) {
  const owner = (path) => services.find((s) => path.startsWith(`${s.dir}/`) || path.split('/')[1] === s.name)?.name ?? 'Project';
  const groups = [];
  for (const path of paths) {
    const name = owner(path);
    const group = groups.find((g) => g.name === name) ?? groups[groups.push({ name, paths: [] }) - 1];
    group.paths.push(path);
  }
  return groups;
}
