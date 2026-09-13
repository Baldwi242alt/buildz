# Supabase database CA

`supabase-prod-ca-2021.crt` is the public database CA linked by the BuildZ
Supabase project's Database Settings > SSL configuration > Download certificate.

Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Retrieved over verified HTTPS on 2026-09-13. This is a public CA certificate,
not a private key. The container loads it through `NODE_EXTRA_CA_CERTS` while
PostgreSQL hostname and chain verification remain enabled. Update it from the
provider's authenticated dashboard if the provider rotates its database CA.

For local operator setup in PowerShell:

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path 'infra/certs/supabase-prod-ca-2021.crt').Path
npx tsx scripts/hosted-setup.ts check
npx tsx scripts/hosted-setup.ts migrate
npx tsx scripts/hosted-setup.ts provision
```

The operator helper reads `.env.hosting.local`. Provisioning creates a separate
Git-ignored `.env.hosting.runtime.local` containing API/worker credentials.
Keep both files private. Never deploy the owner password or the operator file.
