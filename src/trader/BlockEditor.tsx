import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import { MENU, OpenDropdown, defineMwasyaBlocks } from './blocks';
import { marketOfSymbol } from './market';

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

type BlockDef = { init: (this: Blockly.Block) => void; [k: string]: unknown };
/** Our own / Blockly's definition of a block before any file added pieces to it. */
const originals = new Map<string, BlockDef>();
/** Pieces bot files needed on top of those definitions, merged across every file opened this session. */
const additions = new Map<string, Shape>();

/** A field the file uses that the definition lacks: a dropdown if the file shows several words, else a text box. */
function fieldFor(seen: string[]): Blockly.Field {
  return seen.length > 1 && seen.every((v) => /^[A-Za-z_]+$/.test(v))
    ? new OpenDropdown(seen.map((v) => [pretty(v), v] as [string, string]))
    : new Blockly.FieldTextInput(seen[0] ?? '');
}

/** Add whatever the file uses but the block does not have yet (extra fields, inputs, connections). Nothing is removed. */
function fillMissing(b: Blockly.Block, s: Shape) {
  for (const key of s.order) {
    const name = key.slice(2);
    if (key.startsWith('f:')) { if (!b.getField(name)) b.appendDummyInput().appendField(pretty(name)).appendField(fieldFor([...(s.fields.get(name) ?? [])]), name); }
    else if (!b.getInput(name)) { if (key.startsWith('v:')) b.appendValueInput(name).appendField(pretty(name)); else b.appendStatementInput(name).appendField(pretty(name)); }
  }
  if (b.outputConnection) return;
  if (s.output && !b.previousConnection && !b.nextConnection) { b.setOutput(true); return; }
  if (s.previous && !b.previousConnection) b.setPreviousStatement(true);
  if (s.next && !b.nextConnection) b.setNextStatement(true);
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
    const known = originals.get(type) ?? (Blockly.Blocks[type] as BlockDef | undefined);
    if (known && !generated.has(type)) {
      // Blocks that reshape themselves from the file (if/else-if/else, join, lists, functions) are already exact: keep them.
      if (known.domToMutation || known.loadExtraState || known.mutationToDom || known.saveExtraState) continue;
      // Our blocks and Blockly's keep their look; anything extra the file uses is added on, so nothing is lost.
      originals.set(type, known);
      const s = merge(additions.get(type), shape);
      additions.set(type, s);
      Blockly.Blocks[type] = { ...known, init(this: Blockly.Block) { known.init.call(this); fillMissing(this, s); } };
      continue;
    }
    // Blocks we have never seen are drawn from the file's own structure.
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
              ? new OpenDropdown(seen.map((v) => [pretty(v), v] as [string, string]))
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

export interface EditorApi {
  ws: Blockly.WorkspaceSvg; xml: () => string; showBlocks: (types: string[]) => void; tidy: () => void;
  /** Put the bot on this market (every Market block). */
  setMarket: (symbol: string) => void;
  /** Readable size, scrolled to the top-left. */
  home: () => void;
}

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

/**
 * Open a bot the way Deriv Bot does: readable block size, starting at the top-left (Trade parameters first).
 * Small bots that fit are shown whole; big bots are never shrunk until their text can't be read.
 */
// EDIT HERE: the smallest and largest zoom a bot opens at.
const MIN_OPEN_SCALE = 0.72, MAX_OPEN_SCALE = 0.95;
export function showStart(ws: Blockly.WorkspaceSvg) {
  ws.zoomToFit();
  ws.setScale(Math.min(MAX_OPEN_SCALE, Math.max(ws.getScale(), window.innerWidth < 700 ? 0.6 : MIN_OPEN_SCALE)));
  const c = ws.getMetricsManager().getContentMetrics();
  const v = ws.getMetricsManager().getViewMetrics();
  if (c.width <= v.width && c.height <= v.height) { ws.scrollCenter(); return; }
  ws.scroll(24 - c.left, 24 - c.top);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => { timer = undefined; if (!workspace) return; try { changeRef.current(Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace))); } catch { /* workspace already closed */ } };
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
          // EDIT HERE: block menu categories come from MENU in blocks.ts. Variables and Functions are Blockly's own (with Create buttons).
          contents: MENU.map((m) => (m.id === 'vars' || m.id === 'funcs'
            ? { kind: 'category', name: m.name, colour: m.colour, custom: m.id === 'vars' ? 'VARIABLE' : 'PROCEDURE' }
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
      showStart(workspace);
      const w = workspace;
      readyRef.current?.({
        ws: w,
        tidy: () => { if (!untangle(w)) w.cleanUp(); },
        home: () => showStart(w),
        xml: () => Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(w)),
        showBlocks: (types) => w.getToolbox()?.getFlyout()?.show({ kind: 'flyoutToolbox', contents: types.map((type) => ({ kind: 'block', type })) }),
        setMarket: (symbol) => {
          const [market, sub] = marketOfSymbol(symbol);
          for (const b of w.getAllBlocks(false)) {
            if (b.type !== 'trade_definition_market' || b.getFieldValue('SYMBOL_LIST') === symbol) continue;
            b.getField('MARKET_LIST')?.setValue(market); b.getField('SUBMARKET_LIST')?.setValue(sub); b.getField('SYMBOL_LIST')?.setValue(symbol);
          }
        },
      });
      // Every change is saved (in this browser) shortly after the client stops editing, and at once when they leave.
      workspace.addChangeListener((e) => {
        if (e.isUiEvent) return;
        clearTimeout(timer);
        timer = setTimeout(save, 300);
      });
    } catch (e) {
      setError(`This bot file could not be drawn: ${(e as Error).message}`);
    }
    const ro = new ResizeObserver(() => { if (workspace) Blockly.svgResize(workspace); });
    ro.observe(el);
    return () => { ro.disconnect(); if (timer) { clearTimeout(timer); save(); } readyRef.current?.(null); workspace?.dispose(); };
  }, [xml]);

  return (
    <div className="be">
      <div className="be-ws" ref={box} />
      {locked && <div className="be-lock" aria-live="polite">Bot running · blocks are locked</div>}
      {error && <p className="error be-err">{error}</p>}
    </div>
  );
}
