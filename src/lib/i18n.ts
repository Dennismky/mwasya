import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'en' | 'sw' | 'fr';
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'fr', label: 'Français' },
];

const en = {
  'nav.overview': 'Overview',
  'nav.sites': 'Sites',
  'nav.forge': 'Bot Forge',
  'nav.xml': 'XML Bots',
  'nav.commissions': 'Commissions',
  'nav.announce': 'Announcements',
  'nav.network': 'Network',
  'nav.billing': 'Billing',
  'nav.fees': 'Mentor fees',
  'nav.support': 'Support',
  'nav.settings': 'Settings',
  'nav.signals': 'Signals',
  'nav.soon': 'Soon',
  'nav.language': 'Language',
  'nav.signOut': 'Sign out',
  'nav.studio': 'OPERATOR STUDIO',
  'nav.owner': 'OWNER · ADMIN',
  'legal.risk': 'Trading carries risk. Bots do not guarantee profit.',
  'login.signIn': 'Sign in',
  'login.sub': "Use your Deriv account. You sign in on Deriv's own page and come straight back here.",
  'login.button': 'Log in with Deriv',
  'login.create': 'Create a Deriv account',
  'xml.title': 'XML Bots',
  'xml.sub': 'Upload Deriv Bot (.xml) strategies and share them with your traders. They download them and load them in Deriv Bot.',
  'com.title': 'Commissions',
  'com.sub': 'Markup you earned from trades placed through your Deriv apps, straight from Deriv.',
  'sup.title': 'Support',
  'sup.sub': 'Questions or problems? Open a ticket and we will reply here.',
  'set.title': 'Settings',
  'set.sub': 'Your profile, language and preferences.',
  'common.save': 'Save',
  'common.saved': 'Saved.',
  'common.loading': 'Loading…',
} as const;

type Key = keyof typeof en;

const sw: Record<Key, string> = {
  'nav.overview': 'Muhtasari',
  'nav.sites': 'Tovuti',
  'nav.forge': 'Bot Forge',
  'nav.xml': 'Boti za XML',
  'nav.commissions': 'Kamisheni',
  'nav.announce': 'Matangazo',
  'nav.network': 'Mtandao',
  'nav.billing': 'Malipo',
  'nav.fees': 'Ada za washauri',
  'nav.support': 'Msaada',
  'nav.settings': 'Mipangilio',
  'nav.signals': 'Ishara',
  'nav.soon': 'Hivi karibuni',
  'nav.language': 'Lugha',
  'nav.signOut': 'Toka',
  'nav.studio': 'STUDIO YA MWENDESHAJI',
  'nav.owner': 'MMILIKI · MSIMAMIZI',
  'legal.risk': 'Biashara ina hatari. Boti hazihakikishi faida.',
  'login.signIn': 'Ingia',
  'login.sub': 'Tumia akaunti yako ya Deriv. Unaingia kwenye ukurasa wa Deriv na kurudi hapa moja kwa moja.',
  'login.button': 'Ingia kwa Deriv',
  'login.create': 'Fungua akaunti ya Deriv',
  'xml.title': 'Boti za XML',
  'xml.sub': 'Pakia mikakati ya Deriv Bot (.xml) na uwashirikishe wafanyabiashara wako. Wanazipakua na kuzifungua kwenye Deriv Bot.',
  'com.title': 'Kamisheni',
  'com.sub': 'Ada uliyopata kutokana na biashara zilizofanywa kupitia programu zako za Deriv, moja kwa moja kutoka Deriv.',
  'sup.title': 'Msaada',
  'sup.sub': 'Una swali au tatizo? Fungua tiketi na tutakujibu hapa.',
  'set.title': 'Mipangilio',
  'set.sub': 'Wasifu wako, lugha na mapendeleo.',
  'common.save': 'Hifadhi',
  'common.saved': 'Imehifadhiwa.',
  'common.loading': 'Inapakia…',
};

const fr: Record<Key, string> = {
  'nav.overview': 'Aperçu',
  'nav.sites': 'Sites',
  'nav.forge': 'Bot Forge',
  'nav.xml': 'Bots XML',
  'nav.commissions': 'Commissions',
  'nav.announce': 'Annonces',
  'nav.network': 'Réseau',
  'nav.billing': 'Facturation',
  'nav.fees': 'Frais des mentors',
  'nav.support': 'Support',
  'nav.settings': 'Paramètres',
  'nav.signals': 'Signaux',
  'nav.soon': 'Bientôt',
  'nav.language': 'Langue',
  'nav.signOut': 'Déconnexion',
  'nav.studio': 'STUDIO OPÉRATEUR',
  'nav.owner': 'PROPRIÉTAIRE · ADMIN',
  'legal.risk': 'Le trading comporte des risques. Les bots ne garantissent aucun profit.',
  'login.signIn': 'Connexion',
  'login.sub': 'Utilisez votre compte Deriv. Vous vous connectez sur la page de Deriv et revenez ici directement.',
  'login.button': 'Se connecter avec Deriv',
  'login.create': 'Créer un compte Deriv',
  'xml.title': 'Bots XML',
  'xml.sub': 'Téléversez des stratégies Deriv Bot (.xml) et partagez-les avec vos traders. Ils les téléchargent et les ouvrent dans Deriv Bot.',
  'com.title': 'Commissions',
  'com.sub': 'La marge gagnée sur les trades passés via vos applications Deriv, directement depuis Deriv.',
  'sup.title': 'Support',
  'sup.sub': 'Une question ou un problème ? Ouvrez un ticket et nous vous répondrons ici.',
  'set.title': 'Paramètres',
  'set.sub': 'Votre profil, votre langue et vos préférences.',
  'common.save': 'Enregistrer',
  'common.saved': 'Enregistré.',
  'common.loading': 'Chargement…',
};

const DICTS: Record<Lang, Record<Key, string>> = { en, sw, fr };

interface LangStore { lang: Lang; setLang: (l: Lang) => void }

export const useLang = create<LangStore>()(
  persist((set) => ({ lang: 'en', setLang: (lang) => { document.documentElement.lang = lang; set({ lang }); } }), { name: 'mw_lang' }),
);

/** const t = useT(); t('nav.overview') */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: Key) => DICTS[lang][key] ?? en[key];
}
