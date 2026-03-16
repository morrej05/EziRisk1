import { supabase } from '../../supabase';

export async function resolveEvidencePhotoUrl(path: string): Promise<string | null> {
  const { data: signedData } = await supabase.storage
    .from('evidence')
    .createSignedUrl(path, 3600);

  if (signedData?.signedUrl) {
    return signedData.signedUrl;
  }

  const { data: publicData } = supabase.storage
    .from('evidence')
    .getPublicUrl(path);

  return publicData?.publicUrl || null;
}
