/**
 * An announcement's message with its links made clickable (https only). A WhatsApp group / chat link becomes a
 * green "Join WhatsApp group" button, so clients can join the mentor's group in one tap.
 */
const URL_RE = /(https:\/\/[^\s<>"']+)/g;
// EDIT HERE: which links count as WhatsApp (shown as the green button).
export const isWhatsApp = (u: string) => /^https:\/\/(chat\.whatsapp\.com|wa\.me|whatsapp\.com\/channel|www\.whatsapp\.com\/channel)\//i.test(u);

export function AnnouncementText({ text }: { text: string }) {
  const wa = (text.match(URL_RE) ?? []).filter(isWhatsApp);
  // WhatsApp links become the button below, so they leave the text (and no empty lines are left behind).
  const clean = wa.reduce((t, u) => t.split(u).join(''), text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const parts = clean.split(URL_RE);
  return (
    <>
      <p className="an-text">
        {parts.map((p, i) => {
          if (i % 2 === 0) return p;
          const url = p.replace(/[.,);]+$/, '');
          const tail = p.slice(url.length);
          if (isWhatsApp(url)) return tail; // shown as the button below
          return <span key={i}><a href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https:\/\//, '')}</a>{tail}</span>;
        })}
      </p>
      {wa.map((u, i) => (
        <a key={i} className="an-wa" href={u.replace(/[.,);]+$/, '')} target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" /></svg>
          Join WhatsApp group
        </a>
      ))}
    </>
  );
}
