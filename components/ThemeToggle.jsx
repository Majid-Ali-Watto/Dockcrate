'use client';

import { useEffect, useState } from 'react';

const KEY = 'dockcrate-theme'; // also read by the inline script in app/layout.jsx before first paint

// "system" has no data-theme attribute, so the OS preference decides (see globals.css).
function apply(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState('system');

  useEffect(() => {
    try {
      setTheme(localStorage.getItem(KEY) || 'system');
    } catch {}
  }, []);

  const choose = (next) => {
    setTheme(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
  };

  return (
    <select className="theme" aria-label="Theme" value={theme} onChange={(e) => choose(e.target.value)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
