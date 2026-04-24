import { supabase } from '../supabase'

// Mirrors the public.admin_role enum in Supabase (WEC-110)
export type AdminRole = 'owner' | 'menu_order'

/**
 * Fetches admin status for the given user. Returns isAdmin=false when the
 * user has no row in public.admin_users (the RLS policy also hides other
 * admins' rows from non-owners, so only the user's own row is readable here).
 */
export async function fetchAdminStatus(userId: string): Promise<{
  data: { isAdmin: boolean; role: AdminRole | null }
  error: string | null
}> {
  const { data, error } = await supabase
    .from('admin_users')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return { data: { isAdmin: false, role: null }, error: error.message }
  }
  return {
    data: {
      isAdmin: !!data,
      role: (data?.role as AdminRole) ?? null,
    },
    error: null,
  }
}
