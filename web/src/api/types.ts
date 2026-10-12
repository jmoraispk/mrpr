export interface DeltaConfig {
  host: string
  project: string
  mr_iid: number
}

export interface MergeRequest {
  iid: number
  title: string
  web_url: string
  state: string
  source_branch: string
  target_branch: string
  /** The head commit; absent from the CLI's own API. */
  sha?: string
}

export interface DiffFile {
  old_path: string
  new_path: string
  diff: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  collapsed: boolean
  too_large: boolean
}

export interface LineRangeEndpoint {
  line_code: string
  type: 'old' | 'new' | null
  old_line?: number | null
  new_line?: number | null
}

export interface NoteLineRange {
  start: LineRangeEndpoint
  end: LineRangeEndpoint
}

export interface NotePosition {
  old_path?: string
  new_path?: string
  old_line?: number | null
  new_line?: number | null
  line_range?: NoteLineRange | null
}

export interface DiscussionNote {
  id: number | string
  body: string
  author?: {
    name: string
    username: string
    avatar_url?: string
  }
  created_at?: string
  position?: NotePosition | null
  resolvable?: boolean
  resolved?: boolean
}

export interface Discussion {
  id: string
  individual_note?: boolean
  notes: DiscussionNote[]
}

export interface PostingResult {
  placement: 'inline' | 'general'
  fallback: 'none' | 'final_line' | 'general'
  discussion: Discussion
}
