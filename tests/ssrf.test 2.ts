import { describe, it, expect } from "vitest";
import { isPrivateAddress } from "../src/client.js";

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local and metadata addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const a of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });
});
