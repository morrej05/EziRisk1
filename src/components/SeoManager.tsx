import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE_URL = 'https://ezirisk.co.uk';
const HOMEPAGE_TITLE = 'EziRisk | Fire Risk Assessment & Risk Engineering Software UK';
const HOMEPAGE_DESCRIPTION = 'Fire risk assessment, DSEAR and risk engineering reporting software for UK consultants. Create structured assessments, recommendations, action registers and branded PDF reports.';
const DEFAULT_DESCRIPTION = 'EziRisk assessment and risk engineering reporting software for UK consultants.';
const SOCIAL_IMAGE = `${SITE_URL}/hero-risk.webp`;
const SOCIAL_IMAGE_ALT = 'Fire risk assessor completing a site inspection';
const FRA_SOFTWARE_TITLE = 'Fire Risk Assessment Software UK | FRA Reporting | EziRisk';
const FRA_SOFTWARE_DESCRIPTION = 'Fire risk assessment software for professional UK assessors. Create structured FRAs, capture photo evidence, manage recommendations and issue branded reports with clear action registers.';
const JURISDICTIONS_ARTICLE_PATH = '/insights/fire-risk-assessments-england-wales-scotland';
const JURISDICTIONS_ARTICLE_TITLE = 'Fire Risk Assessments in England, Wales & Scotland | EziRisk';
const JURISDICTIONS_ARTICLE_DESCRIPTION = 'Understand the key differences between fire risk assessment requirements in England, Wales and Scotland, and why jurisdiction matters when preparing FRA reports.';

type RouteMeta = { title: string; description: string; canonical: string; type?: string };

const routeMeta: Record<string, RouteMeta> = {
  '/': { title: HOMEPAGE_TITLE, description: HOMEPAGE_DESCRIPTION, canonical: `${SITE_URL}/`, type: 'website' },
  '/pricing': { title: 'EziRisk Pricing | Risk Assessment Software Plans', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/pricing`, type: 'website' },
  '/contact': { title: 'Contact EziRisk | Risk Assessment Software', description: 'Contact EziRisk about trial access, product demonstrations, platform support or fire risk assessment reporting software.', canonical: `${SITE_URL}/contact`, type: 'website' },
  '/fire-risk-assessment-software': { title: FRA_SOFTWARE_TITLE, description: FRA_SOFTWARE_DESCRIPTION, canonical: `${SITE_URL}/fire-risk-assessment-software`, type: 'website' },
  [JURISDICTIONS_ARTICLE_PATH]: { title: JURISDICTIONS_ARTICLE_TITLE, description: JURISDICTIONS_ARTICLE_DESCRIPTION, canonical: `${SITE_URL}${JURISDICTIONS_ARTICLE_PATH}`, type: 'article' },
  '/security': { title: 'EziRisk Security | Platform Security and Trust', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/security`, type: 'article' },
  '/privacy': { title: 'EziRisk Privacy Policy', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/privacy`, type: 'article' },
  '/terms': { title: 'EziRisk Terms of Use', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/terms`, type: 'article' },
  '/disclaimer': { title: 'EziRisk Professional Liability Disclaimer', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/disclaimer`, type: 'article' },
  '/acceptable-use': { title: 'EziRisk Acceptable Use Policy', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/acceptable-use`, type: 'article' },
  '/subprocessors': { title: 'EziRisk Sub-processors and Infrastructure', description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/subprocessors`, type: 'article' },
};

function setTag(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector(selector) as HTMLMetaElement | HTMLLinkElement | null;
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([key, value]) => el!.setAttribute(key, value));
}

export default function SeoManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = routeMeta[pathname];
    const isIndexable = Boolean(meta);
    const resolvedMeta = meta ?? {
      title: 'EziRisk Platform',
      description: DEFAULT_DESCRIPTION,
      canonical: `${SITE_URL}${pathname}`,
      type: 'website',
    };

    document.title = resolvedMeta.title;
    setTag('meta[name="description"]', { name: 'description', content: resolvedMeta.description });
    setTag('link[rel="canonical"]', { rel: 'canonical', href: resolvedMeta.canonical });
    setTag('meta[name="robots"]', {
      name: 'robots',
      content: isIndexable ? 'index, follow' : 'noindex, nofollow',
    });

    setTag('meta[property="og:title"]', { property: 'og:title', content: resolvedMeta.title });
    setTag('meta[property="og:description"]', { property: 'og:description', content: resolvedMeta.description });
    setTag('meta[property="og:url"]', { property: 'og:url', content: resolvedMeta.canonical });
    setTag('meta[property="og:type"]', { property: 'og:type', content: resolvedMeta.type ?? 'website' });
    setTag('meta[property="og:site_name"]', { property: 'og:site_name', content: 'EziRisk' });
    setTag('meta[property="og:image"]', { property: 'og:image', content: SOCIAL_IMAGE });
    setTag('meta[property="og:image:alt"]', { property: 'og:image:alt', content: SOCIAL_IMAGE_ALT });
    setTag('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    setTag('meta[name="twitter:title"]', { name: 'twitter:title', content: resolvedMeta.title });
    setTag('meta[name="twitter:description"]', { name: 'twitter:description', content: resolvedMeta.description });
    setTag('meta[name="twitter:image"]', { name: 'twitter:image', content: SOCIAL_IMAGE });
    setTag('meta[name="twitter:image:alt"]', { name: 'twitter:image:alt', content: SOCIAL_IMAGE_ALT });
  }, [pathname]);

  useEffect(() => {
    document.head.querySelector('script[data-seo="softwareapp"]')?.remove();
    if (pathname !== '/') return;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-seo', 'softwareapp');
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'EziRisk',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: HOMEPAGE_DESCRIPTION,
      url: `${SITE_URL}/`,
    });
    document.head.appendChild(script);

    return () => script.remove();
  }, [pathname]);

  return null;
}
