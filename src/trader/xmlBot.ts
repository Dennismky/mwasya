import { DEFAULT_CONFIG, type BotConfig } from './botEngine';

/** One number the bot file sets at start-up (Stake, Martingale, Target Profit…). */
export interface XmlParam { name: string; value: number; role?: 'stake' | 'multiplier' | 'takeProfit' | 'stopLoss' | 'prediction' }
export interface LoadedBot { name: string; config: BotConfig; params: XmlParam[]; notes: string[]; xml: string }

const SUPPORTED = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'];

const roleOf = (name: string): XmlParam['role'] => {
  const n = name.toLowerCase();
  if (/martin|multipl|factor/.test(n)) return 'multiplier';
  if (/target|take ?profit|expected ?profit|^tp$|profit ?target/.test(n)) return 'takeProfit';
  if (/stop ?loss|max ?loss|^sl$|^loss$|loss ?limit/.test(n)) return 'stopLoss';
  if (/prediction|barrier|digit/.test(n)) return 'prediction';
  if (/^(initial |init |first |base )?stake|amount/.test(n)) return 'stake';
  return undefined;
};

/** Reads a Deriv Bot (Blockly) XML file: market, contract, duration, stake, martingale, take profit, stop loss. */
export function parseDerivXml(xml: string, fileName = 'Imported bot'): LoadedBot {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('block').length) throw new Error('This is not a Deriv Bot XML file.');

  const all = (tag: string) => Array.from(doc.getElementsByTagName(tag));
  const field = (name: string, root: Element | Document = doc) => Array.from(root.getElementsByTagName('field')).find((f) => f.getAttribute('name') === name)?.textContent?.trim() ?? '';
  const childBlock = (el: Element | undefined) => { if (!el) return undefined; const k = Array.from(el.children); return k.find((c) => c.tagName === 'block') ?? k.find((c) => c.tagName === 'shadow'); };
  const blocks = (type: string) => all('block').filter((b) => b.getAttribute('type') === type);

  // Start-up value of every variable: the first `set X to <number>` in the file.
  const initial = new Map<string, { name: string; value: number }>();
  for (const b of blocks('variables_set')) {
    const v = Array.from(b.children).find((c) => c.tagName === 'field' && c.getAttribute('name') === 'VAR');
    const id = v?.getAttribute('id') ?? v?.textContent ?? '';
    if (!id || initial.has(id)) continue;
    const val = childBlock(Array.from(b.children).find((c) => c.tagName === 'value' && c.getAttribute('name') === 'VALUE'));
    if (val?.getAttribute('type') === 'math_number') {
      const n = Number(field('NUM', val));
      if (Number.isFinite(n)) initial.set(id, { name: (v?.textContent ?? '').trim(), value: n });
    }
  }
  const num = (block: Element | undefined): number | null => {
    if (!block) return null;
    const t = block.getAttribute('type');
    if (t === 'math_number') { const n = Number(field('NUM', block)); return Number.isFinite(n) ? n : null; }
    if (t === 'variables_get') {
      const f = Array.from(block.getElementsByTagName('field')).find((x) => x.getAttribute('name') === 'VAR');
      return initial.get(f?.getAttribute('id') ?? f?.textContent ?? '')?.value ?? null;
    }
    return null;
  };
  const input = (name: string) => {
    const v = all('value').find((x) => x.getAttribute('name') === name);
    return num(childBlock(v));
  };

  const cfg: BotConfig = { ...DEFAULT_CONFIG, entryDigit: null, maxRuns: 0, recoveryMode: 'multiply' };
  const notes: string[] = [];

  const symbol = field('SYMBOL_LIST');
  if (symbol) cfg.symbol = symbol;
  const contract = field('PURCHASE_LIST') || field('TYPE_LIST').toUpperCase();
  if (SUPPORTED.includes(contract)) cfg.contract = contract as BotConfig['contract'];
  else if (contract) notes.push(`Contract ${contract} is not supported here. Using ${cfg.contract}.`);
  const unit = field('DURATIONTYPE_LIST');
  if (unit && unit !== 't') notes.push('This bot uses a time duration. It runs here in ticks.');
  const dur = input('DURATION');
  if (dur && dur >= 1) cfg.ticks = Math.min(10, Math.round(dur));
  const pred = input('PREDICTION');
  if (pred !== null) cfg.prediction = Math.max(0, Math.min(9, Math.round(pred)));
  const amount = input('AMOUNT');
  if (amount && amount > 0) cfg.stake = amount;

  const params: XmlParam[] = [];
  for (const { name, value } of initial.values()) {
    if (!name || /^text\d*$|^i$|^j$/i.test(name)) continue;
    const role = roleOf(name);
    params.push({ name, value, role });
    if (role === 'multiplier' && value > 1) { cfg.multiplier = value; cfg.recovery = true; }
    if (role === 'takeProfit' && value > 0) cfg.takeProfit = value;
    if (role === 'stopLoss' && value > 0) cfg.stopLoss = value;
    if (role === 'stake' && !(amount && amount > 0) && value > 0) cfg.stake = value;
  }

  // Recovery written as "change Stake by |last profit| × k": next stake adds the loss.
  for (const b of blocks('math_change')) {
    const delta = Array.from(b.children).find((c) => c.tagName === 'value' && c.getAttribute('name') === 'DELTA');
    if (!delta || !Array.from(delta.getElementsByTagName('block')).some((x) => x.getAttribute('type') === 'read_details')) continue;
    const k = Array.from(delta.getElementsByTagName('block')).filter((x) => x.getAttribute('type') === 'math_number').map((x) => Number(field('NUM', x))).find((n) => n > 0 && n <= 10) ?? 1;
    cfg.recovery = true; cfg.recoveryMode = 'add'; cfg.multiplier = k;
    params.push({ name: 'Loss recovery', value: k, role: 'multiplier' });
    break;
  }

  // Martingale written as "stake × 2" after a loss, without a named variable.
  if (!params.some((p) => p.role === 'multiplier')) {
    for (const b of blocks('math_arithmetic')) {
      if (field('OP', b) !== 'MULTIPLY') continue;
      const sides = Array.from(b.children).filter((c) => c.tagName === 'value').map((v) => num(childBlock(v)));
      const m = sides.find((x) => x !== null && x > 1 && x <= 10);
      if (m) { cfg.multiplier = m; cfg.recovery = true; params.push({ name: 'Martingale', value: m, role: 'multiplier' }); break; }
    }
  }
  if (!params.some((p) => p.role === 'multiplier')) cfg.recovery = false;

  cfg.stake = Math.max(0.35, Number(cfg.stake.toFixed(2)));
  if (cfg.recovery) cfg.maxStake = cfg.recoveryMode === 'add' ? Number((cfg.stopLoss > 0 ? cfg.stopLoss / 2 : cfg.stake * 20).toFixed(2)) : Number((cfg.stake * cfg.multiplier ** 5).toFixed(2));
  if (!(cfg.stopLoss > 0)) { cfg.stopLoss = Number((cfg.stake * 20).toFixed(2)); notes.push('No stop loss in the file. One was added.'); }
  if (cfg.recovery && cfg.recoveryMode !== 'add' && cfg.multiplier > 5) { notes.push(`Martingale ×${cfg.multiplier} lowered to ×5.`); cfg.multiplier = 5; }

  return { name: fileName.replace(/\.xml$/i, '').replace(/[$_]+/g, ' ').trim() || 'Imported bot', config: cfg, params, notes, xml };
}

/** Change a bot's start-up value (e.g. Stake = 2) inside the XML: the first "set <name> to <number>". */
export function setXmlVariable(xml: string, name: string, value: number): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const b of Array.from(doc.getElementsByTagName('block'))) {
    if (b.getAttribute('type') !== 'variables_set') continue;
    const f = Array.from(b.children).find((c) => c.tagName === 'field' && c.getAttribute('name') === 'VAR');
    if ((f?.textContent ?? '').trim() !== name) continue;
    const v = Array.from(b.children).find((c) => c.tagName === 'value' && c.getAttribute('name') === 'VALUE');
    const numBlock = v && Array.from(v.children).find((c) => (c.tagName === 'block' || c.tagName === 'shadow') && c.getAttribute('type') === 'math_number');
    const numField = numBlock && Array.from(numBlock.children).find((c) => c.tagName === 'field' && c.getAttribute('name') === 'NUM');
    if (numField) { numField.textContent = String(value); return new XMLSerializer().serializeToString(doc); }
  }
  return xml;
}
