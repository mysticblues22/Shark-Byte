# Shark Byte VPS Provisioning Replacement

This bundle contains COMPLETE replacement files for the VPS provisioning system.

Included:
- centralized OS catalog
- Standard/Nested virtualization wizard
- deterministic Incus provisioning
- explicit resource configuration
- SSH proxy configuration
- targeted failure cleanup
- VPS DB OS/virtualization/failure fields
- database schema migration
- compiled dist files matching the source

Validation performed against the uploaded project:
- `npx tsc --noEmit` — PASS
- `npm run build` — PASS

Important:
1. Back up the current Shark Byte repository/database first.
2. Replace the matching files with the files in this bundle. These are complete files, not snippets.
3. Apply `database/schema.sql` through the bot's existing migration process, or apply `database/migration_vps_virtualization.sql` if your deployment uses a separate migration step.
4. Ensure `dist/` is replaced with the included compiled files OR run `npm run build` after replacing `src/`.
5. Restart only the Shark Byte PM2 application.
6. Test Claim VPS -> OS -> Virtualization -> Confirmation. Do not start a real customer provisioning test until the wizard is verified.

Nested virtualization:
- Standard: `security.nesting=false`, no KVM device.
- Nested: enables `security.nesting` and attempts to expose `/dev/kvm` using an Incus `unix-char` device.
- Nested provisioning is rejected if `/dev/kvm` cannot be verified inside the new VPS.
- The code does not silently downgrade Nested to Standard.

Storage:
- `limits.disk` is never passed to `incus launch`.
- The current `dir` backend is reported as not enforcing per-container disk quota.

The bundle intentionally does not replace unrelated Minecraft/Pterodactyl code.
