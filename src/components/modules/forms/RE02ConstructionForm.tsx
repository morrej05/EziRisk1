import BuildingsGrid from '../../re/BuildingsGrid';

interface Document {
  id: string;
  title: string;
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
  document,
  onSaved
}: RE02ConstructionFormProps) {
  return (
    <BuildingsGrid
      documentId={document.id}
      mode="construction"
      onAfterSave={onSaved}
    />
  );
}
