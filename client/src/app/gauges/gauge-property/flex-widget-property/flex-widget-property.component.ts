import { Component, Input, OnInit } from '@angular/core';
import { WidgetProperty } from '../../../_models/hmi';
import { ProjectService } from '../../../_services/project.service';
import { SvgUtils } from '../../../_helpers/svg-utils';

/** Readable information about a widget variable, shown next to its binding. */
export interface WidgetVariableInfo {
    label?: string;
    description?: string;
    /** read: tag -> widget, write: widget -> tag, rw: both */
    dir?: 'read' | 'write' | 'rw';
}

@Component({
    selector: 'flex-widget-property',
    templateUrl: './flex-widget-property.component.html',
    styleUrls: ['./flex-widget-property.component.scss']
})
export class FlexWidgetPropertyComponent implements OnInit {

    @Input() property: WidgetProperty;
    dataDevices = { devices: []};
    widgetTitle = '';
    info: { [originalName: string]: WidgetVariableInfo } = {};

    constructor(private projectService: ProjectService) {
        this.dataDevices = {
            devices: Object.values(this.projectService.getDevices())
        };
    }

    ngOnInit() {
        // Populate defaults from SVG script if available
        if (this.property?.varsToBind?.length && this.property?.scriptContent?.content) {
            this.property.varsToBind = SvgUtils.populateDefaults(
                this.property.scriptContent.content,
                this.property.varsToBind
            );
        }
        this.info = {
            ...FlexWidgetPropertyComponent.infoFromComments(this.property?.scriptContent?.content),
            ...this.infoFromMetadata(this.property?.svgContent),
        };
    }

    /**
     * Widget metadata: <metadata data-scadacraft="widget-properties">{"widget": "...", "properties": {"_pn_x": {label, description, dir}}}</metadata>
     * (OpenBridge widgets and any widget that declares it).
     */
    private infoFromMetadata(svgContent: string): { [name: string]: WidgetVariableInfo } {
        if (!svgContent || svgContent.indexOf('widget-properties') < 0) {
            return {};
        }
        try {
            const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
            const meta = Array.from(doc.getElementsByTagName('metadata')).find(m => m.getAttribute('data-scadacraft') === 'widget-properties');
            if (!meta?.textContent) {
                return {};
            }
            const data = JSON.parse(meta.textContent);
            this.widgetTitle = data.widget || '';
            return data.properties || {};
        } catch (err) {
            return {};
        }
    }

    /**
     * Trailing comments in the export section: "let _pn_level = 0; // Level | Tank level in %"
     * (label, then an optional description after "|").
     */
    static infoFromComments(script: string): { [name: string]: WidgetVariableInfo } {
        const result: { [name: string]: WidgetVariableInfo } = {};
        if (!script) {
            return result;
        }
        const regex = /(?:let|var|const)\s+(_p[bnsc]_\w+)\s*(?:=[^;\n]*)?;[ \t]*\/\/[ \t]*([^\n]+)/g;
        let m: RegExpExecArray;
        while ((m = regex.exec(script)) !== null) {
            const [label, ...rest] = m[2].split('|');
            result[m[1]] = { label: label.trim(), description: rest.join('|').trim() || undefined };
        }
        return result;
    }

    directionLabel(dir: string): string {
        return dir === 'write' ? '→ tag' : dir === 'rw' ? '⇄ tag' : '';
    }
}
