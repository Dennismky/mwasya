import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import { MENU, defineMwasyaBlocks } from './blocks';

/**
 * Shows a Deriv Bot XML file as its real blocks, exactly as it was built, and lets the client edit it.
 * Standard blocks (numbers, variables, logic, maths, text) come from Blockly itself. Every Deriv-specific
 * block in the file gets a definition generated from the file's own structure, so any bot opens.
 */

const COLOURS: [RegExp, string][] = [
  [/^controls_|^logic_/, '#4F5BD5'], [/^math_/, '#3E7CB1'], [/^variables_/, '#C2418A'], [/^trade_definition$/, '#2B3442'], [/^(before|after|during)_purchase$/, '#2B3442'], [/^trade_definition_/, '#2F6BDB'], [/purchase|^trade_again|^contract/, '#0E9F6E'],
  [/notify|text_print|text_statement/, '#64748B'], [/tick|candle|ohlc|digit|stat/, '#0F8FA8'], [/read_details|total_profit|balance|profit/, '#7C4DDB'], [/sell/, '#E0731A'],
];
const colourOf = (type: string) => COLOURS.find(([re]) => re.test(type))?.[1] ?? '#4E5968';
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

export interface EditorApi { ws: Blockly.WorkspaceSvg; xml: () => string; showBlocks: (types: string[]) => void }

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
          // Grey and white: every block family in slate shades.
          blockStyles: {
            logic_blocks: { colourPrimary: '#4F5BD5', colourSecondary: '#6E78E0', colourTertiary: '#3A45B0' },
            loop_blocks: { colourPrimary: '#2E8B57', colourSecondary: '#45A36E', colourTertiary: '#216B42' },
            math_blocks: { colourPrimary: '#3E7CB1', colourSecondary: '#5A93C4', colourTertiary: '#2D5F8A' },
            text_blocks: { colourPrimary: '#64748B', colourSecondary: '#7C8BA1', colourTertiary: '#4B5870' },
            list_blocks: { colourPrimary: '#0F8FA8', colourSecondary: '#2FA8BF', colourTertiary: '#0B6E82' },
            variable_blocks: { colourPrimary: '#C2418A', colourSecondary: '#D461A0', colourTertiary: '#99326C' },
            procedure_blocks: { colourPrimary: '#8B5E34', colourSecondary: '#A6774A', colourTertiary: '#6B4826' },
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
      // Fit the whole bot on screen (never zoomed in past a comfortable size).
      workspace.zoomToFit();
      if (workspace.getScale() > 0.95) workspace.setScale(0.95);
      workspace.scrollCenter();
      const w = workspace;
      readyRef.current?.({
        ws: w,
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
