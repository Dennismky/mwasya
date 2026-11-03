/**
 * Safaricom Daraja — Lipa na M-Pesa Online (STK push).
 * Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 *
 * Env (server only):
 *   MPESA_ENV              sandbox | production
 *   MPESA_CONSUMER_KEY     Daraja app consumer key
 *   MPESA_CONSUMER_SECRET  Daraja app consumer secret
 *   MPESA_SHORTCODE        Business shortcode used for the password (Paybill, or Till's store number)
 *   MPESA_PASSKEY          Lipa na M-Pesa Online passkey
 *   MPESA_TYPE             paybill (CustomerPayBillOnline) | till (CustomerBuyGoodsOnline). Default paybill
 *   MPESA_PARTY_B          Receiving number: Paybill = shortcode; Till = till number. Default MPESA_SHORTCODE
 *   MPESA_CALLBACK_KEY     Long random string; Safaricom calls back with it so we can reject forged callbacks
 *   PUBLIC_BASE_URL        e.g. https://mwasya.site
 */

const BASE = () => (process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

export function mpesaConfigured(): boolean {
  return ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_KEY', 'PUBLIC_BASE_URL']
    .every((k) => Boolean(process.env[k]));
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let tokenCache: { token: string; exp: number } | undefined;

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  const basic = Buffer.from(`${must('MPESA_CONSUMER_KEY')}:${must('MPESA_CONSUMER_SECRET')}`).toString('base64');
  const r = await fetch(`${BASE()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`mpesa_auth_${r.status}`);
  const j = (await r.json()) as { access_token?: string; expires_in?: string | number };
  if (!j.access_token) throw new Error('mpesa_auth_no_token');
  tokenCache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in ?? 3599) - 60) * 1000 };
  return j.access_token;
}

/** Daraja wants YYYYMMDDHHmmss in Kenyan time. */
function timestamp(): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date()).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}${p.month}${p.day}${p.hour === '24' ? '00' : p.hour}${p.minute}${p.second}`;
}

function password(ts: string): string {
  return Buffer.from(`${must('MPESA_SHORTCODE')}${must('MPESA_PASSKEY')}${ts}`).toString('base64');
}

/** 07XXXXXXXX / 7XXXXXXXX / +2547XXXXXXXX / 2541XXXXXXXX → 2547XXXXXXXX. Returns null if not a Kenyan mobile number. */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s()+-]/g, '');
  const m = d.match(/^(?:254|0)?([17]\d{8})$/);
  return m ? `254${m[1]}` : null;
}

export interface StkResult { merchantRequestId: string; checkoutRequestId: string; customerMessage?: string }

export async function stkPush(opts: { phone: string; amount: number; reference: string; description: string }): Promise<StkResult> {
  const ts = timestamp();
  const type = process.env.MPESA_TYPE === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline';
  const callback = `${must('PUBLIC_BASE_URL').replace(/\/$/, '')}/api/billing/mpesa-callback?k=${encodeURIComponent(must('MPESA_CALLBACK_KEY'))}`;
  const r = await fetch(`${BASE()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: must('MPESA_SHORTCODE'),
      Password: password(ts),
      Timestamp: ts,
      TransactionType: type,
      Amount: Math.round(opts.amount),
      PartyA: opts.phone,
      PartyB: process.env.MPESA_PARTY_B || must('MPESA_SHORTCODE'),
      PhoneNumber: opts.phone,
      CallBackURL: callback,
      AccountReference: opts.reference.slice(0, 12),
      TransactionDesc: opts.description.slice(0, 13),
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { ResponseCode?: string; MerchantRequestID?: string; CheckoutRequestID?: string; CustomerMessage?: string; errorMessage?: string };
  if (!r.ok || j.ResponseCode !== '0' || !j.CheckoutRequestID || !j.MerchantRequestID) {
    throw new Error(j.errorMessage || `mpesa_stk_failed_${r.status}`);
  }
  return { merchantRequestId: j.MerchantRequestID, checkoutRequestId: j.CheckoutRequestID, customerMessage: j.CustomerMessage };
}

export type StkOutcome = { state: 'paid' | 'failed' | 'cancelled' | 'pending'; resultCode?: string; resultDesc?: string };

/** Ask Safaricom for the true state of an STK request (used to confirm callbacks and to settle missed ones). */
export async function stkQuery(checkoutRequestId: string): Promise<StkOutcome> {
  const ts = timestamp();
  const r = await fetch(`${BASE()}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ BusinessShortCode: must('MPESA_SHORTCODE'), Password: password(ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  const j = (await r.json().catch(() => ({}))) as { ResultCode?: string | number; ResultDesc?: string; errorCode?: string; errorMessage?: string };
  // While the customer hasn't answered, Daraja returns an error like "The transaction is being processed".
  if (j.ResultCode === undefined) return { state: 'pending', resultDesc: j.errorMessage };
  const code = String(j.ResultCode);
  if (code === '0') return { state: 'paid', resultCode: code, resultDesc: j.ResultDesc };
  if (code === '1032') return { state: 'cancelled', resultCode: code, resultDesc: j.ResultDesc };
  return { state: 'failed', resultCode: code, resultDesc: j.ResultDesc };
}
