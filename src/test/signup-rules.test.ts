import { describe, expect, it } from "vitest";
import { isDisposableEmail, passwordProblems } from "@/lib/signup-rules";

describe("signup rules", () => {
  it("blocks temp mail domains", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@yopmail.com")).toBe(true);
  });
  it("allows real email providers", () => {
    expect(isDisposableEmail("a@gmail.com")).toBe(false);
  });
  it("rejects weak passwords", () => {
    expect(passwordProblems("password").length).toBeGreaterThan(0);
  });
  it("accepts strong passwords", () => {
    expect(passwordProblems("Str0ng!Passw0rd")).toEqual([]);
  });
});
