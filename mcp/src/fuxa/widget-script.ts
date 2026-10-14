/**
 * Server-side port of the widget script processing done by the ScadaCraft editor
 * (client/src/app/_helpers/svg-utils.ts: SvgUtils.processWidget and helpers).
 *
 * The editor turns the <script> of a widget SVG into a module bound to one widget instance:
 * exported variables become properties of `window.<moduleId>`, functions are exported,
 * element ids are renamed, and postValue() calls are redirected to the module.
 * Pages created by this MCP server must be indistinguishable from pages saved by the editor,
 * so this file mirrors that logic exactly. test/parity.mjs checks it against the client code.
 */

export const EXPORT_START = '//!export-start';
export const EXPORT_END = '//!export-end';

export type WidgetVarType = 'boolean' | 'number' | 'string' | 'color';

export interface WidgetPropertyVariable {
  originalName: string;
  name: string;
  type: WidgetVarType;
  variableId?: string;
  variableValue?: string;
}

const TYPE_PREFIX: Record<WidgetVarType, string> = {
  boolean: '_pb_',
  number: '_pn_',
  string: '_ps_',
  color: '_pc_',
};

export function removeComments(script: string): string {
  return script.replace(/\/\*[\s\S]*?\*\//g, '');
}

function toWidgetPropertyVariable(originalVar: string, varName: string): WidgetPropertyVariable | null {
  const entry = (Object.entries(TYPE_PREFIX) as [WidgetVarType, string][]).find(([, prefix]) => varName.startsWith(prefix));
  return entry ? { originalName: originalVar, name: varName, type: entry[0] } : null;
}

export function exportGlobalVariables(script: string, moduleId: string): { content: string; vars: WidgetPropertyVariable[] } {
  const sectionRegex = new RegExp(`${EXPORT_START}([\\s\\S]*?)${EXPORT_END}`, 'g');
  const match = sectionRegex.exec(script);
  const renamed: Record<string, string> = {};
  const defaults: Record<string, string> = {};
  if (match) {
    let section = match[1];
    const varRegex = /(?:var|let|const)\s+(\w+)\s*(?:=\s*([^;]+))?\s*;/g;
    let varMatch: RegExpExecArray | null;
    while ((varMatch = varRegex.exec(section)) !== null) {
      const varName = varMatch[1];
      const defaultValue = varMatch[2]?.trim();
      if (defaultValue) {
        defaults[varName] = defaultValue;
      }
      renamed[varName] = varName;
      section = section.replace(new RegExp(`\\b${varName}\\b`, 'g'), varName);
      section += `\n${moduleId}.${varName} = ${varName};`;
    }
    script = script.replace(match[0], `${EXPORT_START}${section}${EXPORT_END}`);
  }
  const vars: WidgetPropertyVariable[] = [];
  for (const [originalVar, newVar] of Object.entries(renamed)) {
    script = script.replace(new RegExp(`\\b${originalVar}\\b`, 'g'), newVar);
    const widgetVar = toWidgetPropertyVariable(originalVar, newVar);
    if (widgetVar) {
      let defaultVal = defaults[originalVar];
      if (defaultVal && (widgetVar.type === 'string' || widgetVar.type === 'color')) {
        defaultVal = defaultVal.replace(/^['"`]|['"`]$/g, '');
      }
      widgetVar.variableValue = defaultVal;
      vars.push(widgetVar);
    }
  }
  return { content: script, vars };
}

export function exportFunctionNames(script: string, moduleId: string): string {
  const functionDeclRegex = /function\s+(\w+)\s*\(/g;
  const functionExprRegex = /(\w+)\s*=\s*(?:function|=>)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = functionDeclRegex.exec(script)) !== null) {
    script += `\n${moduleId}.${match[1]} = ${match[1]};`;
  }
  while ((match = functionExprRegex.exec(script)) !== null) {
    script += `\n${moduleId}.${match[1]} = ${match[1]};`;
  }
  const callRegex = new RegExp('(?<!function\\s+)\\bpostValue\\b(?=\\s*\\()', 'g');
  return script.replace(callRegex, `${moduleId}.postValue`);
}

export function replaceIdsInScript(script: string, idMap: Record<string, string>): string {
  let updated = script;
  for (const [oldId, newId] of Object.entries(idMap)) {
    updated = updated.replace(new RegExp(`(['"\"])${oldId}\\1`, 'g'), `$1${newId}$1`);
  }
  return updated;
}

export function addModuleDeclaration(script: string, moduleId: string): string {
  return `var ${moduleId} = window.${moduleId} || {};\n(function() {${script}\n})();\nwindow.${moduleId}=${moduleId}`;
}

/** Same steps and order as SvgUtils.processWidget (without pre-defined variables). */
export function processWidget(script: string, moduleId: string, idMap: Record<string, string>): { content: string; vars: WidgetPropertyVariable[] } {
  const clean = removeComments(script);
  const exported = exportGlobalVariables(clean, moduleId);
  let content = exportFunctionNames(exported.content, moduleId);
  content = replaceIdsInScript(content, idMap);
  content = addModuleDeclaration(content, moduleId);
  return { content, vars: exported.vars };
}
