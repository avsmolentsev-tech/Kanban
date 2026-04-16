export type DraftType = 'meeting' | 'task' | 'idea' | 'inbox';

export interface ExtractionResult {
  detected_type: DraftType;
  title: string;
  date: string;                 // YYYY-MM-DD
  project_hints: string[];
  company_hints: string[];
  people: string[];
  tags_hierarchical: string[];  // e.g. ["type/meeting", "project/roboty"]
  tags_free: string[];          // up to 5 topical tags, lowercase
  summary: string;
  agreements: number;           // meeting only; 0 otherwise
  tasks: string[];              // meeting only; extracted task titles
}

export interface DraftCard {
  id: string;
  userId: number;
  tgId: number;
  createdAt: number;
  updatedAt: number;
  type: DraftType;
  title: string;
  date: string;
  projectName: string | null;
  companyName: string | null;
  people: string[];
  tags: string[];               // canonical merged list (hierarchical + free)
  summary: string;
  transcript: string;
  sourceKind: 'voice' | 'audio' | 'document' | 'photo' | 'text';
  sourceLocalPath: string | null;
  awaitingEdit: boolean;
  cardMessageId: number | null; // TG message id of the rendered card
}
