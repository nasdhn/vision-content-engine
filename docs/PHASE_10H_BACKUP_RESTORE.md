# Phase 10H — Backup + Restore Drill

Status: implementation tranche for the frozen V1 backup/recovery policy.

## Local canonical backup acceptance

The Phase 10H implementation command is deliberately LOCAL-only. It validates the portable backup format and real restore mechanics without pretending the future production/off-host topology has already been selected.

`pnpm ops:backup -- --output <new-absolute-directory>` creates a portable backup containing:

- `postgres.dump`: PostgreSQL custom-format logical dump from the pinned Compose PostgreSQL service;
- `objects/*.bin`: every object in the configured canonical S3 bucket, stored by SHA-256 rather than by object key;
- `repository.tar.gz`: tracked repository/config/spec files from the exact Git `HEAD`;
- `recovery-docs/*`: explicit restore/secret-recovery documents and `.env.example`;
- `manifest.json`: hashes, byte sizes, source environment/bucket/database, Git HEAD and object-key mapping.

PostgreSQL is dumped **before** the S3 object snapshot. Under the frozen immutable-media lifecycle, an Asset can become READY only after its object already exists, so a DB snapshot followed by the object snapshot cannot introduce a restored READY row whose immutable object was created later than the DB snapshot. Objects created after the DB snapshot may be backed up as harmless unreferenced extras.

The command never copies `.env`, provider tokens, cookies or secret values. The output directory must not already exist and is created private (`0700`); backup files/manifests are private (`0600`). `manifest.json` is written only after all backup components complete successfully. An interrupted backup retains `INCOMPLETE` and is not a valid restore source.

The manifest intentionally records:

```json
{
  "offHostVerified": false
}
```

Creating a local portable bundle does **not** prove D-144's production off-host-copy requirement.

## Isolated restore drill

`pnpm ops:restore-drill -- --backup <absolute-directory> --report <absolute-json-path>` is LOCAL-only and fails closed for non-loopback dependencies.

It:

1. verifies every backup file against the manifest SHA-256 and byte count;
2. reuses the exact running PostgreSQL image ID but starts a new ephemeral PostgreSQL container with `--network none` and fresh non-production credentials;
3. restores `postgres.dump` into the isolated database;
4. checks public schema presence and requires the exact applied Prisma migration-name set to match the checked-out repository;
5. records representative lineage counts (`Asset`, `Render`, `Publication`, `JobAttempt`, `OutboxEvent`, `ModelInvocation`);
6. creates a disposable S3 bucket, restores every backed object and reads every object back to verify SHA-256/size;
7. validates up to 20 READY Asset references plus up to 20 approved Render Asset references against restored objects;
8. refuses a READY S3 Asset that points outside the configured backed-up bucket;
9. if the canonical bucket was empty, executes a synthetic isolated storage canary so the storage restore write/read path is still exercised;
10. deletes the disposable bucket and isolated PostgreSQL container in `finally`.

No Redis state is restored or replayed. No worker, control, API, scheduler or real provider is started by the drill.

## Report and recovery objectives

The drill report records:

- start/completion time and duration;
- backup age;
- PostgreSQL table/migration/lineage evidence;
- restored/verified object counts;
- READY/approved Asset sample counts;
- whether a synthetic storage canary was necessary;
- PASS/FAILED plus a bounded error code.

It evaluates the frozen targets (`RPO <= 24h`, `RTO <= 4h`) for the tested backup age/drill duration, but always records:

```text
offHostVerified=false
productionClaimAllowed=false
```

Therefore a green local drill proves the backup/restore mechanism and compatibility, **not** that production off-host durability or production RPO/RTO have already been achieved. Those remain rollout gates until the portable backup is copied/monitored off-host and a production-like isolated restore is measured.

## Acceptance

Phase 10H implementation acceptance requires:

```text
format + lint + typecheck + secret scan
backup/restore contract tests
real portable backup from LOCAL canonical PostgreSQL + S3
real isolated PostgreSQL restore
real disposable-bucket object restore/readback
schema/migration/lineage checks
Asset-reference checks when canonical READY Assets exist
report result = PASS
no leaked secret material
Git safety + broad regression before commit
```
