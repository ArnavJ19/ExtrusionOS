import { SessionContext } from "@/types/app";

/**
 * Validates if the current user has access to a specific dealership
 */
export function canAccessDealership(user: SessionContext, dealershipId: string | null | undefined): boolean {
  if (!dealershipId) return false;
  if (user.role === "owner" || user.role === "admin") return true;
  return user.dealerId === dealershipId;
}

/**
 * Validates if the user can manage employees in a dealership
 */
export function canManageDealerUsers(user: SessionContext, dealershipId: string | null | undefined): boolean {
  if (user.role === "owner") return true;
  if (user.role === "dealer_admin" && user.dealerId === dealershipId) return true;
  return false;
}

/**
 * Validates if the user can assign tasks within a dealership
 */
export function canAssignTasks(user: SessionContext, dealershipId: string | null | undefined): boolean {
  if (user.role === "owner" || user.role === "admin") return true;
  if (user.role === "dealer_admin" && user.dealerId === dealershipId) return true;
  return false;
}

/**
 * Validates if the user can view a specific task
 */
export function canViewTask(user: SessionContext, task: { dealership_id?: string | null, assigned_to?: string | null, created_by?: string | null }): boolean {
  if (user.role === "owner" || user.role === "admin") return true;
  
  if (user.dealerId) {
    if (task.dealership_id !== user.dealerId) return false;
    if (user.role === "dealer_admin") return true;
    return task.assigned_to === user.userId || task.created_by === user.userId;
  }
  
  // Factory staff can see tasks assigned to them or created by them
  return task.assigned_to === user.userId || task.created_by === user.userId;
}

/**
 * Validates if the user can view audit logs for a given dealership
 */
export function canViewDealerAuditLogs(user: SessionContext, dealershipId: string | null | undefined): boolean {
  if (user.role === "owner" || user.role === "admin") return true;
  if (user.role === "dealer_admin" && user.dealerId === dealershipId) return true;
  return false;
}

/**
 * Validates if the user can view payments for a given dealership
 */
export function canViewDealerPayments(user: SessionContext, dealershipId: string | null | undefined): boolean {
  if (user.role === "owner" || user.role === "admin" || user.role === "accounts") return true;
  if (user.role === "dealer_admin" && user.dealerId === dealershipId) return true;
  return false;
}

/**
 * Validates if the user can create/edit payments for a given dealership
 */
export function canManageDealerPayments(user: SessionContext, dealershipId: string | null | undefined): boolean {
  if (user.role === "owner" || user.role === "admin" || user.role === "accounts") return true;
  if (user.role === "dealer_admin" && user.dealerId === dealershipId) return true;
  return false;
}
