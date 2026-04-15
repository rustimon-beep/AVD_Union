import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://zvzydbqroeoqebzioynd.supabase.co";
const supabaseAnonKey = "sb_publishable_Bvyj0IBxFBFH3ObBXSO5UQ_MaSUvQ58";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);