import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE_URL = 'https://www.ezirisk.co.uk';
const DEFAULT_DESCRIPTION = 'EziRisk helps risk engineers create FRA, FSD, DSEAR / ATEX and property risk engineering reports with structured workflows, recommendations and portfolio insight.';
const DEFAULT_TITLE = 'EziRisk | Risk Assessment and Risk Engineering Reporting Software';

const routeMeta: Record<string, { title: string; description: string; canonical: string; type?: string }> = {
  '/': { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/`, type: 'website' },
  '/pricing': { title: 'EziRisk Pricing | Risk Assessment Software Plans', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/pricing`, type: 'website' },
  '/security': { title: 'EziRisk Security | Platform Security and Trust', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/security`, type: 'website' },
  '/privacy': { title: 'EziRisk Privacy Policy', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/privacy`, type: 'article' },
  '/terms': { title: 'EziRisk Terms of Use', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/terms`, type: 'article' },
};

const privateRoutes = ['/dashboard', '/admin', '/login', '/register'];

function setTag(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector(selector) as HTMLMetaElement | HTMLLinkElement | null;
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
}

export default function SeoManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = routeMeta[pathname] ?? routeMeta['/'];
    document.title = meta.title;

    setTag('meta[name="description"]', { name: 'description', content: meta.description });
    setTag('link[rel="canonical"]', { rel: 'canonical', href: meta.canonical });

    const robots = privateRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
      ? 'noindex, nofollow'
      : 'index, follow';
    setTag('meta[name="robots"]', { name: 'robots', content: robots });

    const ogUrl = meta.canonical;
    setTag('meta[property="og:title"]', { property: 'og:title', content: meta.title });
    setTag('meta[property="og:description"]', { property: 'og:description', content: meta.description });
    setTag('meta[property="og:url"]', { property: 'og:url', content: ogUrl });
    setTag('meta[property="og:type"]', { property: 'og:type', content: meta.type ?? 'website' });
    setTag('meta[property="og:image"]', { property: 'og:image', content: `${SITE_URL}/og-image.png` });
  }, [pathname]);

  useEffect(() => {
    if (pathname === '/') {
      setTag('script[type="application/ld+json"]', {});
      const existing = document.head.querySelector('script[data-seo="softwareapp"]');
      if (existing) existing.remove();
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-seo', 'softwareapp');
      script.text = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'EziRisk',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: DEFAULT_DESCRIPTION,
        url: `${SITE_URL}/`,
      });
      document.head.appendChild(script);
    }
  }, [pathname]);

  return null;
}
