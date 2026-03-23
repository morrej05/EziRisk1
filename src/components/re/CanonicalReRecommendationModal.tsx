import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Image as ImageIcon, Upload, X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-slate-50 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Add Recommendation</h3>
            <p className="mt-1 text-sm text-slate-600">
              Uses the same editor presentation as RE-09 recommendations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            aria-label="Close recommendation modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Brief title for this recommendation"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Observation</label>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="What was observed during the assessment?"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Action Required</label>
            <textarea
              value={actionRequired}
              onChange={(e) => setActionRequired(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="What action needs to be taken?"
            />
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="mb-2 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
              <label className="block text-sm font-medium text-amber-900">
                Hazard / Risk Description
              </label>
            </div>
            <textarea
              value={hazardDescription}
              onChange={(e) => setHazardDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
              placeholder="Describe the hazard or risk associated with this recommendation"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Author Comments (Internal Notes)
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Internal notes (not included in report)"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 md:grid-cols-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'High' | 'Medium' | 'Low')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Open' | 'In Progress' | 'Completed')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Target Date</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Owner</label>
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Assigned to"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Related Module</label>
              <select
                value={relatedModule}
                onChange={(e) => setRelatedModule(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {MODULE_SECTIONS.map((module) => (
                  <option key={module.key} value={module.key}>
                    {module.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700">
                Supporting Photos ({photos.length}/{MAX_PHOTOS_PER_RECOMMENDATION})
              </label>
              {photos.length < MAX_PHOTOS_PER_RECOMMENDATION ? (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
                  <Upload className="h-4 w-4" />
                  Add Photo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUploadPhoto(file);
                      e.currentTarget.value = '';
                    }}
                    disabled={uploadingPhoto}
                  />
                </label>
              ) : (
                <span className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-600">
                  Maximum {MAX_PHOTOS_PER_RECOMMENDATION} photos
                </span>
              )}
            </div>

            {photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-4">
                {photos.map((photo) => (
                  <div
                    key={photo.path}
                    className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                  >
                    <div className="aspect-video overflow-hidden bg-slate-100">
                      {photoUrls[photo.path] ? (
                        <img
                          src={photoUrls[photo.path]}
                          alt={photo.file_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-slate-400" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.path)}
                      className="absolute right-2 top-2 rounded-full bg-red-600 p-1 text-white hover:bg-red-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <div className="p-2 text-xs text-slate-600">
                      <p className="truncate" title={photo.file_name}>
                        {photo.file_name}
                      </p>
                      <p className="text-slate-500">{(photo.size_bytes / 1024 / 1024).toFixed(1)} MB</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-6 text-center text-sm text-slate-500">
                No photos attached (max 15MB per photo)
              </div>
            )}

            {uploadingPhoto && <div className="mt-2 text-sm text-blue-600">Uploading photo...</div>}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="rounded-lg bg-slate-100 px-4 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!title.trim() || isSaving}
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save Recommendation'}
          </button>
        </div>
      </div>
    </div>
  );
}
