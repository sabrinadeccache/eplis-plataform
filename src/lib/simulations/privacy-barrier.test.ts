import { describe, expect, it, vi } from "vitest";
import { withPrivacyUpload, assertPrivacyWrite } from "./privacy-barrier";
type Admin = Parameters<typeof withPrivacyUpload>[0];
const adminWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as Admin;

describe("withPrivacyUpload", () => {
  it("reserva antes de enviar; só libera após confirmação de upload", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: "ticket", error: null }).mockResolvedValueOnce({ error: null });
    let release!: () => void;
    const upload = vi.fn(() => new Promise<{ error: null }>((resolve) => { release = () => resolve({ error: null }); }));
    const pending = withPrivacyUpload(adminWith(rpc), "u", "r", "phase2", upload, vi.fn());
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(rpc).toHaveBeenLastCalledWith("finish_privacy_upload", { p_upload_id: "ticket" });
  });
  it("barreira recusada nunca inicia upload", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "blocked" } });
    const upload = vi.fn();
    await expect(withPrivacyUpload(adminWith(rpc), "u", "r", "pilot", upload, vi.fn())).rejects.toThrow(/indisponível/);
    expect(upload).not.toHaveBeenCalled();
  });
  it("throw/timeout mantém reserva, sem liberação por relógio", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ticket", error: null });
    const pending = withPrivacyUpload(adminWith(rpc), "u", "r", "phase2", vi.fn().mockRejectedValue(new Error("network")), vi.fn());
    await expect(pending).rejects.toThrow("network");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("erro concluído só libera depois de remover o path determinístico", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: "ticket", error: null }).mockResolvedValueOnce({ error: null });
    const rollback = vi.fn().mockResolvedValue({ error: null });
    const result = await withPrivacyUpload(adminWith(rpc), "u", "r", "phase2", vi.fn().mockResolvedValue({ error: { message: "upload" } }), rollback);
    expect(result.error).toBeTruthy();
    expect(rollback).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenLastCalledWith("finish_privacy_upload", { p_upload_id: "ticket" });
  });
  it("falha da remoção compensatória mantém ticket", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ticket", error: null });
    await withPrivacyUpload(adminWith(rpc), "u", "r", "phase2", vi.fn().mockResolvedValue({ error: { message: "upload" } }), vi.fn().mockResolvedValue({ error: { message: "delete" } }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("liberação falha fechado", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: "ticket", error: null }).mockResolvedValueOnce({ error: { message: "network" } });
    await expect(withPrivacyUpload(adminWith(rpc), "u", "r", "phase2", async () => ({ error: null }), vi.fn())).rejects.toMatchObject({ status: 503 });
  });
  it.each(["42501", "08006"])("não ignora escrita rejeitada pelo banco (%s)", (code) => {
    expect(() => assertPrivacyWrite({ error: { code, message: "rejected" } })).toThrow();
  });
});
