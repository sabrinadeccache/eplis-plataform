// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { authorize, authorizeOrRedirect, AuthError } from "./authorize";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

type FakeUser = Record<string, unknown> | null;

function fakeSupabase(authUser: { id: string } | null, userRow: FakeUser) {
  return {
    auth: {
      getUser: async () => ({ data: { user: authUser } }),
      signOut: vi.fn(async () => {}),
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
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const activeAtco = {
  id: "u1",
  name: "A",
  email: "a@x.com",
  role: "air_traffic_controller",
  status: "active",
};

describe("authorize", () => {
  it("devolve o usuário quando sessão válida, ativo e na trilha certa", async () => {
    const { user } = await authorize(fakeSupabase({ id: "u1" }, activeAtco), {
      track: "controller",
    });
    expect(user.id).toBe("u1");
  });

  it("recusa sem sessão (401)", async () => {
    await expect(authorize(fakeSupabase(null, null))).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401,
    });
  });

  it("recusa quando não há linha em public.users (401)", async () => {
    await expect(
      authorize(fakeSupabase({ id: "u1" }, null)),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("recusa conta inactive/blocked (403)", async () => {
    for (const status of ["inactive", "blocked"]) {
      await expect(
        authorize(fakeSupabase({ id: "u1" }, { ...activeAtco, status })),
      ).rejects.toMatchObject({ code: "inactive", status: 403 });
    }
  });

  it("recusa quem não é da trilha exigida (403)", async () => {
    await expect(
      authorize(fakeSupabase({ id: "u1" }, activeAtco), { track: "pilot" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("admin passa nas duas trilhas", async () => {
    const admin = { ...activeAtco, role: "admin" };
    await expect(
      authorize(fakeSupabase({ id: "u1" }, admin), { track: "pilot" }),
    ).resolves.toBeTruthy();
    await expect(
      authorize(fakeSupabase({ id: "u1" }, admin), { track: "controller" }),
    ).resolves.toBeTruthy();
  });

  it("aplica lista de roles explícita", async () => {
    await expect(
      authorize(fakeSupabase({ id: "u1" }, activeAtco), { roles: ["admin"] }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("authorizeOrRedirect", () => {
  it("redireciona pra /login?erro=sessao sem sessão", async () => {
    await expect(
      authorizeOrRedirect(fakeSupabase(null, null)),
    ).rejects.toThrow("REDIRECT:/login?erro=sessao");
  });

  it("desloga e redireciona pra /login?erro=bloqueada se inativo", async () => {
    const supabase = fakeSupabase({ id: "u1" }, { ...activeAtco, status: "blocked" });
    await expect(authorizeOrRedirect(supabase)).rejects.toThrow(
      "REDIRECT:/login?erro=bloqueada",
    );
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it("redireciona pro /dashboard se fora da trilha", async () => {
    await expect(
      authorizeOrRedirect(fakeSupabase({ id: "u1" }, activeAtco), { track: "pilot" }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });
});
