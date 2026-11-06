import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import { MENU, defineMwasyaBlocks } from './blocks';

/**
 * Shows a Deriv Bot XML file as its real blocks, exactly as it was built, and lets the client edit it.
 * Standard blocks (numbers, variables, logic, maths, text) come from Blockly itself. Every Deriv-specific
 * block in the file gets a definition generated from the file's own structure, so any bot opens.
 */

const COLOURS: [RegExp, string][] = [
  [/^controls_|^logic_/, '#3B5BDB'], [/^math_/, '#2F6FD6'], [/^variables_/, '#4263EB'], [/^trade_definition$/, '#1E3A8A'], [/^(before|after|during)_purchase$/, '#1E3A8A'], [/^trade_definition_/, '#1F4FD1'], [/purchase|^trade_again|^contract/, '#2F80ED'],
  [/notify|text_print|text_statement/, '#475F94'], [/tick|candle|ohlc|digit|stat/, '#0284C7'], [/read_details|total_profit|balance|profit/, '#3949AB'], [/sell/, '#0369A1'],
];
const colourOf = (type: string) => COLOURS.find(([re]) => re.test(type))?.[1] ?? '#3D5A99';
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

interface Shape { fields: Map<string, Set<string>>; values: Set<string>; statements: Set<string>; output: boolean; previous: boolean; next: boolean; order: string[] }

/** Shapes generated so far, merged across every file opened this session. */
const generated = new Map<string, Shape>();

/** Learn every block's shape (fields, inputs, connections) from how the file uses it. */
export function learnShapes(doc: Document): Map<string, Shape> {
  const shapes = new Map<string, Shape>();
  for (const b of Array.from(doc.getElementsByTagName('block')).concat(Array.from(doc.getElementsByTagName('shadow')))) {
    const type = b.getAttribute('type') ?? '';
    if (!type) continue;
    const s: Shape = shapes.get(type) ?? { fields: new Map<string, Set<string>>(), values: new Set<string>(), statements: new Set<string>(), output: false, previous: false, next: false, order: [] };
    const parent = b.parentElement?.tagName;
    if (parent === 'value') s.output = true;
    if (parent === 'statement' || parent === 'next') s.previous = true;
    for (const c of Array.from(b.children)) {
      const name = c.getAttribute('name') ?? '';
      if (c.tagName === 'field' && name) { if (!s.fields.has(name)) s.order.push(`f:${name}`); s.fields.set(name, (s.fields.get(name) ?? new Set()).add(c.textContent ?? '')); }
      if (c.tagName === 'value' && name) { if (!s.values.has(name)) s.order.push(`v:${name}`); s.values.add(name); }
      if (c.tagName === 'statement' && name) { if (!s.statements.has(name)) s.order.push(`s:${name}`); s.statements.add(name); }
      if (c.tagName === 'next') s.next = true;
    }
    shapes.set(type, s);
  }
  return shapes;
}

/** Does Blockly's current definition of `type` have every field, input and connection the file uses? */
function fits(type: string, s: Shape): boolean {
  if (!Blockly.Blocks[type]) return false;
  const tmp = new Blockly.Workspace();
  try {
    const b = tmp.newBlock(type);
    for (const f of s.fields.keys()) if (!b.getField(f)) return false;
    for (const v of [...s.values, ...s.statements]) if (!b.getInput(v)) return false;
    if (s.output && !b.outputConnection) return false;
    if (s.previous && !b.previousConnection) return false;
    if (s.next && !b.nextConnection) return false;
    return true;
  } catch { return false; } finally { tmp.dispose(); }
}

function merge(a: Shape | undefined, b: Shape): Shape {
  if (!a) return b;
  const fields = new Map(a.fields);
  b.fields.forEach((v, k) => fields.set(k, new Set([...(fields.get(k) ?? []), ...v])));
  return {
    fields, values: new Set([...a.values, ...b.values]), statements: new Set([...a.statements, ...b.statements]),
    output: a.output || b.output, previous: a.previous || b.previous, next: a.next || b.next,
    order: [...a.order, ...b.order.filter((k) => !a.order.includes(k))],
  };
}

