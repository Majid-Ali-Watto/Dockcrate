// Privacy policy and terms of use (/privacy, /terms). States only what the site does (README, "Deploying to Vercel"):
// keep it in step with the code when storage, analytics or hosting change, and bump UPDATED.

export const REPO_URL = 'https://github.com/Majid-Ali-Watto/Dockcrate';
const ISSUES_URL = `${REPO_URL}/issues`;
export const UPDATED = '17 October 2026';

export const LEGAL = [
  {
    slug: 'privacy',
    nav: 'Privacy',
    title: 'Privacy policy',
    description: 'What Dockcrate does with your data: no accounts, no cookies, nothing you type is stored on the server, and the options you choose stay in your browser.',
    h1: 'Privacy policy',
    lead: 'Dockcrate has no accounts, no ads and no sign-up. This page says what happens to the little data that does pass through it.',
    sections: [
      {
        h: 'What you type',
        text: [
          'The options you choose and the edits you make to the generated files are sent to the generator (/api/generate) so it can produce the files. They are processed in memory to build the response. The site does not save them, and it does not use them for anything else.',
          'Nothing is read from your computer or from an existing project. Do not put real secrets, such as passwords or tokens, into the options or into block edits: the files you copy or download are plain text, and the generated pipelines expect secrets to be set in your CI provider.',
        ],
      },
      {
        h: 'What stays in your browser',
        text: ['The site stores two things in your browser\'s local storage, on your device only:'],
        list: [
          'your options and block edits (key dockcrate-form-v1), so they are still there on your next visit. "Start over" in the editor clears them;',
          'your light, dark or system theme choice (key dockcrate-theme).',
        ],
        after: 'The site sets no cookies. You can clear this data at any time in your browser\'s site settings.',
      },
      {
        h: 'Hosting and analytics',
        text: [
          'The public site runs on Vercel. Like any web host, Vercel receives and may log standard request data such as your IP address, browser and the pages you open, under its own privacy policy.',
          'The hosted site also uses Vercel Web Analytics and Vercel Speed Insights to count page views and measure how fast pages load. They are provided by Vercel, are used only to understand traffic and performance, and are not used to build advertising profiles. They do not receive the options you choose or the files you generate.',
        ],
      },
      {
        h: 'Running it yourself',
        text: ['The command line tool and a locally run web UI (dockcrate serve) work entirely on your machine. Nothing leaves it, and the analytics scripts are not loaded.'],
      },
      {
        h: 'Sharing',
        text: ['Your data is not sold or shared with advertisers. It reaches only the hosting and analytics provider named above, which process it on the site\'s behalf.'],
      },
      {
        h: 'Links to other sites',
        text: ['The site links to other websites, such as the developer\'s portfolio and related tools. They have their own privacy practices, which this policy does not cover.'],
      },
      {
        h: 'Changes and contact',
        text: [
          'If this policy changes, the new version is published on this page with a new date. The date above is the last time it changed.',
          'Questions about privacy can be raised by opening an issue on the project\'s GitHub page.',
        ],
        link: [ISSUES_URL, 'Open an issue on GitHub'],
      },
    ],
  },
  {
    slug: 'terms',
    nav: 'Terms',
    title: 'Terms of use',
    description: 'The terms for using Dockcrate: the generated files are a draft to review, the service is provided as is, and the source code is MIT licensed.',
    h1: 'Terms of use',
    lead: 'By using Dockcrate you agree to these terms. If you do not agree, please do not use the site.',
    sections: [
      {
        h: 'What Dockcrate is',
        text: ['Dockcrate generates Dockerfiles, Compose files, CI/CD pipelines and deployment config from the options you choose. It is a free tool, offered without sign-up.'],
      },
      {
        h: 'The files are a draft',
        text: [
          'The generated files are a very good first draft, not a guarantee. Pipelines are checked as text and not run on your CI, and deployment files are templates that were never run against a real account. Review every file, test it, and adjust it before you rely on it, especially before it touches production, credentials or cloud resources.',
          'You are responsible for what you do with the files, including their cost, security and effect on your systems.',
        ],
      },
      {
        h: 'Your files',
        text: ['You own what you generate. The generated output carries no licence requirement from Dockcrate, and you can use, change and share it however you like. The tool and the services you deploy to are your responsibility to license and configure correctly.'],
      },
      {
        h: 'Acceptable use',
        text: ['Please use the site and its API fairly. Do not:'],
        list: [
          'overload the service or send large volumes of automated requests;',
          'try to break, probe or get around its limits or security protections;',
          'use it to attack, harm or infringe the rights of anyone.',
        ],
        after: 'Access may be limited or blocked for use that harms the service or other people.',
      },
      {
        h: 'Source code licence',
        text: ['The Dockcrate source code is published under the MIT licence, which you can read in the project repository. These terms cover your use of the website; the licence covers the code.'],
        link: [REPO_URL, 'Dockcrate on GitHub'],
      },
      {
        h: 'No warranty',
        text: ['The site and the generated files are provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy, and availability. The site may change, be interrupted or be removed at any time.'],
      },
      {
        h: 'Limit of liability',
        text: ['To the fullest extent the law allows, the developer is not liable for any loss or damage, direct or indirect, that comes from using the site or the generated files, including lost data, downtime, security incidents or cloud charges.'],
      },
      {
        h: 'Trademarks',
        text: ['Docker, GitHub, GitLab, Kubernetes and the other product names on the site belong to their owners. They are used only to say what the generated files are for, and their use does not imply endorsement.'],
      },
      {
        h: 'Changes and contact',
        text: [
          'These terms may change. The new version is published on this page with a new date, and using the site after that means you accept it.',
          'Questions about these terms can be raised by opening an issue on the project\'s GitHub page.',
        ],
        link: [ISSUES_URL, 'Open an issue on GitHub'],
      },
    ],
  },
];

export function legalBySlug(slug) {
  return LEGAL.find((page) => page.slug === slug);
}

export function legalMetadata(slug) {
  const { title, description } = legalBySlug(slug);
  const url = `/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title, description },
    twitter: { title, description },
  };
}
