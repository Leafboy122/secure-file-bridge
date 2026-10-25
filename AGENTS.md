<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture decisions
- Vault access is name + password only (no user accounts): every `createServerFn` in `src/lib/vault.functions.ts` verifies the password (PBKDF2, 100k iterations) and uses `supabaseAdmin` loaded inside the handler. `vaults`/`vault_files` have RLS enabled with no policies (locked to service_role by GRANT) — do not add anon/authenticated grants or policies; do not read these tables from the browser client.
- Vault sessions live in the browser (localStorage key `lest-file-transferer-session`), so the same name+password opens the vault from any device.
- File size limit is 8 MB per file, enforced in `uploadFile` (and mirrored in the UI).
