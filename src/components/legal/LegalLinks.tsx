import { Link } from 'react-router-dom';

const legalLinks = [
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms of Use' },
  { to: '/disclaimer', label: 'Professional Liability Disclaimer' },
  { to: '/security', label: 'Security & Trust' },
  { to: '/acceptable-use', label: 'Acceptable Use Policy' },
  { to: '/subprocessors', label: 'Sub-processors / Infrastructure' },
];

interface LegalLinksProps {
  className?: string;
  itemClassName?: string;
}

export default function LegalLinks({ className, itemClassName }: LegalLinksProps) {
  return (
    <ul className={className ?? 'space-y-2'}>
      {legalLinks.map((link) => (
        <li key={link.to}>
          <Link to={link.to} className={itemClassName ?? 'text-neutral-400 hover:text-white transition-colors'}>
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
