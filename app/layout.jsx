import { headers } from 'next/headers';
import './globals.css';
import { isHosted } from '../src/api.js';
import { siteOrigin } from '../lib/site.js';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

const title = 'Dockcrate · Docker & CI/CD file generator';
const socialImage = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Dockcrate: Dockerfile, Compose, CI/CD and deployment config for any project.',
};
const LOCAL_DESCRIPTION =
  'Generate a Dockerfile, docker-compose, CI/CD pipeline and deployment config for a new project. Runs locally; nothing leaves your machine.';
const HOSTED_DESCRIPTION =
  'Generate a Dockerfile, docker-compose, CI/CD pipeline and deployment config for a new project. Pick a stack, preview the files, then copy or download them.';

export async function generateMetadata() {
  const description = isHosted() ? HOSTED_DESCRIPTION : LOCAL_DESCRIPTION;
  return {
    metadataBase: new URL(await siteOrigin()),
    title: { default: title, template: '%s · Dockcrate' },
    description,
    applicationName: 'Dockcrate',
    generator: 'Next.js',
    category: 'developer tools',
    keywords: ['Dockerfile generator', 'docker-compose', 'CI/CD', 'GitHub Actions', 'GitLab CI', 'Kubernetes', 'DevOps'],
    authors: [{ name: 'Dockcrate' }],
    referrer: 'no-referrer',
    alternates: { canonical: '/' },
    verification: { google: '7fuQzUlrmv1KCo50jYkC4ePEGz17z9zIaeza4ZLHl_E' },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
    formatDetection: { telephone: false, email: false, address: false },
    openGraph: { type: 'website', siteName: 'Dockcrate', locale: 'en_US', url: '/', title, description, images: [socialImage] },
    twitter: { card: 'summary_large_image', title, description, images: [socialImage] },
    appleWebApp: { capable: true, title: 'Dockcrate', statusBarStyle: 'default' },
    icons: {
      // favicon.ico is added from app/favicon.ico
      icon: [
        { url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
      other: [{ rel: 'mask-icon', url: '/safari-pinned-tab.svg', color: '#2563eb' }],
    },
    other: { 'msapplication-TileColor': '#2563eb' },
  };
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
  ],
};

// Runs before first paint so a saved theme does not flash the OS one.
const THEME_SCRIPT = `try{var t=localStorage.getItem('dockcrate-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

// Both scripts are served by Vercel at /_vercel/*; anywhere else (`dockcrate serve`, `npm run dev`) they 404 and log console errors.
const ON_VERCEL = Boolean(process.env.VERCEL);

export default async function RootLayout({ children }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined; // set by proxy.js; the CSP only runs scripts that carry it
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        {ON_VERCEL && <Analytics />}
        {ON_VERCEL && <SpeedInsights />}
      </body>
    </html>
  );
}
