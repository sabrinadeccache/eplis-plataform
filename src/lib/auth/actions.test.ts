// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map()) }));

let authUser: { id: string; email: string } | null = { id: "u1", email: "u1@x.com" };
let userRow: Record<string, unknown> | null = {
  id: "u1",
  name: "U1",
  email: "u1@x.com",
  role: "air_traffic_controller",
  status: "active",
};
const updateSpy = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authUser } })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: userRow }),
        update: (payload: unknown) => {
          updateSpy(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  })),
}));

const { updateProfile, updatePassword } = await import("./actions");

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: "u1", email: "u1@x.com" };
  userRow = {
    id: "u1",
    name: "U1",
    email: "u1@x.com",
    role: "air_traffic_controller",
    status: "active",
  };
});

describe("updateProfile — gate de status", () => {
  it("salva quando a conta está ativa", async () => {
    const res = await updateProfile({ error: null }, form({ name: "Novo" }));
    expect(res.error).toBeNull();
    expect(updateSpy).toHaveBeenCalled();
  });

  it("recusa conta blocked/inactive sem tocar no banco", async () => {
    for (const status of ["blocked", "inactive"]) {
      userRow = { ...userRow!, status };
      const res = await updateProfile({ error: null }, form({ name: "Novo" }));
      expect(res.error).toMatch(/bloqueada ou inativa/i);
      expect(updateSpy).not.toHaveBeenCalled();
    }
  });

  it("recusa sem sessão", async () => {
    authUser = null;
    const res = await updateProfile({ error: null }, form({ name: "Novo" }));
    expect(res.error).toMatch(/sess/i);
  });
});

describe("updatePassword — gate de status", () => {
  const good = {
    current_password: "Abc12345!",
    password: "Xyz98765!",
    confirm_password: "Xyz98765!",
  };

  it("recusa conta blocked antes de reautenticar", async () => {
    userRow = { ...userRow!, status: "blocked" };
    const res = await updatePassword({ error: null }, form(good));
    expect(res.error).toMatch(/bloqueada ou inativa/i);
  });
});
