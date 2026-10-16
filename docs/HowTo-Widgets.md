**Fuxa Widgets**

Fuxa widgets use pure SVGs with Javascript by the use of script tags
```
<svg>
  SVG Content Here
  <script>
     JS Script Content Here
  </script>
</svg>
```
We can transfer data between the SVG script using some simple functions and declaring the variables as global
```
_pb_ = bool   parameter ( true or false )
_pn_ = number parameter ( Int, Float, Real etc )
_ps_ = string parameter ( string can be entered directly )
_pc_ = color parameter in hex color code ( #00ff00ff )
```
It's also very important that the variables are contained within these comments `//!export-start` and `//!export-end`
```
//!export-start
let _pn_value = 50;
//!export-end
```
The variables will now be available in Fuxa in the SVG properties panel where you can bind Fuxa Tags
 

In order to transfer data between the Widget/SVG we have 2x functions we need to use:

To send values to Fuxa from the SVG
```
function postValue(id, value) {
  console.error('Not defined!');
}
```
You need to call the function, the ID needs to match the exact variable name
```
postValue('_pn_value', someNewValue);
```

To receive values from Fuxa to the SVG
```
function putValue(id, value) {
  if (id === '_pn_value') {
    callFunction(value);
    newVar = value;
  }
}
```
Here we wait for the function to be called in Fuxa and check for the ID we are after which is the exact variable name defined

If you use `setInterval` you also need to clear the interval when you change page or enter the editor, if you do not do this the widget will become broken due to another `setInterval` being called. In our examples we check the object if it exist and use the MutationObserver

```
const checkDestroy = document.getElementById('svgIdName'); // Important must be name of the SVG!
if (!checkDestroy) {
  clearBlinking(); 
  return;
}
```
And the Mutation Observer 
```
// Set up the MutationObserver to watch for removal of the SVG element
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.removedNodes.forEach((node) => {
      if (node.id === 'svgIdName') { // Important must be name of the SVG!
        clearBlinking(); 
        observer.disconnect(); 
      }
    });
  });
});
// Start observing the body or a parent element of the SVG
observer.observe(document.body, { childList: true, subtree: true }); 
```

It's important you use the SVG Id `<svg id=svgIdName>` at the top of the SVG file

You can also use CSS in the SVG and full JS and access the elements/ids using standard `getElementById` and `addEventListener`

For full working examples, see the examples in the widget section https://github.com/frangoteam/FUXA/tree/master/server/_widgets 
 

**ScadaCraft: readable names in the property panel**

The property panel shows, for every variable, a readable label and a description next to the tag
selection. A widget declares them in one of two ways:

- a trailing comment in the export section, label first and an optional description after `|`:
```
//!export-start
let _pn_level = 0;      // Level | Tank level in %
let _pb_cmd = false;    // Start/stop command | Written 1/0 on click
//!export-end
```
- or a metadata element in the SVG (used by the OpenBridge widgets), with the direction of each
  variable (`read`, `write` = command written by the widget, `rw` = shown and written):
```
<metadata data-scadacraft="widget-properties">{"widget": "Level bar", "properties": {
  "_pn_level": {"label": "Level", "description": "Tank level in %", "dir": "read"}}}</metadata>
```


## AVEVA Custom Widgets (.cwp)

ScadaCraft imports the Custom Widget packages made for AVEVA (a `.cwp` is a zip with `index.html`,
`<name>.wjson` and the widget scripts). In the editor: Widgets panel, import button (next to the
widget kiosk), choose the `.cwp` and the library group. Through the MCP: `scadacraft_import_widgets`
with the `.cwp` path.

- The package is kept as it is in `_widgets/<group>/_cwp/<name>/` and the page runs unchanged inside
  the widget (an iframe). A widget `<name>` appears in the library group.
- Every property of the `.wjson` becomes a widget variable: `Boolean` → `_pb_<name>`,
  `Integer`/`Double`/`Float` → `_pn_<name>`, `String` and the other types → `_ps_<name>`, with the
  default value of the `.wjson`. The property panel shows the AVEVA name and description; bind a tag
  to each property or give it a fixed value.
- ScadaCraft provides the `cwidget` object of AVEVA's `proxy.js`: `cwidget.<prop>` returns the value of
  the bound tag, `cwidget.<prop> = v` writes the tag, `cwidget.on('<prop>', fn)` is called when the value
  changes.
- Directions: if the package carries `window.CW_PROPS = [{name, dir: "in" | "out" | "inout"}]` (for
  example in `build/props.js`), the panel shows read / write / read-write; otherwise every property is
  read-write.
- In the editor the page is shown but does not take the mouse (to select and resize the widget); in the
  runtime it is fully interactive.
- Not supported: AVEVA services outside the `cwidget` properties (`MASvrHelper` is an empty stub) and
  widget events.
