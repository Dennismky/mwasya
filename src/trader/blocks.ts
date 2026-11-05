import * as Blockly from 'blockly';
import type { BotConfig } from './botEngine';
import { SYMBOLS } from './ticks';

/**
 * Mwasya's trading blocks. Block and field names match the Deriv Bot XML format so files open in both,
 * but the definitions, wording, colours and layout here are our own.
 */

export const C = { trade: '#3F4A5A', purchase: '#2F3A48', sell: '#5A6575', restart: '#252E3A', data: '#4E5968', notify: '#6B7482' };

const contractOptions: [string, string][] = [
  ['Over', 'DIGITOVER'], ['Under', 'DIGITUNDER'], ['Matches', 'DIGITMATCH'], ['Differs', 'DIGITDIFF'],
  ['Even', 'DIGITEVEN'], ['Odd', 'DIGITODD'], ['Rise', 'CALL'], ['Fall', 'PUT'],
];
const symbolOptions = (): [string, string][] => SYMBOLS.filter((s) => /^(1HZ|R_)/.test(s.id)).map((s) => [s.name, s.id]);

let done = false;
export function defineMwasyaBlocks() {
  if (done) return;
  done = true;
  const defs: Record<string, (this: Blockly.Block) => void> = {
    trade_definition(this: Blockly.Block) {
      this.appendDummyInput().appendField('1. Trade parameters');
      this.appendStatementInput('TRADE_OPTIONS').appendField('Market & type');
      this.appendStatementInput('INITIALIZATION').appendField('Run once at start');
      this.appendStatementInput('SUBMARKET').appendField('Trade options');
      this.setColour(C.trade); this.setDeletable(false);
    },
    trade_definition_market(this: Blockly.Block) {
      this.appendDummyInput().appendField('Market')
        .appendField(new Blockly.FieldDropdown([['Derived', 'synthetic_index']]), 'MARKET_LIST')
        .appendField(new Blockly.FieldDropdown([['Continuous indices', 'random_index']]), 'SUBMARKET_LIST')
        .appendField(new Blockly.FieldDropdown(symbolOptions), 'SYMBOL_LIST');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.trade);
    },
    trade_definition_tradetype(this: Blockly.Block) {
      this.appendDummyInput().appendField('Trade type')
        .appendField(new Blockly.FieldDropdown([['Digits', 'digits'], ['Up/Down', 'callput']]), 'TRADETYPECAT_LIST')
        .appendField(new Blockly.FieldDropdown([['Over/Under', 'overunder'], ['Matches/Differs', 'matchesdiffers'], ['Even/Odd', 'evenodd'], ['Rise/Fall', 'risefall']]), 'TRADETYPE_LIST');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.trade);
    },
    trade_definition_contracttype(this: Blockly.Block) {
      this.appendDummyInput().appendField('Contract type').appendField(new Blockly.FieldDropdown([['Both', 'both'], ...contractOptions]), 'TYPE_LIST');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.trade);
    },
    trade_definition_candleinterval(this: Blockly.Block) {
      this.appendDummyInput().appendField('Candle interval').appendField(new Blockly.FieldDropdown([['1 minute', '60'], ['2 minutes', '120'], ['5 minutes', '300'], ['1 hour', '3600']]), 'CANDLEINTERVAL_LIST');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.trade);
    },
    trade_definition_restartbuysell(this: Blockly.Block) {
      this.appendDummyInput().appendField('Restart buy/sell on error').appendField(new Blockly.FieldCheckbox('FALSE'), 'TIME_MACHINE_ENABLED');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.trade);
    },
    trade_definition_restartonerror(this: Blockly.Block) {
      this.appendDummyInput().appendField('Restart last trade on error').appendField(new Blockly.FieldCheckbox('TRUE'), 'RESTARTONERROR');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.trade);
    },
    trade_definition_tradeoptions(this: Blockly.Block) {
      this.appendDummyInput().appendField('Duration').appendField(new Blockly.FieldDropdown([['Ticks', 't'], ['Seconds', 's'], ['Minutes', 'm']]), 'DURATIONTYPE_LIST');
      this.appendValueInput('DURATION').setCheck('Number');
      this.appendValueInput('AMOUNT').setCheck('Number').appendField('Stake');
      this.appendValueInput('PREDICTION').setCheck('Number').appendField('Prediction');
      this.setInputsInline(true); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.trade);
    },
    before_purchase(this: Blockly.Block) {
      this.appendDummyInput().appendField('2. Purchase conditions');
      this.appendStatementInput('BEFOREPURCHASE_STACK');
      this.setColour(C.purchase); this.setDeletable(false);
    },
    during_purchase(this: Blockly.Block) {
      this.appendDummyInput().appendField('3. Sell conditions');
      this.appendStatementInput('DURING_PURCHASE_STACK');
      this.setColour(C.sell);
    },
    after_purchase(this: Blockly.Block) {
      this.appendDummyInput().appendField('4. Restart trading conditions');
      this.appendStatementInput('AFTERPURCHASE_STACK');
      this.setColour(C.restart); this.setDeletable(false);
    },
    purchase(this: Blockly.Block) {
      this.appendDummyInput().appendField('Purchase').appendField(new Blockly.FieldDropdown(contractOptions), 'PURCHASE_LIST');
      this.setPreviousStatement(true); this.setColour(C.purchase);
    },
    sell_at_market(this: Blockly.Block) {
      this.appendDummyInput().appendField('Sell at market price');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.sell);
    },
    check_sell(this: Blockly.Block) {
      this.appendDummyInput().appendField('Sell is available'); this.setOutput(true, 'Boolean'); this.setColour(C.sell);
    },
    sell_price(this: Blockly.Block) {
      this.appendDummyInput().appendField('Sell profit/loss'); this.setOutput(true, 'Number'); this.setColour(C.sell);
    },
    trade_again(this: Blockly.Block) {
      this.appendDummyInput().appendField('Trade again');
      this.setPreviousStatement(true); this.setColour(C.restart);
    },
    contract_check_result(this: Blockly.Block) {
      this.appendDummyInput().appendField('Result is').appendField(new Blockly.FieldDropdown([['Win', 'win'], ['Loss', 'loss']]), 'CHECK_RESULT');
      this.setOutput(true, 'Boolean'); this.setColour(C.restart);
    },
    read_details(this: Blockly.Block) {
      this.appendDummyInput().appendField('Contract detail').appendField(new Blockly.FieldDropdown([
        ['profit', '4'], ['buy price', '2'], ['payout', '3'], ['contract type', '5'], ['entry spot', '7'], ['exit spot', '9'], ['barrier', '10'], ['result', '11'], ['reference id', '1'],
      ]), 'DETAIL_INDEX');
      this.setOutput(true); this.setColour(C.restart);
    },
    total_profit(this: Blockly.Block) { this.appendDummyInput().appendField('Total profit'); this.setOutput(true, 'Number'); this.setColour(C.data); },
    total_runs(this: Blockly.Block) { this.appendDummyInput().appendField('Number of runs'); this.setOutput(true, 'Number'); this.setColour(C.data); },
    balance(this: Blockly.Block) {
      this.appendDummyInput().appendField('Balance').appendField(new Blockly.FieldDropdown([['number', 'NUM'], ['text', 'STR']]), 'BALANCE_TYPE');
      this.setOutput(true); this.setColour(C.data);
    },
    tick(this: Blockly.Block) { this.appendDummyInput().appendField('Last tick'); this.setOutput(true, 'Number'); this.setColour(C.data); },
    last_digit(this: Blockly.Block) { this.appendDummyInput().appendField('Last digit'); this.setOutput(true, 'Number'); this.setColour(C.data); },
    ticks(this: Blockly.Block) { this.appendDummyInput().appendField('Ticks list'); this.setOutput(true, 'Array'); this.setColour(C.data); },
    lastDigitList(this: Blockly.Block) { this.appendDummyInput().appendField('Last digits list'); this.setOutput(true, 'Array'); this.setColour(C.data); },
    check_direction(this: Blockly.Block) {
      this.appendDummyInput().appendField('Direction is').appendField(new Blockly.FieldDropdown([['Rise', 'rise'], ['Fall', 'fall'], ['No change', 'still']]), 'CHECK_DIRECTION');
      this.setOutput(true, 'Boolean'); this.setColour(C.data);
    },
    notify(this: Blockly.Block) {
      this.appendValueInput('MESSAGE').appendField('Notify')
        .appendField(new Blockly.FieldDropdown([['green', 'success'], ['blue', 'info'], ['yellow', 'warn'], ['red', 'error']]), 'NOTIFICATION_TYPE')
        .appendField(new Blockly.FieldDropdown([['silent', 'silent'], ['beep', 'beep']]), 'NOTIFICATION_SOUND');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.notify);
    },
    text_print(this: Blockly.Block) {
      this.appendValueInput('TEXT').appendField('Print');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C.notify);
    },
  };
  for (const [type, init] of Object.entries(defs)) Blockly.Blocks[type] = { init };
}

