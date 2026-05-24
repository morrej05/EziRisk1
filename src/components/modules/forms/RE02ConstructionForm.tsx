import BuildingsGrid from '../../re/BuildingsGrid';
import { isReDocumentLocked } from '../../../lib/re/documentLock';

interface Document {
  id: string;
  title: string;
  issue_status?: 'draft' | 'issued' | 'superseded';
}

interface ModuleInstance {
  id: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, any>;
}

interface RE02ConstructionFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

export default function RE02ConstructionForm({
  moduleInstance,
  document,
  onSaved
}: RE02ConstructionFormProps) {
  const isLocked = isReDocumentLocked(document.issue_status);
  return (
    <BuildingsGrid
      documentId={document.id}
      mode="construction"
      onAfterSave={onSaved}
      moduleInstanceId={moduleInstance.id}
      isLocked={isLocked}
    />
  );
}
