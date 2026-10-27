export type ManagementRole = "admin" | "owner" | "developer";
export function canAssignRole(actor: ManagementRole, role: ManagementRole) {
  return role === "developer" ? actor === "owner" : actor === "developer" || actor === "owner";
}
export function canManageAccount(actor: ManagementRole, target: ManagementRole | null, self: boolean) {
  return !self && (!target || actor === "developer" || actor === "owner");
}