export function defineShapes(found: Map<string, Shape>) {
  for (const [type, shape] of found) {
    // Standard blocks that already match stay as Blockly made them; anything else is generated from the file.
    if (!generated.has(type) && fits(type, shape)) continue;
    const s = merge(generated.get(type), shape);
    generated.set(type, s);
    Blockly.Blocks[type] = {
      init(this: Blockly.Block) {
        this.appendDummyInput().appendField(pretty(type));
        for (const key of s.order) {
          const name = key.slice(2);
          if (key.startsWith('f:')) {
            const seen = [...(s.fields.get(name) ?? [])];
            const field = seen.length > 1 && seen.every((v) => /^[A-Za-z_]+$/.test(v))
              ? new Blockly.FieldDropdown(seen.map((v) => [pretty(v), v] as [string, string]))
              : new Blockly.FieldTextInput(seen[0] ?? '');
            this.appendDummyInput().appendField(pretty(name)).appendField(field, name);
          } else if (key.startsWith('v:')) this.appendValueInput(name).appendField(pretty(name));
          else this.appendStatementInput(name).appendField(pretty(name));
        }
        if (s.output) this.setOutput(true);
        else { if (s.previous) this.setPreviousStatement(true); if (s.next || s.previous) this.setNextStatement(true); }
        this.setColour(colourOf(type));
        this.setInputsInline(s.values.size <= 2 && s.statements.size === 0 && s.fields.size <= 2);
      },
    };
  }
}

export interface EditorApi { ws: Blockly.WorkspaceSvg; xml: () => string; showBlocks: (types: string[]) => void; tidy: () => void }

/**
 * Bots drawn elsewhere (Deriv Bot's bigger blocks) can land on top of each other here. When any top-level groups overlap,
 * lay them out again in tidy columns, keeping their original left-to-right / top-to-bottom order. Bots that already fit stay as they are.
 */
// EDIT HERE: spacing between block groups after an automatic re-layout (workspace units).
const GAP_Y = 36, GAP_X = 56, SAME_COLUMN = 160;
export function untangle(ws: Blockly.WorkspaceSvg): boolean {
  const tops = ws.getTopBlocks(false).filter((b) => !b.isInsertionMarker());
  const rects = tops.map((b) => ({ b, r: b.getBoundingRectangle(), xy: b.getRelativeToSurfaceXY() }));
  const hit = rects.some((a, i) => rects.some((c, j) => j > i && a.r.left < c.r.right && c.r.left < a.r.right && a.r.top < c.r.bottom && c.r.top < a.r.bottom));
  if (!hit) return false;
  rects.sort((a, c) => a.xy.x - c.xy.x || a.xy.y - c.xy.y);
  const cols: (typeof rects)[] = [];
  for (const it of rects) {
    const col = cols[cols.length - 1];
    if (col && it.xy.x - col[0].xy.x < SAME_COLUMN) col.push(it); else cols.push([it]);
  }
  let x = 0;
  for (const col of cols) {
    col.sort((a, c) => a.xy.y - c.xy.y);
    let y = 0, widest = 0;
    for (const { b, r, xy } of col) {
      const offX = xy.x - r.left, offY = xy.y - r.top; // block origin vs. its visible box (hats, outputs)
      b.moveBy(x + offX - xy.x, y + offY - xy.y);
      y += r.bottom - r.top + GAP_Y;
      widest = Math.max(widest, r.right - r.left);
    }
    x += widest + GAP_X;
  }
  return true;
}

