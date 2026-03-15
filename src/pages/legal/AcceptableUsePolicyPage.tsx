import LegalPageLayout from '../../components/legal/LegalPageLayout';
import { acceptableUsePolicyContent } from '../../content/legalContent';

export default function AcceptableUsePolicyPage() {
  return <LegalPageLayout content={acceptableUsePolicyContent} />;
}
