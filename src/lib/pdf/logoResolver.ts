import { supabase } from '../supabase';

export interface LogoResult {
  bytes: Uint8Array | null;
  mime: 'image/png' | 'image/jpeg' | null;
  signedUrl: string | null;
}

/**
 * Resolves organisation logo from storage.
 * Returns logo bytes, mime type, and signed URL.
 * Never throws - returns nulls on failure.
 */
export async function resolveOrganisationLogo(
  organisationId: string,
  brandingLogoPath: string | null | undefined
): Promise<LogoResult> {
  const nullResult: LogoResult = { bytes: null, mime: null, signedUrl: null };

  if (import.meta.env.DEV) console.log('[Logo Resolver] Starting logo resolution:', {
    organisationId,
    brandingLogoPath,
    hasBrandingPath: !!brandingLogoPath
  });

  if (!brandingLogoPath) {
    if (import.meta.env.DEV) console.log('[Logo Resolver] No branding path provided, returning null');
    return nullResult;
  }

  const normalizedPath = brandingLogoPath.startsWith('org-assets/')
    ? brandingLogoPath.slice('org-assets/'.length)
    : brandingLogoPath;

  try {
    // Create signed URL
    if (import.meta.env.DEV) console.log('[Logo Resolver] Creating signed URL for path:', normalizedPath);
    const { data, error } = await supabase.storage
      .from('org-assets')
      .createSignedUrl(normalizedPath, 3600);

    if (error || !data?.signedUrl) {
      if (import.meta.env.DEV) console.warn('[Logo Resolver] Failed to create signed URL:', {
        error: error?.message || 'No error message',
        errorDetails: error,
        hasData: !!data,
        hasSignedUrl: !!data?.signedUrl
      });
      return nullResult;
    }

    const signedUrl = data.signedUrl;
    if (import.meta.env.DEV) console.log('[Logo Resolver] Signed URL created successfully');

    // Fetch logo bytes with timeout
    if (import.meta.env.DEV) console.log('[Logo Resolver] Fetching logo bytes from signed URL');
    const response = await Promise.race([
      fetch(signedUrl),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('Logo fetch timed out')), 3000)
      )
    ]);

    if (!response.ok) {
      if (import.meta.env.DEV) console.warn('[Logo Resolver] Failed to fetch logo:', {
        status: response.status,
        statusText: response.statusText
      });
      return { bytes: null, mime: null, signedUrl };
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (import.meta.env.DEV) console.log('[Logo Resolver] Logo bytes fetched successfully:', {
      byteLength: bytes.length,
      hasBytes: bytes.length > 0
    });

    // Detect mime type from file extension
    let mime: 'image/png' | 'image/jpeg' | null = null;
    const lowerPath = normalizedPath.toLowerCase();
    if (lowerPath.endsWith('.png')) {
      mime = 'image/png';
    } else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
      mime = 'image/jpeg';
    }

    if (import.meta.env.DEV) console.log('[Logo Resolver] Logo resolved successfully:', {
      mime,
      byteLength: bytes.length
    });

    return { bytes, mime, signedUrl };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (import.meta.env.DEV) console.warn('[Logo Resolver] Exception resolving logo:', {
      error: errorMsg,
      errorStack: error instanceof Error ? error.stack : undefined
    });
    return nullResult;
  }
}
