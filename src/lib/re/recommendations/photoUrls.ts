import { supabase } from '../../supabase';

// evidence is a private bucket — signed URLs are required. getPublicUrl returns
// a non-functional URL for private buckets and must not be used as a fallback.
export async function resolveEvidencePhotoUrl(path: string): Promise<string | null> {
  const { data: signedData } = await supabase.storage
    .from('evidence')
    .createSignedUrl(path, 3600);

  return signedData?.signedUrl ?? null;
}
