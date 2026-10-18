import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, from, map, of } from 'rxjs';
import { ObIcons } from '../scada-icon/ob-icons';
import { Define } from '../../_helpers/define';

@Component({
    selector: 'app-icon-selector',
    templateUrl: './icon-selector.component.html',
    styleUrls: ['./icon-selector.component.scss']
})
export class IconSelectorComponent implements OnInit {
    @Input() value: string;
    @Output() valueChange = new EventEmitter<string>();
    @Output() selected = new EventEmitter<string>();

    @Input() panelWidth = '310px';
    @Input() panelClass = 'icon-selector-panel';
    @Input() filterPlaceholder = 'dlg.headeritem-icons-filter';
    @Input() width = '60px';
    @Input() height = '30px';
    @Input() image: string;
    @Input() allowImage = false;
    @Input() allowClear = true;
    @Input() imageLabel = 'dlg.menuitem-image';
    @Input() clearLabel = 'gauges.property-icon-none';
    @Output() imageSelected = new EventEmitter<Event>();

    icons$: Observable<string[]>;
    filteredIcons$: Observable<string[]>;
    filterText = '';
    private filterTextSubject = new BehaviorSubject<string>('');

    ngOnInit() {
        const material$ = of(Define.MaterialIconsRegular).pipe(
            map((data: string) => data.split('\n')),
            map(lines => lines.map(line => line.split(' ')[0])),
            map(names => names.filter(name => !!name))
        );
        // OpenBridge icons first ("ob:<name>"), then Material icons
        this.icons$ = combineLatest([from(ObIcons.list()), material$]).pipe(map(([ob, mat]) => [...ob, ...mat]));

        this.filteredIcons$ = combineLatest([
            this.icons$,
            this.filterTextSubject.asObservable()
        ]).pipe(
            map(([icons, filterText]) =>
                ObIcons.filter(icons, filterText, this.value)
            )
        );
    }

    onFilterChange() {
        this.filterTextSubject.next(this.filterText);
    }

    onSelect(icon: string) {
        this.value = icon;
        this.valueChange.emit(icon);
        this.selected.emit(icon);
    }

    onClear() {
        this.value = '';
        this.image = undefined;
        this.valueChange.emit('');
        this.selected.emit('');
    }

    onImageSelected(event: Event) {
        this.value = 'image';
        this.valueChange.emit(this.value);
        this.imageSelected.emit(event);
    }
}
