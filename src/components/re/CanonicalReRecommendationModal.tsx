import { useEffect, useMemo, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Photo {
  path: string;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  uploaded_at: string;
}

interface CanonicalReRecommendationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  documentId: string;
  moduleInstanceId: string;
  sourceModuleKey: string;
  createdBy?: string | null;
}

const MODULE_SECTIONS = [
  { key: 'RE_01_DOC_CONTROL', label: 'RE-01 Document Control' },
  { key: 'RE_02_CONSTRUCTION', label: 'RE-02 Construction' },
  { key: 'RE_03_OCCUPANCY', label: 'RE-03 Occupancy' },
  { key: 'RE_06_FIRE_PROTECTION', label: 'RE-04 Fire Protection' },
  { key: 'RE_07_NATURAL_HAZARDS', label: 'RE-05 Exposures' },
  { key: 'RE_08_UTILITIES', label: 'RE-06 Utilities' },
  { key: 'RE_09_MANAGEMENT', label: 'RE-07 Management Systems' },
  { key: 'RE_12_LOSS_VALUES', label: 'RE-08 Loss & Values' },
  { key: 'OTHER', label: 'Other' },
];

const MAX_PHOTOS_PER_RECOMMENDATION = 3;
const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024;

export default function CanonicalReRecommendationModal({
  isOpen,
  onClose,
  onSaved,
  documentId,
  moduleInstanceId,
  sourceModuleKey,
  createdBy,
}: CanonicalReRecommendationModalProps) {
  const [title, setTitle] = useState('');
  const [observation, setObservation] = useState('');
  const [actionRequired, setActionRequired] = useState('');
  const [hazardDescription, setHazardDescription] = useState('');
  const [comments, setComments] = useState('');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [status, setStatus] = useState<'Open' | 'In Progress' | 'Completed'>('Open');
  const [targetDate, setTargetDate] = useState('');
  const [owner, setOwner] = useState('');
  const [relatedModule, setRelatedModule] = useState(sourceModuleKey || 'OTHER');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const defaultModule = useMemo(() => sourceModuleKey || 'OTHER', [sourceModuleKey]);

  useEffect(() => {
    if (isOpen) {
      setRelatedModule(defaultModule);
      return;
    }

    Object.values(photoUrls).forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    setPhotoUrls({});
  }, [isOpen, defaultModule]);

  const resetForm = () => {
    setTitle('');
    setObservation('');
    setActionRequired('');
    setHazardDescription('');
    setComments('');
    setPriority('Medium');
    setStatus('Open');
    setTargetDate('');
    setOwner('');
    setRelatedModule(defaultModule);
    setPhotos([]);
    setPhotoUrls({});
  };

  const getStorageUrl = async (path: string): Promise<string | null> => {
    const { data } = supabase.storage.from('evidence').getPublicUrl(path);
    if (data?.publicUrl) return data.publicUrl;

    const { data: signedData } = await supabase.storage.from('evidence').createSignedUrl(path, 3600);
    return signedData?.signedUrl || null;
  };

  const handleUploadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_PHOTO_SIZE_BYTES) return;
    if (photos.length >= MAX_PHOTOS_PER_RECOMMENDATION) return;

    setUploadingPhoto(true);
    const previewUrl = URL.createObjectURL(file);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `${documentId}/recommendations/${moduleInstanceId}/${fileName}`;

      setPhotoUrls((prev) => ({ ...prev, [filePath]: previewUrl }));

      const { error: uploadError } = await supabase.storage.from('evidence').upload(filePath, file);
      if (uploadError) throw uploadError;

      const persistentUrl = await getStorageUrl(filePath);

      setPhotos((prev) => [
        ...prev,
        {
          path: filePath,
          file_name: file.name,
          size_bytes: file.size,
          mime_type: file.type,
          uploaded_at: new Date().toISOString(),
        },
      ]);

      if (persistentUrl) {
        URL.revokeObjectURL(previewUrl);
        setPhotoUrls((prev) => ({ ...prev, [filePath]: persistentUrl }));
      }
    } catch (error) {
      console.error('Error uploading recommendation photo:', error);
      URL.revokeObjectURL(previewUrl);
      setPhotoUrls((prev) => {
        const next = { ...prev };
        const stalePath = Object.keys(next).find((k) => next[k] === previewUrl);
        if (stalePath) delete next[stalePath];
        return next;
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (photoPath: string) => {
    const url = photoUrls[photoPath];
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
    setPhotos((prev) => prev.filter((p) => p.path !== photoPath));
    setPhotoUrls((prev) => {
      const next = { ...prev };
      delete next[photoPath];
      return next;
    });
  };

  const handleSave = async () => {
    if (!title.trim() || isSaving) return;

    setIsSaving(true);
    try {
      const { error } = await supabase.from('re_recommendations').insert({
        document_id: documentId,
        module_instance_id: moduleInstanceId,
        source_type: 'manual',
        source_module_key: relatedModule || defaultModule,
        source_factor_key: null,
        title: title.trim(),
        observation_text: observation.trim(),
        action_required_text: actionRequired.trim(),
        hazard_text: hazardDescription.trim(),
        comments_text: comments.trim() || null,
        status,
        priority,
        target_date: targetDate || null,
        owner: owner.trim() || null,
        photos,
        created_by: createdBy || null,
      });

      if (error) throw error;

      await onSaved();
      resetForm();
      onClose();
    } catch (error) {
      console.error('Error saving recommendation:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-neutral-900 mb-4">Add Recommendation</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-neutral-700 mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Observation</label>
            <textarea value={observation} onChange={(e) => setObservation(e.target.value)} rows={3} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Action Required</label>
            <textarea value={actionRequired} onChange={(e) => setActionRequired(e.target.value)} rows={3} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Hazard/Risk Description</label>
            <textarea value={hazardDescription} onChange={(e) => setHazardDescription(e.target.value)} rows={3} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Comments</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as 'High' | 'Medium' | 'Low')} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
              <option>High</option><option>Medium</option><option>Low</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'Open' | 'In Progress' | 'Completed')} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
              <option>Open</option><option>In Progress</option><option>Completed</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Target Date</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Owner</label>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-neutral-700 mb-1">Related Module</label>
            <select value={relatedModule} onChange={(e) => setRelatedModule(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
              {MODULE_SECTIONS.map((module) => <option key={module.key} value={module.key}>{module.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-neutral-700 mb-1">Supporting Photos ({photos.length}/{MAX_PHOTOS_PER_RECOMMENDATION})</label>
            <label className="inline-flex items-center gap-2 px-3 py-2 bg-neutral-100 rounded-md cursor-pointer hover:bg-neutral-200 text-sm">
              <Upload className="w-4 h-4" /> Upload Photo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUploadPhoto(file);
                e.currentTarget.value = '';
              }} disabled={uploadingPhoto || photos.length >= MAX_PHOTOS_PER_RECOMMENDATION} />
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
              {photos.map((photo) => (
                <div key={photo.path} className="relative border border-neutral-200 rounded-md overflow-hidden">
                  {photoUrls[photo.path] ? <img src={photoUrls[photo.path]} alt={photo.file_name} className="w-full h-24 object-cover" /> : <div className="w-full h-24 bg-neutral-100" />}
                  <button type="button" onClick={() => removePhoto(photo.path)} className="absolute top-1 right-1 bg-white/90 rounded-full p-1"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={() => { resetForm(); onClose(); }} className="px-4 py-2 text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors font-medium">Cancel</button>
          <button type="button" disabled={!title.trim() || isSaving} onClick={handleSave} className="px-4 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors font-medium disabled:opacity-50">{isSaving ? 'Saving…' : 'Save Recommendation'}</button>
        </div>
      </div>
    </div>
  );
}
