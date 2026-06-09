/** POSIX path helpers for remote SSH file navigation. */

export function joinPath(base: string, name: string): string {
  if (base === "/" || base === "") return `/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

export function parentPath(value: string): string {
  if (value === "/" || value === "") return "/";
  const trimmed = value.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

export function basename(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Split an absolute path into cumulative breadcrumb segments. */
export function breadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const crumbs: { name: string; path: string }[] = [{ name: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc = `${acc}/${part}`;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}
