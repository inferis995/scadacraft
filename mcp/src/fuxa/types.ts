/** Subset of the ScadaCraft/FUXA project model used by the MCP server. */
import type { WidgetPropertyVariable } from './widget-script.js';

export interface Tag {
  id: string;
  name: string;
  label?: string;
  type?: string;
  address?: string;
  init?: string;
  [key: string]: unknown;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  enabled?: boolean;
  polling?: number;
  property?: Record<string, unknown>;
  tags?: Record<string, Tag>;
  [key: string]: unknown;
}

export interface WidgetProperty {
  events: unknown[];
  actions: unknown[];
  address: string;
  type: 'widget';
  svgGuid: string;
  svgContent: string;
  scriptContent: { moduleId: string; content: string };
  varsToBind: WidgetPropertyVariable[];
}

export interface GaugeSettings {
  id: string;
  type: string;
  name: string;
  label?: string;
  hide?: boolean;
  lock?: boolean;
  property: WidgetProperty | Record<string, unknown>;
  [key: string]: unknown;
}

export interface ViewProfile {
  width: number;
  height: number;
  bkcolor: string;
  margin?: number;
  align?: string;
  gridType?: string;
  viewRenderDelay?: number;
  [key: string]: unknown;
}

export interface View {
  id: string;
  name: string;
  profile: ViewProfile;
  items: Record<string, GaugeSettings>;
  variables: Record<string, unknown>;
  svgcontent: string;
  type: string;
  [key: string]: unknown;
}

export interface Project {
  devices?: Record<string, Device>;
  server?: Device;
  hmi?: { views?: View[]; [key: string]: unknown };
  [key: string]: unknown;
}

/** One entry of server/_widgets/openbridge/widgets.json */
export interface CatalogWidget {
  widget: string;
  file: string;
  title: string;
  group: 'device' | 'pipe';
  element: string;
  size: { width: number; height: number };
  anchor: { x: number; y: number };
  stretch: 'x' | 'y' | null;
  properties: { name: string; type: string; default: string; write: boolean; description: string }[];
}

export interface Catalog {
  grid: number;
  openbridge: string;
  widgets: CatalogWidget[];
}
