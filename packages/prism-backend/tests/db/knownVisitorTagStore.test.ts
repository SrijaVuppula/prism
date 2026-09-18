import { describe, expect, it, vi } from "vitest";
import { KnownVisitorTagStore } from "../../src/db/knownVisitorTagStore";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

describe("KnownVisitorTagStore", () => {
  it("upserts a tag keyed on visitor group id", async () => {
    const pool = fakePool();
    const store = new KnownVisitorTagStore(pool);

    await store.tag("group_1", "Mail carrier");

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(visitor_group_id\) DO UPDATE/);
    expect(params).toEqual(["group_1", "Mail carrier"]);
  });

  it("removes a tag", async () => {
    const pool = fakePool();
    const store = new KnownVisitorTagStore(pool);

    await store.remove("group_1");

    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM known_visitor_tags/), ["group_1"]);
  });

  it("returns null when no tag exists", async () => {
    const pool = fakePool([]);
    const store = new KnownVisitorTagStore(pool);
    expect(await store.find("group_1")).toBeNull();
  });

  it("returns the tag when one exists", async () => {
    const pool = fakePool([{ visitor_group_id: "group_1", label: "Mail carrier" }]);
    const store = new KnownVisitorTagStore(pool);
    expect(await store.find("group_1")).toEqual({ visitorGroupId: "group_1", label: "Mail carrier" });
  });
});
