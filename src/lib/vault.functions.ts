import { createServerFn } from "@tanstack/react-start";

const PBKDF2_ITERATIONS = 100_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB — platform storage maximum
const BUCKET = "vault-files";

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

/**
 * Verifies the caller, then hands back a short-lived signed upload URL so the
 * browser can stream the file straight into storage without it ever passing
 * through the server.
 */
export const startUpload = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      vaultId: string;
      name: string;
      password: string;
      filename: string;
      sizeBytes: number;
    }) => input,
  )
  .handler(async ({ data }) => {
    await verifyVault(data.vaultId, data.name, data.password);
    if (data.sizeBytes <= 0) throw new Error("That file is empty.");
    if (data.sizeBytes > MAX_FILE_BYTES) {
      throw new Error("Files can be up to 5 GB.");
    }
    const admin = await getAdmin();
    const safeName = data.filename.slice(0, 160).replace(/[\/\\]/g, "_") || "file";
    const path = `${data.vaultId}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { expiresIn: 3600 });
    if (error || !signed) throw new Error("Could not start the upload. Try again.");
    return { signedUrl: signed.signedUrl, path: signed.path };
  });

/** Records the file in the database after the browser finished streaming it. */
export const confirmUpload = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      vaultId: string;
      name: string;
      password: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      storagePath: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<VaultFileMeta> => {
    await verifyVault(data.vaultId, data.name, data.password);
    const admin = await getAdmin();
    const { data: file, error } = await admin
      .from("vault_files")
      .insert({
        vault_id: data.vaultId,
        filename: data.filename.slice(0, 200),
        mime_type: data.mimeType || "application/octet-stream",
        size_bytes: data.sizeBytes,
        storage_path: data.storagePath,
      })
      .select("id, filename, mime_type, size_bytes, created_at")
      .single();
    if (error) throw new Error("Could not record the upload. Try again.");
    return {
      id: file.id,
      filename: file.filename,
      mimeType: file.mime_type,
      sizeBytes: Number(file.size_bytes),
      createdAt: file.created_at,
    };
  });

export type DownloadResult =
  | { kind: "url"; url: string; filename: string }
  | { kind: "base64"; filename: string; mimeType: string; contentBase64: string };

export const downloadFile = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { vaultId: string; name: string; password: string; fileId: string }) => input,
  )
  .handler(async ({ data }): Promise<DownloadResult> => {
    await verifyVault(data.vaultId, data.name, data.password);
    const admin = await getAdmin();
    const { data: file, error } = await admin
      .from("vault_files")
      .select("filename, mime_type, content_base64, storage_path")
      .eq("id", data.fileId)
      .eq("vault_id", data.vaultId)
      .maybeSingle();
    if (error || !file) throw new Error("That file could not be found.");
    if (file.storage_path) {
      const { data: signed, error: urlError } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(file.storage_path, 600, { download: file.filename });
      if (urlError || !signed) throw new Error("Could not prepare the download. Try again.");
      return { kind: "url", url: signed.signedUrl, filename: file.filename };
    }
    // Legacy file stored in the database itself.
    return {
      kind: "base64",
      filename: file.filename,
      mimeType: file.mime_type,
      contentBase64: file.content_base64 ?? "",
    };
  });

export const deleteFile = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { vaultId: string; name: string; password: string; fileId: string }) => input,
  )
  .handler(async ({ data }) => {
    await verifyVault(data.vaultId, data.name, data.password);
    const admin = await getAdmin();
    const { data: file } = await admin
      .from("vault_files")
      .select("storage_path")
      .eq("id", data.fileId)
      .eq("vault_id", data.vaultId)
      .maybeSingle();
    if (file?.storage_path) {
      const { error: removeError } = await admin.storage
        .from(BUCKET)
        .remove([file.storage_path]);
      if (removeError) throw new Error("Could not delete that file.");
    }
    const { error } = await admin
      .from("vault_files")
      .delete()
      .eq("id", data.fileId)
      .eq("vault_id", data.vaultId);
    if (error) throw new Error("Could not delete that file.");
    return { ok: true };
  });
