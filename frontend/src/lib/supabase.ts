import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Null when env vars are missing — components check before using
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export const supabaseConfigured = Boolean(supabase);

export interface ValidationResult {
  id: string;
  agent_name: string;
  capability: string;
  url: string;
  overall_score: number;
  dimension_scores: {
    autonomy: number;
    reasoning: number;
    tool_use: number;
    safety: number;
    reliability: number;
  };
  risk_flags: string[];
  badge: "platinum" | "gold" | "silver" | "bronze" | "needs_work";
  summary: string;
  created_at: string;
}