/** Blocks menu: categories shown in the left sidebar. */
export const MENU: { id: string; name: string; colour: string; blocks: string[] }[] = [
  { id: 'trade', name: 'Trade parameters', colour: C.trade, blocks: ['trade_definition_market', 'trade_definition_tradetype', 'trade_definition_contracttype', 'trade_definition_tradeoptions'] },
  { id: 'purchase', name: 'Purchase conditions', colour: C.purchase, blocks: ['purchase'] },
  { id: 'sell', name: 'Sell conditions (optional)', colour: C.sell, blocks: ['during_purchase', 'sell_at_market', 'check_sell', 'sell_price'] },
  { id: 'restart', name: 'Restart trading conditions', colour: C.restart, blocks: ['trade_again', 'contract_check_result', 'read_details'] },
  { id: 'analysis', name: 'Analysis', colour: C.data, blocks: ['last_digit', 'tick', 'ticks', 'lastDigitList', 'check_direction', 'total_profit', 'total_runs', 'balance'] },
  { id: 'logic', name: 'Logic', colour: '#5B80A5', blocks: ['controls_if', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean'] },
  { id: 'math', name: 'Maths', colour: '#5B67A5', blocks: ['math_number', 'math_arithmetic', 'math_single', 'math_round', 'math_modulo', 'math_constrain', 'math_random_int'] },
  { id: 'loops', name: 'Loops', colour: '#5BA55B', blocks: ['controls_repeat_ext', 'controls_whileUntil', 'controls_flow_statements'] },
  { id: 'text', name: 'Text & notify', colour: C.notify, blocks: ['notify', 'text_print', 'text', 'text_join'] },
  { id: 'vars', name: 'Variables', colour: '#A55B80', blocks: ['variables_set', 'variables_get', 'math_change'] },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => `<block type="math_number"><field name="NUM">${v}</field></block>`;
const v = (name: string) => `<block type="variables_get"><field name="VAR">${esc(name)}</field></block>`;
const setVar = (name: string, value: string, next = '') => `<block type="variables_set"><field name="VAR">${esc(name)}</field><value name="VALUE">${value}</value>${next ? `<next>${next}</next>` : ''}</block>`;

/** Turn the Quick strategy settings into a full block bot (market, purchase, martingale or add-the-loss, limits). */
export function configToXml(c: BotConfig): string {
  const digitType = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(c.contract);
  const cat = c.contract === 'CALL' || c.contract === 'PUT' ? ['callput', 'risefall'] : c.contract.startsWith('DIGITEVEN') || c.contract === 'DIGITODD' ? ['digits', 'evenodd'] : c.contract === 'DIGITMATCH' || c.contract === 'DIGITDIFF' ? ['digits', 'matchesdiffers'] : ['digits', 'overunder'];
  const init = setVar('Initial stake', n(c.stake), setVar('Stake', n(c.stake), setVar('Take profit', n(c.takeProfit), setVar('Stop loss', n(c.stopLoss), setVar('Martingale', n(c.recovery ? c.multiplier : 1), setVar('Max stake', n(c.maxStake || 1000)))))));
  const purchase = `<block type="purchase"><field name="PURCHASE_LIST">${c.contract}</field></block>`;
  const before = c.entryDigit === null ? purchase
    : `<block type="controls_if"><value name="IF0"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="last_digit"></block></value><value name="B">${n(c.entryDigit)}</value></block></value><statement name="DO0">${purchase}</statement></block>`;
  const raise = c.recoveryMode === 'add'
    ? `<block type="math_arithmetic"><field name="OP">ADD</field><value name="A">${v('Stake')}</value><value name="B"><block type="math_arithmetic"><field name="OP">MULTIPLY</field><value name="A"><block type="math_single"><field name="OP">ABS</field><value name="NUM"><block type="read_details"><field name="DETAIL_INDEX">4</field></block></value></block></value><value name="B">${v('Martingale')}</value></block></value></block>`
    : `<block type="math_arithmetic"><field name="OP">MULTIPLY</field><value name="A">${v('Stake')}</value><value name="B">${v('Martingale')}</value></block>`;
  const onLoss = c.recovery ? setVar('Stake', `<block type="math_constrain"><value name="VALUE">${raise}</value><value name="LOW">${n(0.35)}</value><value name="HIGH">${v('Max stake')}</value></block>`) : setVar('Stake', v('Initial stake'));
  const limits = `<block type="controls_if"><mutation elseif="1" else="1"></mutation>`
    + `<value name="IF0"><block type="logic_compare"><field name="OP">GTE</field><value name="A"><block type="total_profit"></block></value><value name="B">${v('Take profit')}</value></block></value>`
    + `<statement name="DO0"><block type="notify"><field name="NOTIFICATION_TYPE">success</field><field name="NOTIFICATION_SOUND">silent</field><value name="MESSAGE"><block type="text"><field name="TEXT">Take profit reached</field></block></value></block></statement>`
    + `<value name="IF1"><block type="logic_compare"><field name="OP">LTE</field><value name="A"><block type="total_profit"></block></value><value name="B"><block type="math_single"><field name="OP">NEG</field><value name="NUM">${v('Stop loss')}</value></block></value></block></value>`
    + `<statement name="DO1"><block type="notify"><field name="NOTIFICATION_TYPE">error</field><field name="NOTIFICATION_SOUND">silent</field><value name="MESSAGE"><block type="text"><field name="TEXT">Stop loss reached</field></block></value></block></statement>`
    + `<statement name="ELSE"><block type="trade_again"></block></statement></block>`;
  const after = `<block type="controls_if"><mutation else="1"></mutation><value name="IF0"><block type="contract_check_result"><field name="CHECK_RESULT">win</field></block></value>`
    + `<statement name="DO0">${setVar('Stake', v('Initial stake'))}</statement><statement name="ELSE">${onLoss}</statement><next>${limits}</next></block>`;
  return `<xml xmlns="https://developers.google.com/blockly/xml">`
    + `<variables>${['Initial stake', 'Stake', 'Take profit', 'Stop loss', 'Martingale', 'Max stake'].map((x) => `<variable>${x}</variable>`).join('')}</variables>`
    + `<block type="trade_definition" x="20" y="20">`
    + `<statement name="TRADE_OPTIONS"><block type="trade_definition_market"><field name="MARKET_LIST">synthetic_index</field><field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">${c.symbol}</field>`
    + `<next><block type="trade_definition_tradetype"><field name="TRADETYPECAT_LIST">${cat[0]}</field><field name="TRADETYPE_LIST">${cat[1]}</field>`
    + `<next><block type="trade_definition_contracttype"><field name="TYPE_LIST">${c.contract}</field></block></next></block></next></block></statement>`
    + `<statement name="INITIALIZATION">${init}</statement>`
    + `<statement name="SUBMARKET"><block type="trade_definition_tradeoptions"><field name="DURATIONTYPE_LIST">t</field><value name="DURATION">${n(c.ticks)}</value><value name="AMOUNT">${v('Stake')}</value>`
    + `<value name="PREDICTION">${n(digitType ? c.prediction : 0)}</value></block></statement></block>`
    + `<block type="before_purchase" x="20" y="520"><statement name="BEFOREPURCHASE_STACK">${before}</statement></block>`
    + `<block type="after_purchase" x="560" y="20"><statement name="AFTERPURCHASE_STACK">${after}</statement></block>`
    + `</xml>`;
}
