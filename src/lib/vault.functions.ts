import { createServerFn } from "@tanstack/react-start";

const PBKDF2_ITERATIONS = 100_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type VaultRow = {
  id: string;
  password_hash: string;
  password_salt: string;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function verifyVault(
  vaultId: string,
  name: string,
  password: string,
): Promise<VaultRow> {
  const admin = await getAdmin();
  const { data: vault, error } = await admin
    .from("vaults")
    .select("id, password_hash, password_salt")
    .eq("id", vaultId)
    .eq("name", normalizeName(name))
    .maybeSingle();
  if (error || !vault) {
    throw new Error("This database could not be found. Check the name and password.");
  }
  const hash = await hashPassword(password, vault.password_salt);
  if (hash !== vault.password_hash) {
    throw new Error("This database could not be found. Check the name and password.");
  }
  return vault;
}

export const createVault = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string; password: string }) => input)
  .handler(async ({ data }) => {
    const name = normalizeName(data.name);
    const password = data.password;
    if (name.length < 1 || name.length > 40) {
      throw new Error("Name must be between 1 and 40 characters.");
    }
    if (password.length < 4) {
      throw new Error("Password must be at least 4 characters.");
    }
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await hashPassword(password, salt);
    const admin = await getAdmin();
    const { data: vault, error } = await admin
      .from("vaults")
      .insert({ name, password_hash: passwordHash, password_salt: salt })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error("A database with this name already exists. Pick another name.");
      }
      throw new Error("Could not create the database. Try again.");
    }
    return { vaultId: vault.id, name };
  });

export const openVault = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string; password: string }) => input)
  .handler(async ({ data }) => {
    const name = normalizeName(data.name);
    const admin = await getAdmin();
    const { data: vault } = await admin
      .from("vaults")
      .select("id, password_hash, password_salt")
      .eq("name", name)
      .maybeSingle();
    if (!vault) {
      throw new Error("No database with this name exists.");
    }
    const hash = await hashPassword(data.password, vault.password_salt);
    if (hash !== vault.password_hash) {
      throw new Error("Wrong password for this database.");
    }
    return { vaultId: vault.id, name };
  });

export type VaultFileMeta = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export const listFiles = createServerFn({ method: "POST" })
  .inputValidator((input: { vaultId: string; name: string; password: string }) => input)
  .handler(async ({ data }): Promise<VaultFileMeta[]> => {
    await verifyVault(data.vaultId, data.name, data.password);
    const admin = await getAdmin();
    const { data: files, error } = await admin
      .from("vault_files")
      .select("id, filename, mime_type, size_bytes, created_at")
      .eq("vault_id", data.vaultId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load the files in this database.");
    return (files ?? []).map((f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mime_type,
      sizeBytes: Number(f.size_bytes),
      createdAt: f.created_at,
    }));
  });

export const uploadFile = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      vaultId: string;
      name: string;
      password: string;
      filename: string;
      mimeType: string;
      base64: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<VaultFileMeta> => {
    await verifyVault(data.vaultId, data.name, data.password);
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.length === 0) throw new Error("That file is empty.");
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error("Files can be up to 8 MB.");
    }
    const filename = data.filename.slice(0, 200);
    const admin = await getAdmin();
    const { data: file, error } = await admin
      .from("vault_files")
      .insert({
        vault_id: data.vaultId,
        filename,
        mime_type: data.mimeType || "application/octet-stream",
        size_bytes: bytes.length,
        content_base64: bytesToBase64(bytes),
      })
      .select("id, filename, mime_type, size_bytes, created_at")
      .single();
    if (error) throw new Error("Upload failed. Try again.");
    return {
      id: file.id,
      filename: file.filename,
      mimeType: file.mime_type,
      sizeBytes: Number(file.size_bytes),
      createdAt: file.created_at,
    };
  });

export const downloadFile = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { vaultId: string; name: string; password: string; fileId: string }) => input,
  )
  .handler(async ({ data }) => {
    await verifyVault(data.vaultId, data.name, data.password);
    const admin = await getAdmin();
    const { data: file, error } = await admin
      .from("vault_files")
      .select("filename, mime_type, content_base64")
      .eq("id", data.fileId)
      .eq("vault_id", data.vaultId)
      .maybeSingle();
    if (error || !file) throw new Error("That file could not be found.");
    return {
      filename: file.filename,
      mimeType: file.mime_type,
      contentBase64: file.content_base64,
    };
  });

export const deleteFile = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { vaultId: string; name: string; password: string; fileId: string }) => input,
  )
  .handler(async ({ data }) => {
    await verifyVault(data.vaultId, data.name, data.password);
    const admin = await getAdmin();
    const { error } = await admin
      .from("vault_files")
      .delete()
      .eq("id", data.fileId)
      .eq("vault_id", data.vaultId);
    if (error) throw new Error("Could not delete that file.");
    return { ok: true };
  });
