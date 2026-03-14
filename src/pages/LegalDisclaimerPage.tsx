import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CURRENT_DISCLAIMER_VERSION } from '../config/legal';

export default function LegalDisclaimerPage() {
  const navigate = useNavigate();
  const { user, refreshUserRole, hasAcceptedCurrentDisclaimer } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (hasAcceptedCurrentDisclaimer) {
      navigate('/dashboard', { replace: true });
    }
  }, [hasAcceptedCurrentDisclaimer, navigate]);

  const handleAccept = async () => {
    if (!user?.id) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_legal_acceptances')
        .upsert({
          user_id: user.id,
          legal_document_type: 'disclaimer',
          version: CURRENT_DISCLAIMER_VERSION,
          accepted_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,legal_document_type,version',
        });

      if (error) throw error;

      await refreshUserRole();
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Failed to accept disclaimer', error);
      alert('Unable to record acceptance. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-slate-900">Platform Disclaimer Acceptance Required</h1>
        <p className="mt-3 text-sm text-slate-600">Before accessing EziRisk, you must accept the current platform disclaimer.</p>

        <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 space-y-3">
          <p>
            By continuing, you acknowledge that professional judgement remains your responsibility and that generated outputs are
            support tools requiring competent review before issue.
          </p>
          <p>
            You must ensure all reports are validated against site evidence, legal obligations, and your organisation standards.
          </p>
          <p className="text-xs text-slate-500">Disclaimer version: {CURRENT_DISCLAIMER_VERSION}</p>
        </div>

        <button
          type="button"
          onClick={handleAccept}
          disabled={isSubmitting}
          className="mt-6 w-full rounded-lg bg-slate-900 text-white py-3 px-4 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? 'Recording acceptance…' : 'I Accept and Continue'}
        </button>
      </div>
    </div>
  );
}
