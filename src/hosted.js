/**
 * Hosted mode (Vercel, or DOCKCRATE_HOSTED=1): the server is a public site, not the user's machine, so any Host is
 * accepted. The API never touches the server's disk in either mode: files are generated to copy or download.
 * `vercel env pull` writes VERCEL=1 with VERCEL_ENV=development into a local .env: that is a developer's machine, not hosted.
 * Its own module (no imports) so proxy.js can use it without bundling the generator.
 */
export const isHosted = () =>
  process.env.DOCKCRATE_HOSTED === '1' || (Boolean(process.env.VERCEL) && process.env.VERCEL_ENV !== 'development');
