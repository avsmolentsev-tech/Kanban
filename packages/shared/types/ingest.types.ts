export type IngestFileType = 'txt' | 'md' | 'pdf' | 'docx' | 'png' | 'jpg' | 'jpeg' | 'mp3' | 'wav' | 'm4a' | 'ogg' | 'url' | 'text';
export type IngestTargetType = 'meeting' | 'idea' | 'task' | 'material' | 'unknown';

export interface InboxItem {
  id: number;
  original_filename: string;
  original_path: string | null;
  file_type: IngestFileType;
  extracted_text: string | null;
  processed: boolean;
  target_type: IngestTargetType | null;
  target_id: number | null;
  created_at: string;
  error: string | null;
}

export interface InboxAnalysis {
  detected_type: IngestTargetType;
  title: string;
  date: string | null;
  people: string[];
  project_hints: string[];
  agreements: string[];
  tasks: string[];
  ideas: string[];
  summary: string;
  key_facts: string[];
  tags: string[];
}

export interface IngestResult {
  inbox_item_id: number;
  detected_type: IngestTargetType;
  created_records: Array<{ type: string; id: number; title: string; vault_path: string | null }>;
  summary: string;
}
