import { describe, expect, it } from "vitest";
import { canAssignRole, canManageAccount } from "../lib/management-rules";
describe("Panel role rules", () => {
  it("developer may appoint admins", () => expect(canAssignRole("developer", "admin")).toBe(true));
  it("developer may appoint owners", () => expect(canAssignRole("developer", "owner")).toBe(true));
  it("only owner may appoint developers", () => { expect(canAssignRole("owner", "developer")).toBe(true); expect(canAssignRole("developer", "developer")).toBe(false); expect(canAssignRole("admin", "developer")).toBe(false); });
  it("admins cannot appoint privileged roles", () => { expect(canAssignRole("admin", "owner")).toBe(false); expect(canAssignRole("admin", "admin")).toBe(false); });
  it("admins cannot modify owners or developers", () => { expect(canManageAccount("admin", "developer", false)).toBe(false); expect(canManageAccount("admin", "owner", false)).toBe(false); });
  it("panel cannot demote or disable its own account", () => expect(canManageAccount("developer", "developer", true)).toBe(false));
});