export default function BlockEditor({ xml, onChange, locked, onReady }: {
  xml: string; onChange: (xml: string) => void; locked?: boolean; onReady?: (api: EditorApi | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setError('');
    let workspace: Blockly.WorkspaceSvg | null = null;
    try {
      defineMwasyaBlocks();
      const dom = Blockly.utils.xml.textToDom(xml);
      defineShapes(learnShapes(dom.ownerDocument));
      const dark = !!el.closest('.tp-dark');
      workspace = Blockly.inject(el, {
        trashcan: true, sounds: false, renderer: 'zelos', move: { scrollbars: true, drag: true, wheel: true },
        zoom: { controls: false, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.3 },
        grid: { spacing: 24, length: 2, colour: dark ? '#263041' : '#E3E7EE', snap: true },
        toolbox: {
          kind: 'categoryToolbox',
          contents: MENU.map((m) => (m.id === 'vars'
            ? { kind: 'category', name: m.name, colour: m.colour, custom: 'VARIABLE' }
            : { kind: 'category', name: m.name, colour: m.colour, contents: m.blocks.map((type) => ({ kind: 'block', type })) })),
        },
        theme: Blockly.Theme.defineTheme(dark ? 'mw-dark' : 'mw-light', {
          name: dark ? 'mw-dark' : 'mw-light', base: Blockly.Themes.Classic,
          // EDIT HERE: blue and white — every core block family in its own shade of blue (no pink, green or brown).
          blockStyles: {
            logic_blocks: { colourPrimary: '#3B5BDB', colourSecondary: '#5C7CFA', colourTertiary: '#2B44A8' },
            loop_blocks: { colourPrimary: '#1C7ED6', colourSecondary: '#4DABF7', colourTertiary: '#1864AB' },
            math_blocks: { colourPrimary: '#2F6FD6', colourSecondary: '#5A8FE6', colourTertiary: '#2253A6' },
            text_blocks: { colourPrimary: '#475F94', colourSecondary: '#6A80B0', colourTertiary: '#344773' },
            list_blocks: { colourPrimary: '#0284C7', colourSecondary: '#38A6DD', colourTertiary: '#02679B' },
            variable_blocks: { colourPrimary: '#4263EB', colourSecondary: '#6C86F0', colourTertiary: '#2F4BC0' },
            procedure_blocks: { colourPrimary: '#364FC7', colourSecondary: '#5C6FD6', colourTertiary: '#27399A' },
          },
          categoryStyles: {},
          componentStyles: {
            workspaceBackgroundColour: dark ? '#121821' : '#FFFFFF', scrollbarColour: '#94A3B8',
            toolboxBackgroundColour: dark ? '#0E1C33' : '#FFFFFF', toolboxForegroundColour: dark ? '#E6ECF5' : '#0B1F3A',
            flyoutBackgroundColour: dark ? '#12223B' : '#F1F4F9', flyoutOpacity: 0.97,
          },
        }),
      });
      Blockly.Xml.domToWorkspace(dom, workspace);
      untangle(workspace);
      // Fit the whole bot on screen (never zoomed in past a comfortable size).
      workspace.zoomToFit();
      if (workspace.getScale() > 0.95) workspace.setScale(0.95);
      workspace.scrollCenter();
      const w = workspace;
      readyRef.current?.({
        ws: w,
        tidy: () => { if (!untangle(w)) w.cleanUp(); },
        xml: () => Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(w)),
        showBlocks: (types) => w.getToolbox()?.getFlyout()?.show({ kind: 'flyoutToolbox', contents: types.map((type) => ({ kind: 'block', type })) }),
      });
      let t: ReturnType<typeof setTimeout> | undefined;
      workspace.addChangeListener((e) => {
        if (e.isUiEvent) return;
        clearTimeout(t);
        t = setTimeout(() => changeRef.current(Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(w))), 400);
      });
    } catch (e) {
      setError(`This bot file could not be drawn: ${(e as Error).message}`);
    }
    const ro = new ResizeObserver(() => { if (workspace) Blockly.svgResize(workspace); });
    ro.observe(el);
    return () => { ro.disconnect(); readyRef.current?.(null); workspace?.dispose(); };
  }, [xml]);

  return (
    <div className="be">
      <div className="be-ws" ref={box} />
      {locked && <div className="be-lock" aria-live="polite">Bot running · blocks are locked</div>}
      {error && <p className="error be-err">{error}</p>}
    </div>
  );
}
