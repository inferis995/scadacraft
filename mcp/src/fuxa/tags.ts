/** Tag lookup across all devices of a project, including the ScadaCraft server device. */
import type { Device, Project, Tag } from './types.js';

export interface TagRef {
  id: string;
  name: string;
  device: string;
  deviceId: string;
  deviceType: string;
  type?: string;
  address?: string;
  /** "Device.Tag", the reference accepted by the binding tools */
  ref: string;
}

export function allDevices(project: Project): Device[] {
  const devices = Object.values(project.devices ?? {});
  if (project.server && !devices.some((d) => d.id === project.server!.id)) devices.unshift(project.server);
  return devices;
}

export function allTags(project: Project): TagRef[] {
  const out: TagRef[] = [];
  for (const d of allDevices(project)) {
    for (const t of Object.values(d.tags ?? {}) as Tag[]) {
      out.push({
        id: t.id, name: t.name, device: d.name, deviceId: d.id, deviceType: d.type,
        type: t.type, address: typeof t.address === 'string' ? t.address : undefined, ref: `${d.name}.${t.name}`,
      });
    }
  }
  return out;
}

/**
 * Resolve a tag reference: tag id, "Device.Tag", or a tag name that is unique in the project.
 * Throws an actionable error when not found or ambiguous.
 */
export function resolveTag(project: Project, ref: string): TagRef {
  const tags = allTags(project);
  const byId = tags.find((t) => t.id === ref);
  if (byId) return byId;
  const byRef = tags.filter((t) => t.ref.toLowerCase() === ref.toLowerCase());
  if (byRef.length === 1) return byRef[0];
  const byName = tags.filter((t) => t.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(`Tag "${ref}" is ambiguous: ${byName.map((t) => t.ref).join(', ')}. Use "Device.Tag".`);
  }
  const similar = tags.filter((t) => t.ref.toLowerCase().includes(ref.toLowerCase().split('.').pop() ?? '')).slice(0, 5);
  throw new Error(
    `Tag "${ref}" not found.` + (similar.length ? ` Similar: ${similar.map((t) => t.ref).join(', ')}.` : '') +
      ' Use scadacraft_list_tags to see available tags.',
  );
}
