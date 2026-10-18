/** OpenBridge icons shipped in assets/lib/openbridge/icons (extracted by tools/openbridge/make-icons.mjs). */
export class ObIcons {
    static readonly PREFIX = 'ob:';
    static readonly BASE = 'assets/lib/openbridge/icons/';
    private static names: Promise<string[]> | null = null;

    static isOb(name: string): boolean {
        return typeof name === 'string' && name.startsWith(ObIcons.PREFIX) && name.length > ObIcons.PREFIX.length;
    }

    static url(name: string): string {
        return ObIcons.BASE + encodeURIComponent(name.slice(ObIcons.PREFIX.length)) + '.svg';
    }

    /** Names of all OpenBridge icons, with the "ob:" prefix. */
    static list(): Promise<string[]> {
        if (!ObIcons.names) {
            ObIcons.names = fetch(ObIcons.BASE + 'icons.json')
                .then(res => res.ok ? res.json() : [])
                .then((names: string[]) => names.map(n => ObIcons.PREFIX + n))
                .catch(() => []);
        }
        return ObIcons.names;
    }

    /**
     * Icons for a picker: with no filter a first page of OpenBridge icons and all Material icons
     * (each OpenBridge icon is a file to load); with a filter every match, up to 600.
     */
    static filter(icons: string[], filterText: string, current?: string): string[] {
        const f = (filterText || '').trim().toLowerCase();
        let list: string[];
        if (!f) {
            const ob = icons.filter(i => ObIcons.isOb(i));
            list = [...ob.slice(0, 150), ...icons.filter(i => !ObIcons.isOb(i))];
        } else {
            const words = f.split(/\s+/);
            list = icons.filter(i => words.every(w => i.toLowerCase().includes(w))).slice(0, 600);
        }
        // the selected icon stays an option, so the picker shows it
        if (current && current !== 'image' && !list.includes(current)) {
            list = [current, ...list];
        }
        return list;
    }

    /** DOM element for code that builds the DOM itself (buttons, map markers). */
    static element(name: string, size?: number): HTMLElement {
        const span = document.createElement('span');
        span.className = 'ob-icon';
        const url = `url("${ObIcons.url(name)}")`;
        span.style.setProperty('-webkit-mask-image', url);
        span.style.setProperty('mask-image', url);
        if (size) {
            span.style.width = size + 'px';
            span.style.height = size + 'px';
        }
        return span;
    }
}
