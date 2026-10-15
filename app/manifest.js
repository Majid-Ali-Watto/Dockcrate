export default function manifest() {
  return {
    id: '/',
    name: 'Shipkit · Docker & CI/CD file generator',
    short_name: 'Shipkit',
    description: 'Generate Dockerfile, compose, CI/CD and deployment files for any project.',
    start_url: '/',
    scope: '/',
    lang: 'en',
    dir: 'ltr',
    display: 'standalone',
    orientation: 'any',
    categories: ['developer', 'productivity', 'utilities'],
    background_color: '#f6f7f9',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
