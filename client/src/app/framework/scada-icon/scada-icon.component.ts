import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';
import { ObIcons } from './ob-icons';

/**
 * Icon by name: a Material icon ("home") or an OpenBridge icon ("ob:alarm-badge").
 * OpenBridge icons are drawn as a CSS mask, so they take the text colour like Material icons.
 */
@Component({
    selector: 'app-scada-icon',
    template: `<span *ngIf="obUrl; else matIcon" class="ob-icon" [class.ob-icon-fill]="fill || inheritSize"
                    [ngStyle]="{ '-webkit-mask-image': obUrl, 'mask-image': obUrl }"></span>
               <ng-template #matIcon><mat-icon [class]="iconClass">{{ name }}</mat-icon></ng-template>`,
    styles: [
        ':host { display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; line-height: 0; }',
        ':host(.scada-icon-inherit) mat-icon { width: inherit; height: inherit; font-size: inherit; line-height: inherit; }'
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScadaIconComponent {
    @Input() name: string;
    /** extra class for the Material icon */
    @Input() iconClass = '';
    /** fill the host box instead of the 24px icon size */
    @Input() fill = false;
    /** take width, height and font size from the host element (e.g. header buttons) */
    @Input() @HostBinding('class.scada-icon-inherit') inheritSize = false;

    get obUrl(): string | null {
        return ObIcons.isOb(this.name) ? `url("${ObIcons.url(this.name)}")` : null;
    }
}
